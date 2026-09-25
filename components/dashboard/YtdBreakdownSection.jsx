'use client'

import { ChevronDown } from 'lucide-react'
import { formatCurrency, formatDate, getBaseCurrency } from './utils'
import { InfoTip } from '../ui/Tooltip'
import { attributionRefusalText } from '@/lib/ytdAttribution'
import { buildYtdBreakdownView, signOf } from '@/lib/ytdBreakdownView'
import { useEffect, useRef, useState } from 'react'
import CardBoundary from './CardBoundary'

// ⛔ FASE OZ. El desglose del YTD vive ACÁ, como sección de ancho completo
// hermana de las dos cards superiores del tablero, y NO anidado dentro de
// NetWorthCard. Abrirlo nunca puede cambiar la altura de la fila de arriba:
// la card del patrimonio y la gráfica de Valor conservan su alto, y el panel
// se despliega DEBAJO de las dos ocupando toda la fila (`col-span-full`).
//
// Los datos son exactamente los que ya producía el motor (`attributeYtd` vía
// `useDashboardData`): ganancia por cuenta = hoy − arranque − movimientos,
// con las transferencias entre cuentas propias NETEADAS (no son rendimiento).
// Nada se recalcula acá; `lib/ytdBreakdownView.js` solo ordena, lista las
// transferencias y comprueba que las filas sumen el YTD del encabezado.
//
// La altura se anima con `grid-template-rows` (0fr → 1fr), sin medir nada en
// JS y sin `position: absolute`. Y el panel se DESMONTA al terminar de
// cerrarse, a propósito: medido en Chromium, una fila del grid con altura cero
// deja igual la canaleta de 24px debajo de las cards (324px contra 300px), y
// un margen negativo no la quita. Mientras está abierto o cerrándose ocupa su
// fila; cerrado del todo, no existe y la fila de arriba queda como si nunca
// hubiera estado. Con `prefers-reduced-motion` se monta y desmonta al instante.

const START_SRC_LABEL = {
  api: { es: 'medido', en: 'measured' },
  sheet: { es: 'hoja', en: 'sheet' },
  flat: { es: 'estimado', en: 'estimated' },
  flatprice: { es: 'sin precios: plano', en: 'no prices: flat' },
  new: { es: 'abrió este año', en: 'opened this year' },
  nav: { es: 'NAV broker', en: 'broker NAV' },
  derived: { es: 'despejado', en: 'derived' },
  mixed: { es: 'mixto', en: 'mixed' },
  none: { es: 'sin fuente', en: 'no source' },
}

const ANCHOR_SRC_LABEL = {
  daily: { es: 'observado', en: 'observed' },
  manual: { es: 'transcrito', en: 'transcribed' },
  backfill: { es: 'derivado', en: 'derived' },
  ibkr: { es: 'NAV broker', en: 'broker NAV' },
  ibkr_quarterly: { es: 'trimestre transcrito', en: 'transcribed quarter' },
}

const TONE_COLOR = {
  positive: 'var(--accent-green)',
  negative: 'var(--text-negative)',
  neutral: 'var(--text-muted)',
}

