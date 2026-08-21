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
// Regla al editar: acá NO se calcula ninguna cifra. Si falta un número, se
// agrega al payload del servidor, que sale del mismo motor que el reporte PDF.
// La única derivación permitida es la de concentración, que es aritmética sobre
// los pesos que el payload ya trae (`concentrationFrom`).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { formatCurrency, TYPE_COLORS, categoryLabel } from '@/components/dashboard/utils'
import { concentrationFrom } from '@/lib/sharePayload'
import { niceScale } from '@/lib/niceAxis'
import Logo from '@/components/ui/Logo'
import { Sun, Moon, Download, Lock } from 'lucide-react'

export default function SharedPortfolioPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/share?token=${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error)))
      .then(setData)
      .catch((e) => setError(typeof e === 'string' ? e : 'Invalid or expired link'))
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
    return (
      <Centered>
        <div className="rounded-2xl p-3 inline-block mb-4"
          style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)' }}>
          <Lock size={28} strokeWidth={1.75} style={{ color: 'var(--alert-error-icon)' }} />
        </div>
        <h1 className="text-h2 mb-2" style={{ color: 'var(--text-primary)' }}>Portfolio not found</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {error || 'This link is invalid or has expired.'}
        </p>
      </Centered>
    )
  }

  return <SharedDashboard data={data} />
}

function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="card p-8 text-center max-w-sm w-full">{children}</div>
    </div>
  )
}

