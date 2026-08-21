'use client'

// La página que ve quien recibe un link compartido.
//
// FASE KK: render PURO del payload que arma `app/api/share/route.js`. Antes
// esta página era un TERCER generador de las mismas cifras (sumaba items crudos
// de Firestore a mano) y por eso acumuló defectos que el resto de la app ya
// tenía resueltos: montos en quetzales impresos con `$`, posiciones de mercado
// sin precio en vivo, el patrimonio sin `isExcludedFromNetWorth`, la gráfica
// dibujando los docs paralelos de NAV solo-broker al lado de los de portafolio
// completo (el diente de sierra), un "all-time" que era el cambio crudo de
// valor sin netear un depósito, y la ganancia por posición medida como
// `(actual − compra) / compra`, que imprime 0.0% sobre un bono que sí paga.
//
// FASE KP: la estructura pasa al ORDEN INSTITUCIONAL de un estado de cuenta
// profesional (Morgan Stanley/Schwab/Fidelity, investigado): identidad y
// contacto → valor → reconciliación (la sección que PRUEBA la aritmética) →
// rendimiento por horizontes + años calendario → gráfica → asignación y
// posiciones → exposición → concentración y caída máxima → ingresos y
// vencimientos → avisos en dos niveles. Todo el copy es bilingüe: el idioma lo
// elige el dueño al crear el link y el visitante puede alternarlo acá.
//
// Regla al editar: acá NO se calcula ninguna cifra. Si falta un número, se
// agrega al payload del servidor, que sale del mismo motor que el reporte PDF.
// Las DOS únicas derivaciones permitidas son aritmética sobre valores que el
// payload ya publica: la concentración (`concentrationFrom`, sobre los pesos)
// y el residuo de la reconciliación (final − inicio − flujos), que ES la
// identidad que esa sección existe para probar.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { formatCurrency, TYPE_COLORS, categoryLabel } from '@/components/dashboard/utils'
import { concentrationFrom } from '@/lib/sharePayload'
import { regionLabel } from '@/lib/reportData'
import { niceScale } from '@/lib/niceAxis'
import Logo from '@/components/ui/Logo'
import { Sun, Moon, Download, Lock, Phone, Mail } from 'lucide-react'

const LANG_KEY = 'chispudo-shared-lang'

function sanitizePageLang(raw) {
  return raw === 'en' || raw === 'es' ? raw : null
}

