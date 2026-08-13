// FASE IE. El correo mensual: cómo cerró el mes y cómo va el año, más el
// estado del mercado en ventana mensual. Inglés siempre (FASE HX2).
//
// Mismas reglas que el semanal (lib/weeklyBriefEmail.js): este módulo NO
// calcula retornos, solo formatea cifras que llegan de los mismos motores del
// dashboard; y todo dato ausente se OMITE en vez de imprimirse en cero.

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

function fmtLevel(v) {
  if (v == null || !isFinite(v)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v)
}

function combo(abs, pct, currency) {
  const p = fmtPct(pct)
  if (abs == null && p == null) return '-'
  if (abs == null) return p
  return p ? `${fmtSigned(abs, currency)} (${p})` : fmtSigned(abs, currency)
}

// "July 2026", o "August 2026 (to date)" cuando el mes cubierto aún corre (el
// caso del botón de prueba a mitad de mes; el envío real sale el día 1 y
// siempre cubre un mes cerrado).
export function monthLabelFor(refDate, now = refDate) {
  const name = refDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const sameMonth = refDate.getUTCFullYear() === now.getUTCFullYear() && refDate.getUTCMonth() === now.getUTCMonth()
  return sameMonth ? `${name} (to date)` : name
}

export function monthlyBriefSubject(monthLabel) {
  return `Chispudo Monthly · ${monthLabel}`
}

/**
 * @param {object} input
 * @param {string} input.monthLabel      p.ej. "July 2026"
 * @param {object} input.portfolio       { netWorth, monthAbs, monthPct, ytdAbs, ytdPct,
 *                                         incomeAbs, incomeCount, currency, asOf }
 * @param {object} [input.market]        salida de buildMarketBrief() en ventana mensual
 * @param {object} [input.attachmentsInfo] { report: bool, spreadsheet: bool, missingMonths: string[] }
 */
export function buildMonthlyBriefEmail({ monthLabel, portfolio, market, attachmentsInfo = {} }) {
  const cur = portfolio?.currency || 'USD'
  const sections = []

  // ── Tu mes ──
  const rows = [['Net worth', fmtMoney(portfolio?.netWorth, cur), portfolio?.asOf ? `as of ${portfolio.asOf}` : '']]
  if (portfolio?.monthPct != null || portfolio?.monthAbs != null) {
    rows.push(['This month', combo(portfolio.monthAbs, portfolio.monthPct, cur), ''])
  }
  if (portfolio?.ytdPct != null || portfolio?.ytdAbs != null) {
    rows.push(['Year to date', combo(portfolio.ytdAbs, portfolio.ytdPct, cur), ''])
  }
  if (portfolio?.incomeAbs > 0) {
    rows.push(['Income collected', fmtMoney(portfolio.incomeAbs, cur),
      portfolio.incomeCount ? `${portfolio.incomeCount} payment${portfolio.incomeCount === 1 ? '' : 's'}` : ''])
  }

  const paragraphs = []
  if (portfolio?.monthPct == null && portfolio?.ytdPct == null) {
    paragraphs.push('Not enough history yet to measure a return. Keep the app open a few days and this fills in on its own.')
  }
  const attached = []
  if (attachmentsInfo.report) attached.push('your year-to-date report (PDF)')
  if (attachmentsInfo.spreadsheet) attached.push('your monthly spreadsheet (Excel)')
  if (attached.length > 0) paragraphs.push(`Attached: ${attached.join(' and ')}.`)
  if (attachmentsInfo.spreadsheet && attachmentsInfo.missingMonths?.length > 0) {
    // El caché mensual lo puebla la app al abrir el Spreadsheet: un mes sin
    // doc va en blanco en el archivo, y esto explica cómo llenarlo, en vez de
    // inventar el número del lado del servidor.
    paragraphs.push('Some months in the spreadsheet are blank: open the Spreadsheet tab in the app once and they fill in on their own.')
  }

  sections.push({ heading: 'Your month', rows, paragraphs, cta: { label: 'Open Chispudo', url: `${APP_URL}/dashboard` } })

  // ── Mercado ──
  if (market?.rows?.length) {
    const marketRows = market.rows.map((r) => {
      // Un índice es un NIVEL, no un precio: solo la cripto cotiza en dólares.
      const value = r.kind === 'crypto' ? fmtMoney(r.last, 'USD') : fmtLevel(r.last)
      return [r.label, value, fmtPct(r.changePct) || '']
    })
    sections.push({
      heading: 'Market brief',
      rows: marketRows,
      paragraphs: market.context?.length
        ? market.context
        : ['No standout moves this month across the indexes tracked here.'],
    })
  }

  const { html, text } = renderEmail({
    title: 'Chispudo Monthly',
    subtitle: monthLabel,
    sections,
    manageUrl: `${APP_URL}/dashboard`,
    reason: 'You get this because you enabled monthly notifications in Chispudo.',
  })

  return { subject: monthlyBriefSubject(monthLabel), html, text }
}