function SharedDashboard({ data }) {
  const {
    display, owner, asOf, baseCurrency, label, scopeLabel, hasSeries,
    kpis = {}, allocation = [], holdings = [], series = [], income = {}, maturities = [],
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

  // La ÚNICA derivación de esta página, y es aritmética sobre los pesos que ya
  // vienen calculados. Antes el conteo de posiciones se sacaba dos veces sobre
  // listas distintas y la pantalla se contradecía a sí misma (33 y 32).
  const concentration = useMemo(
    () => concentrationFrom(holdings, allocation.length),
    [holdings, allocation.length],
  )

  const asOfLabel = useAsOfLabel(asOf)

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

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <header className="sticky top-0 z-20 border-b" style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg-card)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo size={18} />
            <span className="text-micro px-2 py-0.5 rounded-full shrink-0"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-card-hover)' }}>
              Read-only
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!empty && (
              <button onClick={exportCsv} aria-label="Download CSV" title="Download CSV"
                className="h-8 w-8 grid place-items-center rounded-lg border transition-colors"
                style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                <Download size={14} strokeWidth={2} />
              </button>
            )}
            <button onClick={toggleTheme} aria-label="Toggle theme"
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
            <h1 className="text-h2 mb-2" style={{ color: 'var(--text-primary)' }}>Nothing to show yet</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              This link points at a portfolio with no positions.
            </p>
          </div>
        ) : (
          <>
            <Hero
              owner={owner} label={label} scopeLabel={scopeLabel} asOfLabel={asOfLabel}
              kpis={kpis} showAmounts={showAmounts} showPerf={showPerf}
              money={money} baseCurrency={baseCurrency}
            />

            {degraded && (
              <p className="text-xs px-1" style={{ color: 'var(--alert-warn-icon)' }}>
                Live prices are unavailable for {failedSymbols.join(', ')}. Those positions are shown at their last known value.
              </p>
            )}

            <Section title="Portfolio growth">
              {hasSeries
                ? <GrowthChart series={series} showAmounts={showAmounts} money={money} baseCurrency={baseCurrency} />
                : <Muted>The saved history covers the whole net worth, so it is left out of a link that shares only part of it.</Muted>}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <Section title="Asset allocation"
                footer={`${kpis.holdingsCount} ${kpis.holdingsCount === 1 ? 'position' : 'positions'} · ${baseCurrency}`}>
                <div className="space-y-2.5">
                  {allocation.map((a) => (
                    <div key={a.cat}>
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-primary)' }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor(a.cat) }} />
                          <span className="truncate">{categoryLabel(a.cat, 'en')}</span>
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

              <Section title="Top holdings">
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
                            <span style={{ color: h.retPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
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

            {concentration && (
              <Section title="Concentration">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat value={String(concentration.score)} label="Diversification"
                    sub={concentration.score >= 70 ? 'Good' : concentration.score >= 40 ? 'Moderate' : 'Concentrated'}
                    color={concentration.score >= 70 ? 'var(--accent-green)' : concentration.score >= 40 ? 'var(--alert-warn-icon)' : 'var(--text-negative)'} />
                  <Stat value={String(concentration.positions)} label="Positions" sub={`${concentration.categories} categories`} />
                  <Stat value={`${concentration.largestPct.toFixed(1)}%`} label="Largest position" />
                  <Stat value={`${concentration.top3Pct.toFixed(1)}%`} label="Top 3 weight" />
                </div>
              </Section>
            )}

            {(income.sources?.length > 0 || maturities.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {income.sources?.length > 0 && (
                  <Section title="Estimated annual income">
                    {showAmounts && (
                      <div className="text-kpi mb-1" style={{ color: 'var(--accent-green)' }}>{money(income.projectedAnnual)}</div>
                    )}
                    {income.yieldPct != null && (
                      <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                        {income.yieldPct.toFixed(2)}% of the portfolio
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
                  <Section title="Upcoming maturities">
                    <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
                      {maturities.slice(0, 6).map((m, i) => (
                        <div key={`${m.name}-${i}`} className="flex items-center justify-between gap-3 py-1.5 text-xs first:pt-0">
                          <span className="min-w-0 flex items-baseline gap-2">
                            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                            <span className="shrink-0" style={{ color: m.days <= 90 ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
                              {m.days <= 30 ? `${m.days}d` : m.days <= 365 ? `${Math.round(m.days / 30)}mo` : `${(m.days / 365).toFixed(1)}yr`}
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
          </>
        )}

        <p className="text-center text-micro pt-2" style={{ color: 'var(--text-muted)' }}>
          Shared via <span style={{ color: 'var(--accent-blue)' }}>Chispudo</span> · chispu.xyz
        </p>
      </main>
    </div>
  )
}

// La fecha de corte se arma en un EFECTO, nunca durante el render: depende de
// la zona horaria del visitante, así que calcularla al renderizar hace que el
// HTML del servidor no coincida con el del cliente y React descarte el árbol.
function useAsOfLabel(asOf) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!asOf) return
    setLabel(new Date(asOf).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }))
  }, [asOf])
  return label
}

function Hero({ owner, label, scopeLabel, asOfLabel, kpis, showAmounts, showPerf, money, baseCurrency }) {
  const ret = kpis.sinceStart || kpis.ytd
  const retLabel = kpis.sinceStart ? 'since inception' : 'this year'
  const identity = [owner, scopeLabel || label].filter(Boolean).join(' · ')

  return (
    <div className="card card-hero p-5 sm:p-6">
      {identity && (
        <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{identity}</div>
      )}
      {showAmounts ? (
        <>
          <div className="text-caption mb-1">Net worth</div>
          <div className="text-display tabular-nums" style={{ color: 'var(--text-primary)' }}>{money(kpis.netWorth)}</div>
        </>
      ) : (
        <>
          <div className="text-caption mb-1">Return, {retLabel}</div>
          <div className="text-display tabular-nums"
            style={{ color: ret?.pct == null ? 'var(--text-primary)' : ret.pct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {ret?.pct == null ? '-' : `${ret.pct >= 0 ? '+' : ''}${ret.pct.toFixed(2)}%`}
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            The owner is sharing percentages only, without any amounts.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mt-3 text-sm">
        {showAmounts && kpis.debtTotal > 0 && (
          <span>
            <span style={{ color: 'var(--text-muted)' }}>Debt </span>
            <span className="tabular-nums" style={{ color: 'var(--text-negative)' }}>({money(kpis.debtTotal)})</span>
          </span>
        )}
        {showPerf && showAmounts && ret?.pct != null && (
          <span>
            <span style={{ color: 'var(--text-muted)' }}>Return, {retLabel} </span>
            <span className="tabular-nums" style={{ color: ret.pct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
              {ret.pct >= 0 ? '+' : ''}{ret.pct.toFixed(2)}%
            </span>
          </span>
        )}
      </div>

      {(asOfLabel || showAmounts) && (
        <div className="text-micro mt-3 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
          {[showAmounts ? `Values in ${baseCurrency}` : null, asOfLabel ? `As of ${asOfLabel}` : null].filter(Boolean).join(' · ')}
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
function GrowthChart({ series, showAmounts, money, baseCurrency }) {
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

  if (pts.length < 2) return <Muted>Not enough history yet.</Muted>

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
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--card-border)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle"
              fontSize={FS} fill="var(--text-muted)">{tickLabel(t)}</text>
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
          ? `Latest ${money(last.v)}`
          : `${last.v >= 0 ? '+' : ''}${last.v.toFixed(1)}% since ${first.date}`}
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