// Los tres términos por cuenta (arranque / hoy / movimientos) más el ancla del
// portafolio, para la rama de RECHAZO: cuando el motor se niega a mostrar el
// reparto, esto es lo único que dice qué cuenta no cuadra (FASE IB/KJ). Movido
// textual desde NetWorthCard: el panel es su único consumidor.
function AccountTermsTable({ accounts, anchor, anchorTs, anchorSrc, measuredTs, unmappedStart = 0, unmappedCount = 0, lang, cur }) {
  const L = lang === 'es' ? 'es' : 'en'
  return (
    <div className="mt-2">
      <div className="space-y-2">
        {[...accounts]
          .sort((x, y) => Math.abs((y.end ?? 0) - (y.start ?? 0) - (y.flow ?? 0)) - Math.abs((x.end ?? 0) - (x.start ?? 0) - (x.flow ?? 0)))
          .map((a) => {
            const gain = (a.end ?? 0) - (a.start ?? 0) - (a.flow ?? 0)
            const s = signOf(gain)
            return (
              <div key={a.name} className="pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] leading-tight min-w-0" style={{ color: 'var(--text-secondary)' }}>
                    {a.name}{a.real ? <span style={{ color: 'var(--accent-blue)' }}>*</span> : ''}
                    {START_SRC_LABEL[a.src] && (
                      <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        ({START_SRC_LABEL[a.src][L]}{a.srcDate ? ` · ${formatDate(`${a.srcDate}T00:00:00Z`)}` : ''})
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: TONE_COLOR[s.tone] }}>
                    {s.sign}{formatCurrency(Math.abs(s.value), cur)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {[
                    { k: 'start', label: lang === 'es' ? 'Arranque' : 'Start', v: a.start ?? 0 },
                    { k: 'end', label: lang === 'es' ? 'Hoy' : 'Now', v: a.end ?? 0 },
                    { k: 'flow', label: lang === 'es' ? 'Movimientos' : 'Flows', v: a.flow ?? 0 },
                  ].map((term) => (
                    <span key={term.k} className="flex items-baseline gap-1">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{term.label}</span>
                      <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(term.v, cur)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Arranque del portafolio' : 'Portfolio year-start'}
          {anchorTs ? <span className="ml-1 text-[10px]">({formatDate(new Date(anchorTs))})</span> : null}
          {ANCHOR_SRC_LABEL[anchorSrc] ? <span className="ml-1 text-[10px]">· {ANCHOR_SRC_LABEL[anchorSrc][L]}</span> : null}
        </span>
        <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(anchor ?? 0, cur)}</span>
      </div>
      {unmappedStart ? (
        <div className="flex items-baseline justify-between gap-2 mt-1">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {lang === 'es' ? `Arranque sin cuenta (${unmappedCount})` : `Start with no account (${unmappedCount})`}
          </span>
          <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(unmappedStart, cur)}</span>
        </div>
      ) : null}
      {measuredTs && anchorTs && new Date(measuredTs).toISOString().slice(0, 10) !== new Date(anchorTs).toISOString().slice(0, 10) && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es'
            ? `Los arranques por cuenta se midieron el ${formatDate(new Date(measuredTs))}, no en la fecha del ancla.`
            : `Per-account starts were measured on ${formatDate(new Date(measuredTs))}, not on the anchor's date.`}
        </p>
      )}
      {accounts.some((a) => a.real) && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--accent-blue)' }}>*</span>{' '}
          {lang === 'es' ? 'arranque real del broker: nunca se ajusta.' : 'real broker year-start: never adjusted.'}
        </p>
      )}
    </div>
  )
}

// El CTA que abre y cierra la sección. Vive en NetWorthCard (junto al YTD),
// pero se define acá para que el texto, el chevron y los atributos ARIA tengan
// UNA sola definición: el botón y la región a la que apunta no pueden
// desincronizarse si nacen del mismo archivo.
export const YTD_BREAKDOWN_ID = 'ytd-breakdown'
// Igual a --dur-base (220ms) más un colchón: el desmontaje espera a que la
// transición de cierre termine. Si --dur-base cambia, esto cambia con él.
export const CLOSE_MS = 240

export function YtdBreakdownToggle({ open, onToggle, lang }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!!open}
      aria-controls={YTD_BREAKDOWN_ID}
      // Área de toque cómoda (>= 32px de alto con el padding) sin que el
      // botón pese más que la cifra: texto pequeño, sin relleno de color.
      className="inline-flex items-center gap-1 -ml-1.5 px-1.5 py-1.5 min-h-[32px] rounded-md text-xs font-medium"
      style={{ color: 'var(--accent-blue)' }}
    >
      <span>{open
        ? (lang === 'es' ? 'Ocultar desglose' : 'Hide breakdown')
        : (lang === 'es' ? 'Ver desglose del YTD' : 'See YTD breakdown')}</span>
      <ChevronDown aria-hidden="true" size={14} strokeWidth={2.25}
        className={`transition-transform ${open ? 'rotate-180' : 'rotate-0'}`}
        style={{ transitionDuration: 'var(--dur-base)', transitionTimingFunction: 'var(--ease-out)' }} />
    </button>
  )
}

