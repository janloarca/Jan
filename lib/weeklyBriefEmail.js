// FASE HZ. El correo semanal: cómo le fue al usuario esta semana y en el año,
// más el estado del mercado. Inglés siempre (FASE HX2).
//
// Regla que hereda del reporte: este módulo NO calcula retornos. Recibe las
// cifras ya resueltas por los mismos motores que alimentan la app (Modified
// Dietz sobre snapshots archivados) y solo las formatea. Un correo que
// recalculara por su cuenta terminaría contradiciendo al dashboard, que es
// exactamente la clase de bug que costó media sesión arreglar en los reportes.
//
// Todo dato ausente se OMITE en vez de imprimirse en cero: una semana sin
// ancla confiable dice "not enough history yet", no "+0.00%".

import { renderEmail } from './emailLayout'

const APP_URL = 'https://chispu.xyz'

function fmtMoney(v, currency = 'USD') {
  if (v == null || !isFinite(v)) return '-'
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(v))
  return v < 0 ? `(${abs})` : abs
}

function fmtSigned(v, currency = 'USD') {
  if (v == null || !isFinite(v)) return '-'
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(v))
  return v < 0 ? `-${abs}` : `+${abs}`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

// Un nivel de índice lleva SIEMPRE dos decimales: "26,752.5" al lado de
// "7,794.93" rompe la columna aunque el borde derecho esté perfecto.
function fmtLevel(v) {
  if (v == null || !isFinite(v)) return '-'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function combo(abs, pct, currency) {
  const p = fmtPct(pct)
  if (abs == null && p == null) return '-'
  if (abs == null) return p
  return p ? `${fmtSigned(abs, currency)} (${p})` : fmtSigned(abs, currency)
}

export function weeklyBriefSubject(weekLabel) {
  return `Chispudo Weekly · ${weekLabel}`
}

/**
 * @param {object} input
 * @param {string} input.weekLabel        p.ej. "Aug 10-16, 2026"
 * @param {object} input.portfolio        { netWorth, weekAbs, weekPct, ytdAbs, ytdPct,
 *                                          incomeAbs, incomeCount, movers:[{symbol,pct}],
 *                                          currency, asOf }
 * @param {object} [input.market]         salida de buildMarketBrief()
 * @param {boolean} [input.hasAttachment] si se adjuntó el reporte
 */
export function buildWeeklyBriefEmail({ weekLabel, portfolio, market, hasAttachment = false }) {
  const cur = portfolio?.currency || 'USD'
  const sections = []

  // ── Tu semana ──
  const rows = [['Net worth', fmtMoney(portfolio?.netWorth, cur), portfolio?.asOf ? `as of ${portfolio.asOf}` : '']]
  if (portfolio?.weekPct != null || portfolio?.weekAbs != null) {
    rows.push(['This week', combo(portfolio.weekAbs, portfolio.weekPct, cur), ''])
  }
  if (portfolio?.ytdPct != null || portfolio?.ytdAbs != null) {
    rows.push(['Year to date', combo(portfolio.ytdAbs, portfolio.ytdPct, cur), ''])
  }
  if (portfolio?.incomeAbs > 0) {
    rows.push(['Income collected', fmtMoney(portfolio.incomeAbs, cur),
      portfolio.incomeCount ? `${portfolio.incomeCount} payment${portfolio.incomeCount === 1 ? '' : 's'}` : ''])
  }
  const movers = (portfolio?.movers || []).filter((m) => m && m.symbol && isFinite(m.pct))
  if (movers.length > 0) {
    rows.push(['Movers this week', movers.map((m) => `${m.symbol} ${fmtPct(m.pct)}`).join('  ·  '), ''])
  }

  const paragraphs = []
  if (portfolio?.weekPct == null && portfolio?.ytdPct == null) {
    paragraphs.push('Not enough history yet to measure a return. Keep the app open a few days and this fills in on its own.')
  }
  if (hasAttachment) paragraphs.push('Your full report is attached as a PDF.')

  sections.push({ heading: 'Your week', rows, paragraphs, cta: { label: 'Open Chispudo', url: `${APP_URL}/dashboard` } })

  // ── Mercado ──
  if (market?.rows?.length) {
    const marketRows = market.rows.map((r) => {
      // Un índice es un NIVEL, no un precio: "$6,340.12" para el S&P 500 es
      // simplemente falso. Solo la cripto cotiza en dólares.
      const value = r.kind === 'crypto' ? fmtMoney(r.last, 'USD') : fmtLevel(r.last)
      return [r.label, value, fmtPct(r.changePct) || '']
    })
    sections.push({
      heading: 'Market brief',
      rows: marketRows,
      paragraphs: market.context?.length
        ? market.context
        : ['No standout moves this week across the indexes tracked here.'],
    })
  }

  const { html, text } = renderEmail({
    title: 'Chispudo Weekly',
    subtitle: weekLabel,
    sections,
    manageUrl: `${APP_URL}/dashboard`,
    reason: 'You get this because you enabled weekly notifications in Chispudo.',
  })

  return { subject: weeklyBriefSubject(weekLabel), html, text }
}

// Etiqueta del período: "Aug 10-16, 2026", o cruzando mes "Jul 27 - Aug 2, 2026".
export function weekLabelFor(endDate) {
  const end = new Date(endDate)
  const start = new Date(end.getTime() - 6 * 86400000)
  const m = (d) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = (d) => d.getUTCDate()
  const year = end.getUTCFullYear()
  return m(start) === m(end)
    ? `${m(end)} ${day(start)}-${day(end)}, ${year}`
    : `${m(start)} ${day(start)} - ${m(end)} ${day(end)}, ${year}`
}
