// FASE IE. El correo MENSUAL y, desde FASE IE6, el ANUAL: cómo cerró el
// período y cómo va el año, más el estado del mercado en esa misma ventana.
// Inglés siempre (FASE HX2).
//
// Los dos comparten un solo armador (`buildPeriodBriefEmail`) porque lo único
// que cambia entre ellos son cuatro etiquetas: una tercera copia de este
// archivo es exactamente cómo una se queda atrás, la lección que este repo ya
// documenta para componentes y para los generadores de reporte.
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

// "July 2026", o "August 2026 (to date)" cuando el mes cubierto aún corre (el
// caso del botón de prueba a mitad de mes; el envío real sale el día 1 y
// siempre cubre un mes cerrado).
export function monthLabelFor(refDate, now = refDate) {
  const name = refDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const sameMonth = refDate.getUTCFullYear() === now.getUTCFullYear() && refDate.getUTCMonth() === now.getUTCMonth()
  return sameMonth ? `${name} (to date)` : name
}

// "2026", o "2026 (to date)" cuando el año cubierto aún corre (el caso del
// botón de prueba a mitad de año; el envío real sale el 1 de enero y siempre
// cubre un año cerrado).
export function yearLabelFor(refDate, now = refDate) {
  const y = refDate.getUTCFullYear()
  return y === now.getUTCFullYear() ? `${y} (to date)` : `${y}`
}

// Lo único que separa al mensual del anual: cuatro etiquetas y el nombre del
// adjunto. Todo lo demás (filas, reglas de omisión, mercado, pie) es común.
const KINDS = {
  monthly: {
    title: 'Chispudo Monthly',
    subjectPrefix: 'Chispudo Monthly',
    heading: 'Your month',
    periodRow: 'This month',
    sheetLabel: 'your monthly spreadsheet (Excel)',
    reportLabel: 'your year-to-date report (PDF)',
    quietMarket: 'No standout moves this month across the indexes tracked here.',
    reason: 'You get this because you enabled monthly notifications in Chispudo.',
  },
  annual: {
    title: 'Chispudo Annual',
    subjectPrefix: 'Chispudo Annual',
    heading: 'Your year',
    periodRow: 'This year',
    sheetLabel: 'your full-year spreadsheet (Excel)',
    reportLabel: 'your year report (PDF)',
    quietMarket: 'No standout moves this year across the indexes tracked here.',
    reason: 'You get this because you enabled annual notifications in Chispudo.',
  },
}

export function monthlyBriefSubject(monthLabel) {
  return `${KINDS.monthly.subjectPrefix} · ${monthLabel}`
}

export function annualBriefSubject(yearLabel) {
  return `${KINDS.annual.subjectPrefix} · ${yearLabel}`
}

/**
 * @param {object} input
 * @param {'monthly'|'annual'} input.kind
 * @param {string} input.periodLabel     p.ej. "July 2026" o "2026"
 * @param {object} input.portfolio       { netWorth, periodAbs, periodPct, ytdAbs, ytdPct,
 *                                         incomeAbs, incomeCount, currency, asOf }
 * @param {object} [input.market]        salida de buildMarketBrief() en esa ventana
 * @param {object} [input.attachmentsInfo] { report, spreadsheet, missingMonths[] }
 */
export function buildPeriodBriefEmail({ kind = 'monthly', periodLabel, portfolio, market, attachmentsInfo = {} }) {
  const k = KINDS[kind] || KINDS.monthly
  const cur = portfolio?.currency || 'USD'
  const sections = []

  // ── Tu período ──
  const rows = [['Net worth', fmtMoney(portfolio?.netWorth, cur), portfolio?.asOf ? `as of ${portfolio.asOf}` : '']]
  if (portfolio?.periodPct != null || portfolio?.periodAbs != null) {
    rows.push([k.periodRow, combo(portfolio.periodAbs, portfolio.periodPct, cur), ''])
  }
  // En el anual, "el año" y "el período" son lo mismo: repetir la fila diría
  // dos veces la misma cifra bajo dos nombres distintos.
  if (kind !== 'annual' && (portfolio?.ytdPct != null || portfolio?.ytdAbs != null)) {
    rows.push(['Year to date', combo(portfolio.ytdAbs, portfolio.ytdPct, cur), ''])
  }
  if (portfolio?.incomeAbs > 0) {
    rows.push(['Income collected', fmtMoney(portfolio.incomeAbs, cur),
      portfolio.incomeCount ? `${portfolio.incomeCount} payment${portfolio.incomeCount === 1 ? '' : 's'}` : ''])
  }

  const paragraphs = []
  if (portfolio?.periodPct == null && portfolio?.ytdPct == null) {
    paragraphs.push('Not enough history yet to measure a return. Keep the app open a few days and this fills in on its own.')
  }
  const attached = []
  if (attachmentsInfo.report) attached.push(k.reportLabel)
  if (attachmentsInfo.spreadsheet) attached.push(k.sheetLabel)
  if (attached.length > 0) paragraphs.push(`Attached: ${attached.join(' and ')}.`)
  if (attachmentsInfo.spreadsheet && attachmentsInfo.missingMonths?.length > 0) {
    // El caché mensual lo puebla la app al abrir el Spreadsheet: un mes sin
    // doc va en blanco en el archivo, y esto explica cómo llenarlo, en vez de
    // inventar el número del lado del servidor.
    paragraphs.push('Some months in the spreadsheet are blank: open the Spreadsheet tab in the app once and they fill in on their own.')
  }

  sections.push({ heading: k.heading, rows, paragraphs, cta: { label: 'Open Chispudo', url: `${APP_URL}/dashboard` } })

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
      paragraphs: market.context?.length ? market.context : [k.quietMarket],
    })
  }

  const { html, text } = renderEmail({
    title: k.title,
    subtitle: periodLabel,
    sections,
    manageUrl: `${APP_URL}/dashboard`,
    reason: k.reason,
  })

  return { subject: `${k.subjectPrefix} · ${periodLabel}`, html, text }
}

// Envolturas por cadencia: el nombre dice cuál es, el motor es uno solo.
export function buildMonthlyBriefEmail({ monthLabel, portfolio, market, attachmentsInfo }) {
  return buildPeriodBriefEmail({
    kind: 'monthly', periodLabel: monthLabel, market, attachmentsInfo,
    portfolio: portfolio ? { ...portfolio, periodAbs: portfolio.monthAbs, periodPct: portfolio.monthPct } : portfolio,
  })
}

export function buildAnnualBriefEmail({ yearLabel, portfolio, market, attachmentsInfo }) {
  return buildPeriodBriefEmail({
    kind: 'annual', periodLabel: yearLabel, market, attachmentsInfo,
    portfolio: portfolio ? { ...portfolio, periodAbs: portfolio.yearAbs, periodPct: portfolio.yearPct } : portfolio,
  })
}