export default function SharedPortfolioPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  // El idioma: la preferencia guardada del VISITANTE gana; si no hay, el que
  // eligió el dueño al crear el link; si no, español. Se resuelve en efectos
  // (localStorage no existe en el server y leerlo al renderizar rompería la
  // hidratación).
  const [lang, setLang] = useState('es')
  useEffect(() => {
    try {
      const stored = sanitizePageLang(localStorage.getItem(LANG_KEY))
      if (stored) setLang(stored)
    } catch { /* sin storage: se queda el default */ }
  }, [])
  useEffect(() => {
    if (!data?.lang) return
    try {
      if (!sanitizePageLang(localStorage.getItem(LANG_KEY))) setLang(sanitizePageLang(data.lang) || 'es')
    } catch {
      setLang(sanitizePageLang(data.lang) || 'es')
    }
  }, [data])
  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === 'es' ? 'en' : 'es'
      try { localStorage.setItem(LANG_KEY, next) } catch { /* best-effort */ }
      return next
    })
  }, [])
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  useEffect(() => {
    fetch(`/api/share?token=${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error)))
      .then(setData)
      .catch((e) => setError(typeof e === 'string' ? e : 'error'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <Centered>
        <div className="shimmer h-7 w-52 rounded-lg mb-3 mx-auto" />
        <div className="shimmer h-4 w-32 rounded mx-auto" />
      </Centered>
    )
  }

  if (error || !data) {
    const expired = error === 'Link expired'
    return (
      <Centered>
        <div className="rounded-2xl p-3 inline-block mb-4"
          style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)' }}>
          <Lock size={28} strokeWidth={1.75} style={{ color: 'var(--alert-error-icon)' }} />
        </div>
        <h1 className="text-h2 mb-2" style={{ color: 'var(--text-primary)' }}>
          {expired ? t('Este link venció', 'This link has expired') : t('Portafolio no encontrado', 'Portfolio not found')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {expired
            ? t('Pide un link nuevo a quien te lo compartió.', 'Ask whoever shared it for a fresh link.')
            : t('El link no es válido o fue revocado.', 'This link is invalid or was revoked.')}
        </p>
      </Centered>
    )
  }

  return <SharedDashboard data={data} lang={lang} t={t} toggleLang={toggleLang} />
}

function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="card p-8 text-center max-w-sm w-full">{children}</div>
    </div>
  )
}

function SharedDashboard({ data, lang, t, toggleLang }) {
  const {
    display, owner, advisor, asOf, baseCurrency, label, scopeLabel, hasSeries,
    kpis = {}, allocation = [], holdings = [], series = [], income = {}, maturities = [],
    performance = [], calendarYears = [], flows = null, maxDrawdown = null,
    currencies = [], geography = [],
    degraded, failedSymbols = [], empty,
  } = data

  const showAmounts = display !== 'percent'
  const showPerf = display !== 'amounts'
  const money = useCallback((v) => formatCurrency(v, baseCurrency), [baseCurrency])

  // El tema lo aplica el script de app/layout.jsx ANTES de que React monte,
  // leyendo `chispudo-theme`. Arrancar en 'dark' a ciegas dejaba el estado
  // mintiendo (ícono de sol sobre una página clara) y el primer clic sin
  // efecto visible, porque ponía el tema que ya estaba puesto.
  const [theme, setTheme] = useState('dark')
  useEffect(() => {
    const applied = document.documentElement.getAttribute('data-theme')
    if (applied === 'light' || applied === 'dark') setTheme(applied)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.add('theme-transitioning')
      document.documentElement.setAttribute('data-theme', next)
      setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 400)
      return next
    })
  }, [])

  // Derivación permitida #1: la concentración es aritmética sobre los pesos que
  // ya vienen calculados (ver la regla en la cabecera).
  const concentration = useMemo(
    () => concentrationFrom(holdings, allocation.length),
    [holdings, allocation.length],
  )

  const asOfLabel = useAsOfLabel(asOf, lang)

  const exportCsv = useCallback(() => {
    const head = ['Name', 'Symbol', 'Type', ...(showAmounts ? ['Value'] : []), 'Weight %', ...(showPerf ? ['Return %'] : [])]
    const esc = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = [head.join(',')]
    holdings.forEach((h) => {
      rows.push([
        esc(h.name), esc(h.symbol || ''), esc(h.type || ''),
        ...(showAmounts ? [(h.value ?? 0).toFixed(2)] : []),
        (h.weightPct ?? 0).toFixed(2),
        ...(showPerf ? [h.retPct == null ? '' : h.retPct.toFixed(2)] : []),
      ].join(','))
    })
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [holdings, showAmounts, showPerf])

  const catColor = (cat) => (TYPE_COLORS[cat] || TYPE_COLORS.other).bg
  const pct2 = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const perfColor = (v) => (v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <header className="sticky top-0 z-20 border-b" style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg-card)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo size={18} />
            <span className="text-micro px-2 py-0.5 rounded-full shrink-0"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-card-hover)' }}>
              {t('Solo lectura', 'Read-only')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={toggleLang} aria-label={t('Cambiar idioma', 'Switch language')}
              className="h-8 px-2.5 grid place-items-center rounded-lg border transition-colors text-xs font-medium tabular-nums"
              style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
              {lang === 'es' ? 'EN' : 'ES'}
            </button>
            {!empty && (
              <button onClick={exportCsv} aria-label={t('Descargar CSV', 'Download CSV')} title={t('Descargar CSV', 'Download CSV')}
                className="h-8 w-8 grid place-items-center rounded-lg border transition-colors"
                style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                <Download size={14} strokeWidth={2} />
              </button>
            )}
            <button onClick={toggleTheme} aria-label={t('Cambiar tema', 'Toggle theme')}
              className="h-8 w-8 grid place-items-center rounded-lg border transition-colors"
              style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
              {theme === 'dark' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {empty ? (
          <div className="card p-8 text-center">
            <h1 className="text-h2 mb-2" style={{ color: 'var(--text-primary)' }}>{t('Nada que mostrar todavía', 'Nothing to show yet')}</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('Este link apunta a un portafolio sin posiciones.', 'This link points at a portfolio with no positions.')}
            </p>
          </div>
        ) : (
          <>
            <Hero
              t={t} owner={owner} advisor={advisor} label={label} scopeLabel={scopeLabel} asOfLabel={asOfLabel}
              kpis={kpis} showAmounts={showAmounts} showPerf={showPerf}
              money={money} baseCurrency={baseCurrency}
            />

            {degraded && (
              <p className="text-xs px-1" style={{ color: 'var(--alert-warn-icon)' }}>
                {t(
                  `No hay precio en vivo para ${failedSymbols.join(', ')}. Esas posiciones se muestran a su último valor conocido.`,
                  `Live prices are unavailable for ${failedSymbols.join(', ')}. Those positions are shown at their last known value.`,
                )}
              </p>
            )}

            {flows && kpis.valueChange && (
              <Reconciliation t={t} flows={flows} valueChange={kpis.valueChange} money={money} lang={lang} />
            )}

            {showPerf && performance.length > 0 && (
              <PerformanceSection t={t} performance={performance} calendarYears={calendarYears}
                showAmounts={showAmounts} money={money} pct2={pct2} perfColor={perfColor} />
            )}

            <Section title={t('Evolución del valor', 'Portfolio growth')}>
              {hasSeries
                ? <GrowthChart t={t} series={series} showAmounts={showAmounts} money={money} baseCurrency={baseCurrency} />
                : <Muted>{t(
                  'El historial guardado abarca el patrimonio completo, así que se deja fuera de un link que comparte solo una parte.',
                  'The saved history covers the whole net worth, so it is left out of a link that shares only part of it.',
                )}</Muted>}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <Section title={t('Asignación de activos', 'Asset allocation')}
                footer={`${kpis.holdingsCount} ${kpis.holdingsCount === 1 ? t('posición', 'position') : t('posiciones', 'positions')} · ${baseCurrency}`}>
                <div className="space-y-2.5">
                  {allocation.map((a) => (
                    <div key={a.cat}>
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-primary)' }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor(a.cat) }} />
                          <span className="truncate">{categoryLabel(a.cat, lang)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {a.pct.toFixed(1)}%{showAmounts ? ` · ${money(a.value)}` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
                        <div className="h-full rounded-full" style={{ width: `${a.pct}%`, backgroundColor: catColor(a.cat) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title={t('Principales posiciones', 'Top holdings')}>
                <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                  {holdings.slice(0, 10).map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                      <div className="min-w-0">
                        <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{h.name}</div>
                        {h.symbol && <div className="text-micro" style={{ color: 'var(--text-muted)' }}>{h.symbol}</div>}
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        {showAmounts && <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{money(h.value)}</div>}
                        <div className="text-micro flex items-center justify-end gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>{h.weightPct.toFixed(1)}%</span>
                          {showPerf && h.retPct != null && (
                            <span style={{ color: perfColor(h.retPct) }}>
                              {h.retPct >= 0 ? '+' : ''}{h.retPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            {(currencies.length > 0 || geography.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {currencies.length > 0 && (
                  <Section title={t('Exposición por moneda', 'Currency exposure')}
                    footer={t('Por denominación original de cada activo.', 'By each asset\'s original denomination.')}>
                    <ExposureRows rows={currencies} labelOf={(k) => k} showAmounts={showAmounts} money={money} />
                  </Section>
                )}
                {geography.length > 0 && (
                  <Section title={t('Exposición geográfica', 'Geographic exposure')}>
                    <ExposureRows rows={geography} labelOf={(k) => regionLabel(k, lang, t('Otros', 'Other'))} showAmounts={showAmounts} money={money} />
                  </Section>
                )}
              </div>
            )}

            {concentration && (
              <Section title={t('Concentración', 'Concentration')}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat value={String(concentration.score)} label={t('Diversificación', 'Diversification')}
                    sub={concentration.score >= 70 ? t('Buena', 'Good') : concentration.score >= 40 ? t('Moderada', 'Moderate') : t('Concentrada', 'Concentrated')}
                    color={concentration.score >= 70 ? 'var(--accent-green)' : concentration.score >= 40 ? 'var(--alert-warn-icon)' : 'var(--text-negative)'} />
                  <Stat value={String(concentration.positions)} label={t('Posiciones', 'Positions')} sub={`${concentration.categories} ${t('categorías', 'categories')}`} />
                  <Stat value={`${concentration.largestPct.toFixed(1)}%`} label={t('Mayor posición', 'Largest position')} />
                  <Stat value={`${concentration.top3Pct.toFixed(1)}%`} label={t('Peso del top 3', 'Top 3 weight')} />
                </div>
                {showPerf && maxDrawdown && (
                  <p className="text-xs mt-4 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
                    {t('Máxima caída del período: ', 'Largest decline in the period: ')}
                    <span className="tabular-nums" style={{ color: 'var(--text-negative)' }}>{maxDrawdown.pct.toFixed(1)}%</span>
                    {maxDrawdown.fromTs && maxDrawdown.toTs && (
                      <span> ({shortDate(maxDrawdown.fromTs, lang)} → {shortDate(maxDrawdown.toTs, lang)})</span>
                    )}
                  </p>
                )}
              </Section>
            )}

            {(income.sources?.length > 0 || maturities.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {income.sources?.length > 0 && (
                  <Section title={t('Ingreso anual estimado', 'Estimated annual income')}>
                    {/* Solo con un total REAL: imprimir $0.00 grande sobre
                        fuentes con tasa es un cero inventado (regla del repo:
                        un dato ausente se omite, nunca se imprime en cero). */}
                    {showAmounts && income.projectedAnnual > 0 && (
                      <div className="text-kpi mb-1" style={{ color: 'var(--accent-green)' }}>{money(income.projectedAnnual)}</div>
                    )}
                    {income.yieldPct != null && (
                      <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                        {income.yieldPct.toFixed(2)}% {t('del portafolio', 'of the portfolio')}
                      </div>
                    )}
                    <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                      {income.sources.map((s, i) => (
                        <div key={`${s.name}-${i}`} className="flex items-center justify-between gap-3 py-1.5 text-xs first:pt-0">
                          <span className="truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                          <span className="shrink-0 tabular-nums flex items-center gap-2">
                            {showAmounts && s.annual > 0 && <span style={{ color: 'var(--text-secondary)' }}>{money(s.annual)}</span>}
                            <span style={{ color: 'var(--accent-green)' }}>{s.rateLabel}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {maturities.length > 0 && (
                  <Section title={t('Próximos vencimientos', 'Upcoming maturities')}>
                    <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                      {maturities.slice(0, 6).map((m, i) => (
                        <div key={`${m.name}-${i}`} className="flex items-center justify-between gap-3 py-1.5 text-xs first:pt-0">
                          <span className="min-w-0 flex items-baseline gap-2">
                            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                            <span className="shrink-0" style={{ color: m.days <= 90 ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
                              {m.days <= 30 ? `${m.days}d` : m.days <= 365 ? `${Math.round(m.days / 30)}${t('m', 'mo')}` : `${(m.days / 365).toFixed(1)}${t('a', 'yr')}`}
                            </span>
                          </span>
                          {showAmounts && (
                            <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-primary)' }}>{money(m.value)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )}

            <Disclosures t={t} asOfLabel={asOfLabel} owner={owner} advisor={advisor} />
          </>
        )}

        <p className="text-center text-micro pt-2" style={{ color: 'var(--text-muted)' }}>
          {t('Compartido vía', 'Shared via')} <span style={{ color: 'var(--accent-blue)' }}>Chispudo</span> · chispu.xyz
        </p>
      </main>
    </div>
  )
}

// La fecha de corte se arma en un EFECTO, nunca durante el render: depende de
// la zona horaria del visitante, así que calcularla al renderizar hace que el
// HTML del servidor no coincida con el del cliente y React descarte el árbol.
function useAsOfLabel(asOf, lang) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!asOf) return
    setLabel(new Date(asOf).toLocaleString(lang === 'es' ? 'es' : 'en', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }))
  }, [asOf, lang])
  return label
}

// Fechas cortas de secciones (drawdown, reconciliación): también dependen del
// locale, así que pasan por el mismo criterio: el dato crudo es un ts y el
// texto se arma con las opciones fijas de siempre. Como estas se calculan con
// props que solo existen tras el fetch (nunca en el HTML del servidor), no hay
// riesgo de hidratación: el primer render del cliente ya es post-fetch.
function shortDate(ts, lang) {
  if (!ts || !isFinite(ts)) return ''
  return new Date(ts).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Hero({ t, owner, advisor, label, scopeLabel, asOfLabel, kpis, showAmounts, showPerf, money, baseCurrency }) {
  const ret = kpis.sinceStart || kpis.ytd
  const retLabel = kpis.sinceStart ? t('desde el inicio', 'since inception') : t('este año', 'this year')
  const preparedFor = label || scopeLabel
  const preparedBy = [owner, advisor?.firm].filter(Boolean).join(' · ')

  return (
    <div className="card card-hero p-5 sm:p-6">
      {(preparedFor || preparedBy) && (
        <div className="mb-3">
          {preparedFor && (
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('Preparado para', 'Prepared for')} {preparedFor}
            </div>
          )}
          {preparedBy && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {t('por', 'by')} {preparedBy}
            </div>
          )}
        </div>
      )}
      {showAmounts ? (
        <>
          <div className="text-caption mb-1">{t('Patrimonio', 'Net worth')}</div>
          <div className="text-display tabular-nums" style={{ color: 'var(--text-primary)' }}>{money(kpis.netWorth)}</div>
        </>
      ) : (
        <>
          <div className="text-caption mb-1">{t('Rendimiento, ', 'Return, ')}{retLabel}</div>
          <div className="text-display tabular-nums"
            style={{ color: ret?.pct == null ? 'var(--text-primary)' : ret.pct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {ret?.pct == null ? '-' : `${ret.pct >= 0 ? '+' : ''}${ret.pct.toFixed(2)}%`}
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('El dueño comparte solo porcentajes, sin ningún monto.', 'The owner is sharing percentages only, without any amounts.')}
          </p>
        </>
      )}

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mt-3 text-sm">
        {showAmounts && kpis.debtTotal > 0 && (
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('Deuda', 'Debt')} </span>
            <span className="tabular-nums" style={{ color: 'var(--text-negative)' }}>({money(kpis.debtTotal)})</span>
          </span>
        )}
        {showPerf && showAmounts && ret?.pct != null && (
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('Rendimiento, ', 'Return, ')}{retLabel} </span>
            <span className="tabular-nums" style={{ color: ret.pct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
              {ret.pct >= 0 ? '+' : ''}{ret.pct.toFixed(2)}%
            </span>
          </span>
        )}
      </div>

      {(asOfLabel || showAmounts || advisor) && (
        <div className="text-micro mt-3 pt-3 border-t flex flex-wrap items-center gap-x-4 gap-y-1.5"
          style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
          {showAmounts && <span>{t('Valores en', 'Values in')} {baseCurrency}</span>}
          {asOfLabel && <span>{t('Al', 'As of')} {asOfLabel}</span>}
          {advisor?.phone && (
            <a href={`tel:${advisor.phone.replace(/[^+\d]/g, '')}`} className="inline-flex items-center gap-1 hover:underline"
              style={{ color: 'var(--accent-blue)' }}>
              <Phone size={11} strokeWidth={2} />{advisor.phone}
            </a>
          )}
          {advisor?.email && (
            <a href={`mailto:${advisor.email}`} className="inline-flex items-center gap-1 hover:underline"
              style={{ color: 'var(--accent-blue)' }}>
              <Mail size={11} strokeWidth={2} />{advisor.email}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// La reconciliación: inicio + depósitos − retiros + resultado = final. La
// sección que PRUEBA la aritmética del documento, y la única que puede hacerlo
// porque el resultado se muestra como el RESIDUO de esa identidad (derivación
// permitida #2: suma de valores publicados, y así cierra al centavo por
// construcción). Solo existe con serie y con montos: son montos.
function Reconciliation({ t, flows, valueChange, money, lang }) {
  const gain = (valueChange.abs ?? 0) - (flows.net ?? 0)
  const Row = ({ label, value, sign, strong, color }) => (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? 'font-medium' : ''}`}>
      <span style={{ color: strong ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <span className="tabular-nums shrink-0" style={{ color: color || 'var(--text-primary)' }}>{sign}{money(Math.abs(value))}</span>
    </div>
  )
  return (
    <Section title={t('Movimiento del período', 'Period activity')}>
      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
        <Row label={`${t('Valor al', 'Value on')} ${shortDate(valueChange.firstTs, lang)}`} value={valueChange.first} sign="" strong />
        {flows.deposits > 0 && (
          <Row label={`${t('Depósitos', 'Deposits')} (${flows.depositCount})`} value={flows.deposits} sign="+" color="var(--text-secondary)" />
        )}
        {flows.withdrawals > 0 && (
          <Row label={`${t('Retiros', 'Withdrawals')} (${flows.withdrawalCount})`} value={flows.withdrawals} sign="-" color="var(--text-secondary)" />
        )}
        <Row label={t('Resultado del período', 'Period result')} value={gain} sign={gain >= 0 ? '+' : '-'}
          color={gain >= 0 ? 'var(--accent-green)' : 'var(--text-negative)'} />
        <Row label={`${t('Valor al', 'Value on')} ${shortDate(valueChange.lastTs, lang)}`} value={valueChange.last} sign="" strong />
      </div>
      {flows.incomeCollected > 0 && (
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          {t('El resultado incluye ', 'The result includes ')}
          <span className="tabular-nums" style={{ color: 'var(--accent-green)' }}>{money(flows.incomeCollected)}</span>
          {t(` de ingresos cobrados (${flows.incomeCount} ${flows.incomeCount === 1 ? 'pago' : 'pagos'}).`,
            ` of income collected (${flows.incomeCount} ${flows.incomeCount === 1 ? 'payment' : 'payments'}).`)}
        </p>
      )}
    </Section>
  )
}

const HORIZON_LABELS = {
  '1m': ['1M', '1M'],
  '3m': ['3M', '3M'],
  ytd: ['YTD', 'YTD'],
  '1y': ['1A', '1Y'],
  '3y': ['3A', '3Y'],
  '5y': ['5A', '5Y'],
  all: ['Inicio', 'Incept.'],
}

function PerformanceSection({ t, performance, calendarYears, showAmounts, money, pct2, perfColor }) {
  const anyAnnualized = performance.some((r) => r.annualized)
  return (
    <Section title={t('Rendimiento', 'Performance')}
      footer={anyAnnualized ? t('* anualizado', '* annualized') : null}>
      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-min">
          {performance.map((r) => {
            const [es, en] = HORIZON_LABELS[r.key] || [r.key, r.key]
            return (
              <div key={r.key} className="rounded-xl px-3 py-2.5 min-w-[86px] text-center shrink-0"
                style={{ backgroundColor: 'var(--bg-card-hover)' }}>
                <div className="text-micro mb-1" style={{ color: 'var(--text-muted)' }}>
                  {t(es, en)}{r.annualized ? '*' : ''}
                </div>
                <div className="text-sm font-medium tabular-nums" style={{ color: perfColor(r.pct) }}>{pct2(r.pct)}</div>
                {showAmounts && r.abs != null && (
                  <div className="text-micro tabular-nums mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {r.abs >= 0 ? '+' : '-'}{money(Math.abs(r.abs))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {calendarYears.length > 0 && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
          <div className="text-micro mb-2" style={{ color: 'var(--text-muted)' }}>{t('Años calendario', 'Calendar years')}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {calendarYears.map((c) => (
              <span key={c.year} className="text-xs tabular-nums">
                <span style={{ color: 'var(--text-secondary)' }}>{c.year}{c.partial ? t(' (parcial)', ' (partial)') : ''} </span>
                <span style={{ color: perfColor(c.pct) }}>{pct2(c.pct)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

function ExposureRows({ rows, labelOf, showAmounts, money }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{labelOf(r.key)}</span>
            <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {r.pct.toFixed(1)}%{showAmounts && r.value != null ? ` · ${money(r.value)}` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, backgroundColor: 'var(--accent-blue)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Avisos en dos niveles (el patrón institucional investigado): una línea corta
// SIEMPRE visible y el bloque completo detrás de un botón. Las dos frases
// regulatorias vienen de cómo lo redactan las propias casas (FINRA 10-19 y el
// fraseo que usa IDC): complementa-no-sustituye, y sin rendimiento garantizado.
function Disclosures({ t, asOfLabel, owner, advisor }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {t(
          'Este resumen complementa, no sustituye, su estado de cuenta oficial. No se garantiza un rendimiento mínimo.',
          'This summary complements, and does not replace, your official account statement. No minimum return is guaranteed.',
        )}{' '}
        <button onClick={() => setOpen((v) => !v)} className="underline hover:opacity-80"
          style={{ color: 'var(--accent-blue)' }}>
          {open ? t('Ver menos', 'Show less') : t('Avisos importantes', 'Important notices')}
        </button>
      </p>
      {open && (
        <div className="mt-3 pt-3 border-t space-y-2 text-xs" style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}>
          <p>{t(
            'Las cifras provienen de los registros del titular del portafolio y de precios públicos de mercado; pueden diferir de los estados oficiales de cada institución.',
            'Figures come from the portfolio owner\'s records and public market prices; they may differ from each institution\'s official statements.',
          )}</p>
          <p>{t(
            'El rendimiento pasado no garantiza resultados futuros. Este documento es informativo y no constituye una oferta, recomendación ni asesoría de inversión.',
            'Past performance does not guarantee future results. This document is informational and does not constitute an offer, recommendation, or investment advice.',
          )}</p>
          {asOfLabel && (
            <p>{t('Cifras al', 'Figures as of')} {asOfLabel}.</p>
          )}
          {(owner || advisor?.firm) && (
            <p>{t('Preparado por', 'Prepared by')} {[owner, advisor?.firm].filter(Boolean).join(' · ')} {t('con Chispudo.', 'with Chispudo.')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, footer, children }) {
  return (
    <div className="card p-4 sm:p-5 h-full flex flex-col">
      <h2 className="card-title mb-4">{title}</h2>
      <div className="flex-1">{children}</div>
      {footer && (
        <div className="mt-4 pt-3 border-t text-xs" style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}>
          {footer}
        </div>
      )}
    </div>
  )
}

function Muted({ children }) {
  return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{children}</p>
}

function Stat({ value, label, sub, color }) {
  return (
    <div className="text-center">
      <div className="text-kpi tabular-nums" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="text-micro" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="text-micro" style={{ color: color || 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}

// La gráfica: mismo eje redondo que la del tablero (lib/niceAxis.js), porque un
// eje sin marcas obliga a adivinar cuánto vale cada punto. En modo 'percent' la
// serie llega ya rebasada a su primer punto, así que dibuja la misma forma sin
// publicar un solo monto.
function GrowthChart({ t, series, showAmounts, money, baseCurrency }) {
  const pts = useMemo(
    () => (series || []).map((p) => ({ ...p, v: showAmounts ? p.value : p.pct })).filter((p) => isFinite(p.v)),
    [series, showAmounts],
  )

  // El SVG se dibuja 1:1 con los píxeles reales, no con un viewBox fijo que se
  // escala. Con `viewBox="0 0 600 200"` estirado a 342px de un teléfono, un
  // `fontSize=11` renderiza a ~6px: la mitad del piso de 12px que este repo
  // sostiene desde FASE JT. Midiendo, el tamaño que se escribe es el que se ve.
  const boxRef = useRef(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next && next > 100) setW(Math.round(next))
    })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  if (pts.length < 2) return <Muted>{t('Todavía no hay historial suficiente.', 'Not enough history yet.')}</Muted>

  const narrow = w < 480
  const W = w, H = narrow ? 170 : 200
  const pad = { top: 12, right: 8, bottom: 28, left: narrow ? 46 : 58 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top - pad.bottom

  const vals = pts.map((p) => p.v)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const scale = niceScale(lo, hi, 5)
  const min = scale ? scale.min : lo
  const max = scale ? scale.max : hi
  const range = max - min || 1

  const x = (i) => pad.left + (i / (pts.length - 1)) * cw
  const y = (v) => pad.top + ch - ((v - min) / range) * ch

  const line = pts.map((p, i) => `${x(i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')
  const area = `${line} ${x(pts.length - 1).toFixed(2)},${(pad.top + ch).toFixed(2)} ${x(0).toFixed(2)},${(pad.top + ch).toFixed(2)}`

  const ticks = scale
    ? Array.from({ length: scale.count }, (_, i) => scale.min + i * scale.step)
    : [min, (min + max) / 2, max]

  const tickLabel = (v) => showAmounts
    ? compactMoney(v, baseCurrency)
    : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`

  const first = pts[0]
  const last = pts[pts.length - 1]

  const FS = 12

  return (
    <div ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={`Portfolio value from ${first.date} to ${last.date}`}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.left} x2={W - pad.right} y1={y(tk)} y2={y(tk)} stroke="var(--card-border)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tk)} textAnchor="end" dominantBaseline="middle"
              fontSize={FS} fill="var(--text-muted)">{tickLabel(tk)}</text>
          </g>
        ))}
        <polygon points={area} fill="url(#shareGrad)" />
        <polyline points={line} fill="none" stroke="var(--accent-blue)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <text x={pad.left} y={H - 9} fontSize={FS} fill="var(--text-muted)">{first.date}</text>
        <text x={W - pad.right} y={H - 9} textAnchor="end" fontSize={FS} fill="var(--text-muted)">{last.date}</text>
        <defs>
          <linearGradient id="shareGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {showAmounts
          ? `${t('Último', 'Latest')} ${money(last.v)}`
          : `${last.v >= 0 ? '+' : ''}${last.v.toFixed(1)}% ${t('desde', 'since')} ${first.date}`}
      </div>
    </div>
  )
}

// El símbolo de moneda se dice UNA vez arriba del eje; las marcas van compactas
// para que cinco rótulos quepan sin encimarse en un teléfono.
function compactMoney(v, baseCurrency) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${sign}${abs.toFixed(0)}`
}