export default function YtdBreakdownSection({
  open, onClose, lang,
  ytdChange, ytdBreakdown, ytdBreakdownReason, ytdBreakdownDetail, ytdDegradedAccounts,
  ytdStartValue = null, ytdStartTs = null, ytdStartSrc = null, ytdCalIgnored = 0,
}) {
  const L = lang === 'es' ? 'es' : 'en'
  const cur = getBaseCurrency()
  // `rendered`: el nodo existe (abierto, o cerrándose). `shown`: la fila está
  // en 1fr. Se separan para que la transición corra en las dos direcciones:
  // al abrir se monta a 0fr y pasa a 1fr en el siguiente frame; al cerrar pasa
  // a 0fr y se desmonta cuando la transición terminó.
  const [rendered, setRendered] = useState(!!open)
  const [shown, setShown] = useState(false)
  const closeTimer = useRef(null)
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (open) {
      setRendered(true)
      if (reduced || typeof requestAnimationFrame !== 'function') { setShown(true); return undefined }
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    setShown(false)
    if (reduced) { setRendered(false); return undefined }
    closeTimer.current = setTimeout(() => { setRendered(false); closeTimer.current = null }, CLOSE_MS)
    return () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  }, [open])
  const hasBreakdown = !!ytdBreakdown && Array.isArray(ytdBreakdown.groups) && ytdBreakdown.groups.length > 0
  const view = buildYtdBreakdownView({ breakdown: ytdBreakdown, ytdChange, degradedAccounts: ytdDegradedAccounts })
  const [showRefusalDetail, setShowRefusalDetail] = useState(false)

  const refusalHeadline = (() => {
    if (!ytdBreakdownReason) return ''
    const raw = attributionRefusalText(ytdBreakdownReason, L)
    const short = raw.replace(/\s*\([^)]*\)\s*$/, '')
    return short.charAt(0).toUpperCase() + short.slice(1)
  })()

  // La etiqueta de honestidad del reparto. "Exacto" no se imprime: es el caso
  // normal y una insignia de "todo bien" en cada apertura sería ruido. Solo se
  // dice cuando el reparto es un estimado o cuando NO cuadra con el YTD.
  const statusLabel = view.reconciliation.status === 'estimated'
    ? (lang === 'es' ? 'Estimado' : 'Estimated')
    : view.reconciliation.status === 'incomplete'
      ? (lang === 'es' ? 'Datos incompletos' : 'Incomplete data')
      : null

  const titleId = `${YTD_BREAKDOWN_ID}-title`

  if (!rendered) return null

  return (
    // `col-span-full` = grid-column: 1 / -1. Hermana de las dos cards, nunca
    // hija de una.
    <div
      className="col-span-full ytd-disclosure"
      data-open={shown ? 'true' : 'false'}
      data-testid="ytd-disclosure"
    >
      <div>
        <CardBoundary id="YTD-01">
        <section
          id={YTD_BREAKDOWN_ID}
          role="region"
          aria-labelledby={titleId}
          className="card p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-1 min-w-0">
              <h3 id={titleId} className="card-title">
                {lang === 'es' ? 'Desglose del rendimiento YTD' : 'YTD performance breakdown'}
              </h3>
              <InfoTip text={lang === 'es'
                ? 'Por cada cuenta: valor de hoy menos valor al inicio del año, restando el dinero que metiste o sacaste. Los depósitos nunca cuentan como ganancia, y el dinero que pasa de una cuenta tuya a otra tampoco. El % es el retorno de esa cuenta. Las cuentas suman el YTD de la tarjeta de patrimonio.'
                : 'Per account: today\'s value minus its year-start value, less any money you moved in or out. Deposits never count as gains, and neither does money moved between your own accounts. The % is that account\'s return. The accounts add up to the YTD on the net worth card.'} />
              {statusLabel && (
                <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--alert-warn-icon)', backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)' }}>
                  {statusLabel}
                </span>
              )}
            </div>
            <button type="button" onClick={onClose}
              className="text-xs shrink-0 px-1.5 py-1 min-h-[32px] rounded-md"
              style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'Ocultar' : 'Hide'}
            </button>
          </div>

          {/* Rama de RECHAZO: el motor no pudo repartir. El YTD de arriba sigue
              siendo correcto; lo que falta es el reparto, y el panel dice por qué
              en vez de quedarse en blanco (FASE HT3, IC3). */}
          {!hasBreakdown && (
            <div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {refusalHeadline || (lang === 'es' ? 'Todavía no hay desglose' : 'No breakdown yet')}
                {'. '}
                <span style={{ color: 'var(--text-muted)' }}>
                  {lang === 'es'
                    ? 'Tu YTD sigue siendo correcto: lo que falta es el reparto entre cuentas.'
                    : 'Your YTD is still correct: what is missing is the split across accounts.'}
                </span>
              </p>
              {ytdBreakdownReason === 'unexplained-too-large' && ytdBreakdownDetail
                && isFinite(ytdBreakdownDetail.unexplained) && isFinite(ytdBreakdownDetail.cap) && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                  {[
                    { k: 'diff', label: lang === 'es' ? 'Diferencia' : 'Off by', value: Math.abs(ytdBreakdownDetail.unexplained) },
                    { k: 'cap', label: lang === 'es' ? 'Tolerancia' : 'Tolerance', value: Math.abs(ytdBreakdownDetail.cap) },
                  ].map((s) => (
                    <span key={s.k} className="flex items-baseline gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                      <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(s.value, cur)}</span>
                    </span>
                  ))}
                </div>
              )}
              {ytdBreakdownReason === 'unexplained-too-large' && (
                <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {lang === 'es'
                    ? 'Chispu regenera el historial solo, sin que tengas que hacer nada. Si el desglose sigue sin aparecer, el detalle de abajo dice qué cuenta no cuadra.'
                    : 'Chispu regenerates history on its own, with nothing for you to do. If the breakdown still does not appear, the detail below says which account does not add up.'}
                </p>
              )}
              {Array.isArray(ytdBreakdownDetail?.accounts) && ytdBreakdownDetail.accounts.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowRefusalDetail((v) => !v)}
                    aria-expanded={showRefusalDetail}
                    className="text-[11px] underline decoration-dotted underline-offset-2 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}>
                    {showRefusalDetail
                      ? (lang === 'es' ? 'Ocultar detalle por cuenta' : 'Hide per-account detail')
                      : (lang === 'es' ? 'Ver detalle por cuenta' : 'See per-account detail')}
                  </button>
                  {showRefusalDetail && (
                    <AccountTermsTable accounts={ytdBreakdownDetail.accounts} anchor={ytdBreakdownDetail.anchor} anchorTs={ytdBreakdownDetail.anchorTs} anchorSrc={ytdBreakdownDetail.anchorSrc} measuredTs={ytdBreakdownDetail.measuredTs} unmappedStart={ytdBreakdownDetail.unmappedStart} unmappedCount={ytdBreakdownDetail.unmappedCount}
                      lang={lang} cur={cur} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Una fila por CUENTA, ordenadas por impacto absoluto. Todas se
              listan, incluidas las que no rindieron nada: una fila omitida y una
              fila rota se ven igual desde afuera (FASE GR). */}
          {hasBreakdown && (
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <th scope="col" className="text-left font-medium pb-1.5">{lang === 'es' ? 'Cuenta' : 'Account'}</th>
                  <th scope="col" className="text-right font-medium pb-1.5 pl-3 whitespace-nowrap">{lang === 'es' ? 'Retorno YTD' : 'YTD return'}</th>
                  <th scope="col" className="text-right font-medium pb-1.5 pl-3 whitespace-nowrap">{lang === 'es' ? 'Ganancia / pérdida' : 'Gain / loss'}</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((g) => {
                  const gain = signOf(g.gain)
                  const ret = g.ret != null && isFinite(g.ret) ? signOf(g.ret) : null
                  return (
                    <tr key={g.key} style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <td className="py-1.5 pr-2 min-w-0" style={{ color: g.isUnexplained ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                        <span className="block truncate">
                          {g.isUnexplained
                            ? (lang === 'es' ? 'Sin atribuir' : 'Unattributed')
                            : (g.name || (lang === 'es' ? 'Sin institución' : 'No institution'))}
                        </span>
                      </td>
                      <td className="py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap"
                        style={{ color: ret ? TONE_COLOR[ret.tone] : 'var(--text-muted)' }}>
                        {ret ? `${ret.arrow ? ret.arrow + ' ' : ''}${ret.sign}${Math.abs(ret.value).toFixed(2)}%` : '-'}
                      </td>
                      <td className="py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap"
                        style={{ color: TONE_COLOR[gain.tone] }}>
                        {gain.sign}{formatCurrency(Math.abs(gain.value), cur)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {isFinite(view.reconciliation.target) && (
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--border-primary)' }}>
                    <td className="pt-2 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {lang === 'es' ? 'Total YTD' : 'YTD total'}
                    </td>
                    <td className="pt-2" />
                    <td className="pt-2 text-right font-mono tabular-nums text-xs font-medium"
                      style={{ color: TONE_COLOR[signOf(view.reconciliation.target).tone] }}>
                      {signOf(view.reconciliation.target).sign}{formatCurrency(Math.abs(view.reconciliation.target), cur)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}

          {/* Cuando NO cuadra, decirlo con el número: nunca esconder la diferencia. */}
          {hasBreakdown && view.reconciliation.status === 'incomplete' && isFinite(view.reconciliation.target) && (
            <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
              {lang === 'es'
                ? `Las filas suman ${formatCurrency(view.reconciliation.sum, cur)} y el YTD de la tarjeta es ${formatCurrency(view.reconciliation.target, cur)}: el reparto no cuadra y se muestra tal cual.`
                : `The rows add up to ${formatCurrency(view.reconciliation.sum, cur)} while the card's YTD is ${formatCurrency(view.reconciliation.target, cur)}: the split does not reconcile and is shown as is.`}
            </p>
          )}

          {/* Transferencias entre cuentas propias: neteadas, y por eso una fila
              puede diferir de la gráfica escopada de su cuenta (FASE IJ). */}
          {hasBreakdown && (
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? 'Las transferencias entre cuentas propias se netean y no se contabilizan como rendimiento.'
                : 'Transfers between your own accounts are netted out and never counted as performance.'}
              {view.internal.length > 0 && (
                <>
                  {' '}
                  {lang === 'es' ? 'Transferencias internas neteadas: ' : 'Netted internal transfers: '}
                  <span className="font-mono tabular-nums">
                    {view.internal.map((t) => `${t.name} ${t.amount >= 0 ? '+' : '−'}${formatCurrency(Math.abs(t.amount), cur)}`).join(' · ')}
                  </span>
                  {'.'}
                </>
              )}
            </p>
          )}

          {/* Pie de metodología: el ancla del año, dicha de frente (FASE NL). */}
          {hasBreakdown && ytdStartValue != null && isFinite(ytdStartValue) && ytdStartValue > 0 && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'Valor inicial del año: ' : 'Year-start value: '}
              <span className="font-mono tabular-nums">{formatCurrency(ytdStartValue, cur)}</span>
              {ytdStartTs ? ` · ${formatDate(new Date(ytdStartTs))}` : ''}
              {ANCHOR_SRC_LABEL[ytdStartSrc] ? ` · ${lang === 'es' ? 'cálculo' : 'value'} ${ANCHOR_SRC_LABEL[ytdStartSrc][L]}` : ''}
              {'.'}
            </p>
          )}
          {hasBreakdown && ytdCalIgnored > 0 && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
              {lang === 'es'
                ? `Se está ignorando ${ytdCalIgnored === 1 ? 'una calibración' : `${ytdCalIgnored} calibraciones`} de cuenta: el % que copiaste no cuadra con el valor que tu broker reporta para esa fecha. Vuelve a copiarlo desde tu broker para usarlo.`
                : `Ignoring ${ytdCalIgnored === 1 ? 'one account calibration' : `${ytdCalIgnored} account calibrations`}: the % you copied does not match the value your broker reports for that date. Copy it again from your broker to use it.`}
            </p>
          )}
          {hasBreakdown && Array.isArray(ytdDegradedAccounts) && ytdDegradedAccounts.length > 0 && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? `Arranque de año ESTIMADO en ${ytdDegradedAccounts.join(', ')}: su fila puede no coincidir con su propia gráfica.`
                : `Year-start is ESTIMATED for ${ytdDegradedAccounts.join(', ')}: their row may not match their own chart.`}
            </p>
          )}
          {hasBreakdown && view.rows.some((g) => g.isUnexplained) && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? 'Cada cuenta muestra su propio número. Lo que no calza con el total va aparte, sin repartirlo entre las cuentas: viene del valor de arranque estimado de las cuentas sin historial del broker.'
                : 'Each account shows its own figure. Whatever does not match the total is listed separately rather than spread across accounts: it comes from the estimated year-start of accounts without broker history.'}
            </p>
          )}
        </section>
        </CardBoundary>
      </div>
    </div>
  )
}
