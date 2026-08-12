// FASE HT. El PDF descargable, reescrito como ESTADO DE CUENTA: fondo blanco,
// tinta negra/gris, negativos en paréntesis contables, secciones numeradas,
// "Página X de Y", metadata del documento y una nota de metodología. Es el
// mismo estándar que FASE FK ya fijó para el modal de imprimir ("más
// profesional y sin colores"); antes este archivo era un screenshot oscuro
// del dashboard con 8 colores y CÁLCULOS PROPIOS que divergían de las
// tarjetas (el "+1148.8%" y el 0% de VITALI documentados en lib/reportData.js).
//
// TODOS los números salen de buildReportData (lib/reportData.js): este
// archivo solo dibuja. Si un dato no está en reportData, no se imprime.

import { buildReportData, regionLabel } from './reportData'
import { categoryLabel } from '../components/dashboard/utils'

const INK = [17, 24, 39]
const GRAY = [107, 114, 128]
const FAINT = [156, 163, 175]
const RULE = [209, 213, 219]
const BAR_BG = [229, 231, 235]
const BAR_FG = [55, 65, 81]

export async function generateReport({
  items, snapshots, transactions,
  netWorth, totalAssets, lang,
  returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdBreakdown,
  annualDividends, estimatedAnnualIncome,
  profileName, baseCurrency = 'USD', convert,
  period = 'ytd',
}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  const t = (es, en) => lang === 'es' ? es : en
  const locale = lang === 'es' ? 'es-GT' : 'en-US'
  const now = new Date()

  const data = buildReportData({
    items, transactions, snapshots,
    netWorth, totalAssets,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdBreakdown,
    annualDividends, estimatedAnnualIncome,
    baseCurrency, convert, profileName, period, now,
  })

  // ── formato ──
  const fmtRaw = (v) => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, maximumFractionDigits: 2 }).format(Math.abs(v || 0))
  // Convención contable: los negativos van entre paréntesis, nunca en color.
  const fmt = (v) => (v < 0 ? `(${fmtRaw(v)})` : fmtRaw(v))
  const fmtPct = (v) => v == null ? '-' : (v < 0 ? `(${Math.abs(v).toFixed(2)}%)` : `+${v.toFixed(2)}%`)
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const dateStr = now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })

  const periodLabel = (() => {
    const k = data.meta.periodKind
    if (k === 'month') return now.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    if (k === 'quarter') return `${t('Trimestre', 'Quarter')} ${Math.floor(now.getMonth() / 3) + 1}, ${now.getFullYear()}`
    if (k === 'ytd') return t(`Año ${now.getFullYear()} al ${dateStr}`, `Year ${now.getFullYear()} through ${dateStr}`)
    return t('Desde el inicio', 'Since inception')
  })()

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 18
  const CW = pageW - M * 2

  doc.setProperties({
    title: `${t('Reporte de Portafolio', 'Portfolio Report')}${profileName ? ` - ${profileName}` : ''} - ${now.toISOString().slice(0, 10)}`,
    subject: periodLabel,
    author: profileName || 'Chispudo',
    creator: 'Chispudo (chispu.xyz)',
  })

  // ── layout de flujo con salto de página ──
  let y = 0
  let sectionNo = 0

  function pageHeader() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text('Chispudo', M, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text(t('Reporte de Portafolio', 'Portfolio Report'), pageW / 2, 12, { align: 'center' })
    doc.text(periodLabel, pageW - M, 12, { align: 'right' })
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.line(M, 15, pageW - M, 15)
    y = 24
  }

  function ensure(h) {
    if (y + h > pageH - 18) {
      doc.addPage()
      pageHeader()
    }
  }

  function sectionTitle(es, en) {
    sectionNo++
    ensure(14)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(`${sectionNo}. ${t(es, en)}`, M, y)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(M, y + 1.5, pageW - M, y + 1.5)
    y += 7
  }

  function tableHead(cols) {
    ensure(8)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    cols.forEach((c) => doc.text(c.label, c.x, y, c.right ? { align: 'right' } : undefined))
    y += 1.5
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.15)
    doc.line(M, y, pageW - M, y)
    y += 4
  }

  function row(cells, { bold = false, size = 8, h = 5 } = {}) {
    ensure(h + 2)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    cells.forEach((c) => {
      doc.setTextColor(...(c.muted ? GRAY : INK))
      doc.text(String(c.text), c.x, y, c.right ? { align: 'right' } : undefined)
    })
    y += h
  }

  // ══ PORTADA COMPACTA (bloque de título, sin página oscura aparte) ══
  pageHeader()
  y = 30
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...INK)
  doc.text(t('Reporte de Portafolio', 'Portfolio Report'), M, y)
  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...GRAY)
  if (profileName) { doc.text(profileName, M, y); y += 6 }
  doc.text(`${t('Período', 'Period')}: ${periodLabel}`, M, y)
  y += 5
  doc.setFontSize(8)
  doc.text(`${t('Generado el', 'Generated on')} ${dateStr} · ${t('Valores en', 'Values in')} ${baseCurrency}`, M, y)
  y += 8

  // ══ KPIs ══
  const perThe = data.kpis.periodReturn
  const kpis = [
    { label: t('Patrimonio Neto', 'Net Worth'), value: fmt(data.kpis.netWorth) },
    { label: t('Activos', 'Assets'), value: fmt(data.kpis.totalAssets) },
    { label: t('Deuda', 'Debt'), value: data.kpis.debtTotal > 0 ? `(${fmtRaw(data.kpis.debtTotal)})` : fmtRaw(0) },
    { label: `${t('Retorno del período', 'Period Return')} ¹`, value: fmtPct(perThe ? perThe.pct : null) },
  ]
  const boxW = (CW - 9) / 4
  kpis.forEach((k, i) => {
    const x = M + i * (boxW + 3)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, boxW, 18, 1.5, 1.5, 'S')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(k.label, x + boxW / 2, y + 6, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...INK)
    doc.text(k.value, x + boxW / 2, y + 13.5, { align: 'center' })
  })
  y += 26

  // ══ 1. RESUMEN DEL PERÍODO ══
  sectionTitle('Resumen del período', 'Period Summary')
  const vc = data.kpis.valueChange
  const half = M + CW * 0.55
  const summaryRows = []
  if (vc) summaryRows.push([t('Valor al inicio', 'Opening value'), `${fmt(vc.first)}`, fmtDate(vc.firstTs)])
  summaryRows.push([`${t('Depósitos', 'Deposits')} (${data.flows.depositCount})`, fmt(data.flows.deposits), ''])
  summaryRows.push([`${t('Retiros', 'Withdrawals')} (${data.flows.withdrawalCount})`, data.flows.withdrawals > 0 ? `(${fmtRaw(data.flows.withdrawals)})` : fmtRaw(0), ''])
  summaryRows.push([`${t('Ingresos cobrados', 'Income collected')} (${data.flows.incomeCount})`, fmt(data.flows.incomeCollected), ''])
  if (perThe && perThe.abs != null) summaryRows.push([`${t('Ganancia del período', 'Period gain')} ¹`, fmt(perThe.abs), fmtPct(perThe.pct)])
  summaryRows.push([t('Valor al cierre', 'Closing value'), fmt(data.kpis.netWorth), fmtDate(now.getTime())])
  summaryRows.forEach(([label, val, note], i) => {
    const last = i === summaryRows.length - 1
    row([
      { text: label, x: M, muted: !last },
      { text: val, x: half, right: true },
      { text: note, x: pageW - M, right: true, muted: true },
    ], { bold: last, h: 5.5 })
  })
  if (perThe && perThe.fromTs && data.meta.periodStartTs && perThe.fromTs > data.meta.periodStartTs + 86400000) {
    row([{ text: t(`Retorno medido desde ${fmtDate(perThe.fromTs)} (primer dato disponible del período).`, `Return measured from ${fmtDate(perThe.fromTs)} (first available data point in the period).`), x: M, muted: true }], { size: 7 })
  }
  if (!perThe) {
    row([{ text: t('Sin dato de arranque confiable para este período: el retorno no se calcula (nunca se inventa).', 'No reliable opening data for this period: the return is not computed (never invented).'), x: M, muted: true }], { size: 7 })
  }
  y += 4

  // ══ 2. EVOLUCIÓN ══
  if (data.series.length >= 2) {
    sectionTitle('Evolución del portafolio', 'Portfolio Growth')
    ensure(48)
    const chartH = 34
    const chartTop = y + 2
    const values = data.series.map((p) => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const x0 = M + 24
    const chartW = CW - 24

    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.1)
    for (let g = 0; g <= 3; g++) {
      const gy = chartTop + (chartH * g) / 3
      doc.line(x0, gy, x0 + chartW, gy)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(fmt(max), x0 - 2, chartTop + 2, { align: 'right' })
    doc.text(fmt(min), x0 - 2, chartTop + chartH, { align: 'right' })

    const pts = data.series.map((p, i) => ({
      x: x0 + (i / (data.series.length - 1)) * chartW,
      y: chartTop + chartH - ((p.value - min) / range) * chartH,
    }))
    doc.setDrawColor(...BAR_FG)
    doc.setLineWidth(0.6)
    for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y)
    doc.setFillColor(...BAR_FG)
    doc.circle(pts[pts.length - 1].x, pts[pts.length - 1].y, 1, 'F')

    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(fmtDate(data.series[0].ts), x0, chartTop + chartH + 5)
    doc.text(fmtDate(data.series[data.series.length - 1].ts), x0 + chartW, chartTop + chartH + 5, { align: 'right' })
    y = chartTop + chartH + 12
  }

  // ══ 3. ASIGNACIÓN ══
  sectionTitle('Asignación de activos', 'Asset Allocation')
  tableHead([
    { label: t('Categoría', 'Category'), x: M },
    { label: '#', x: M + 62, right: true },
    { label: t('Valor', 'Value'), x: M + 105, right: true },
    { label: '%', x: M + 122, right: true },
  ])
  data.allocation.forEach((r) => {
    ensure(6)
    row([
      { text: categoryLabel(r.cat, lang), x: M },
      { text: r.count, x: M + 62, right: true, muted: true },
      { text: fmt(r.value), x: M + 105, right: true },
      { text: `${r.pct.toFixed(1)}%`, x: M + 122, right: true, muted: true },
    ], { h: 0 })
    // Barra gris uniforme (sin color por categoría: FASE FK).
    const barX = M + 130
    const barW = CW - 130
    doc.setFillColor(...BAR_BG)
    doc.rect(barX, y - 2.6, barW, 2.6, 'F')
    doc.setFillColor(...BAR_FG)
    if (r.pct > 0.5) doc.rect(barX, y - 2.6, Math.max(0.8, barW * (r.pct / 100)), 2.6, 'F')
    y += 5.5
  })
  y += 4

  // ══ 4. POSICIONES ══
  sectionTitle('Principales posiciones', 'Top Holdings')
  tableHead([
    { label: t('Instrumento', 'Instrument'), x: M },
    { label: t('Tipo', 'Type'), x: M + 62 },
    { label: t('Cant.', 'Qty'), x: M + 98, right: true },
    { label: t('Valor', 'Value'), x: M + 126, right: true },
    { label: '% Port.', x: M + 141, right: true },
    { label: `${t('Retorno', 'Return')} ²`, x: pageW - M, right: true },
  ])
  data.holdings.forEach((h) => {
    const label = h.symbol && h.name && h.symbol !== h.name ? `${h.name} (${h.symbol})` : (h.name || h.symbol)
    row([
      { text: String(label).slice(0, 34), x: M },
      { text: `${h.type || '-'}${h.subtype ? `/${h.subtype}` : ''}`.slice(0, 18), x: M + 62, muted: true },
      { text: h.qty.toLocaleString(locale, { maximumFractionDigits: 4 }), x: M + 98, right: true, muted: true },
      { text: fmt(h.value), x: M + 126, right: true },
      { text: `${h.weightPct.toFixed(1)}%`, x: M + 141, right: true, muted: true },
      { text: fmtPct(h.retPct), x: pageW - M, right: true },
    ], { h: 5, size: 7.5 })
  })
  y += 4

  // ══ 5. RENDIMIENTO POR CUENTA ══
  // Las columnas YTD solo existen cuando el motor de atribución tiene datos:
  // una pared de "-" no informa nada.
  if (data.institutions.length > 0) {
    const hasAttribution = data.institutions.some((r) => r.ytdGain != null)
    sectionTitle('Rendimiento por cuenta', 'Performance by Account')
    const cols = [
      { label: t('Institución', 'Institution'), x: M },
      { label: t('Valor', 'Value'), x: M + 90, right: true },
      { label: t('% Patrim.', '% NW'), x: M + 110, right: true },
    ]
    if (hasAttribution) {
      cols.push({ label: `${t('Ganancia YTD', 'YTD Gain')} ³`, x: M + 145, right: true })
      cols.push({ label: `${t('Retorno YTD', 'YTD Return')} ³`, x: pageW - M, right: true })
    }
    tableHead(cols)
    data.institutions.forEach((r) => {
      const cells = [
        { text: String(r.name).slice(0, 30), x: M },
        { text: fmt(r.value), x: M + 90, right: true },
        { text: `${r.weightPct.toFixed(1)}%`, x: M + 110, right: true, muted: true },
      ]
      if (hasAttribution) {
        cells.push({ text: r.ytdGain != null ? fmt(r.ytdGain) : '-', x: M + 145, right: true })
        cells.push({ text: fmtPct(r.ytdRetPct), x: pageW - M, right: true })
      }
      row(cells, { h: 5.5 })
    })
    if (hasAttribution && data.ytdUnexplained) {
      row([
        { text: t('Sin atribuir (residuo del reparto)', 'Unattributed (allocation residual)'), x: M, muted: true },
        { text: fmt(data.ytdUnexplained.gain), x: M + 145, right: true, muted: true },
      ], { h: 5.5, size: 7.5 })
    }
    if (!hasAttribution) {
      row([{ text: t('El desglose de ganancia por cuenta no está disponible en este momento (el motor de atribución no pudo repartir el YTD con confianza).', 'The per-account gain breakdown is unavailable right now (the attribution engine could not split the YTD confidently).'), x: M, muted: true }], { size: 7 })
    }
    y += 4
  }

  // ══ 6. INGRESOS ══
  sectionTitle('Ingresos', 'Income')
  const incomeRows = [
    [t('Ingresos cobrados en el período', 'Income collected in period'), fmt(data.flows.incomeCollected)],
    [t('Dividendos últimos 12 meses', 'Dividends, trailing 12 months'), fmt(data.income.ttmDividends)],
    [t('Ingreso anual proyectado', 'Projected annual income'), fmt(data.income.projectedAnnual)],
    [t('Proyección mensual', 'Projected monthly'), fmt(data.income.projectedMonthly)],
    [t('Yield sobre activos', 'Yield on assets'), data.income.yieldPct != null ? `${data.income.yieldPct.toFixed(2)}%` : '-'],
  ]
  incomeRows.forEach(([label, val]) => {
    row([
      { text: label, x: M, muted: true },
      { text: val, x: half, right: true },
    ], { h: 5.5 })
  })
  y += 4

  // ══ 7. EXPOSICIÓN ══
  if (data.currencies.length > 0 || data.geography.length > 0) {
    sectionTitle('Exposición por moneda y geografía', 'Currency & Geography Exposure')
    const colX2 = M + CW / 2 + 6
    const startY = y
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY)
    doc.text(t('Moneda (denominación original)', 'Currency (original denomination)'), M, y)
    y += 5
    data.currencies.slice(0, 6).forEach((r) => {
      row([
        { text: r.key, x: M },
        { text: fmt(r.value), x: M + 62, right: true },
        { text: `${r.pct.toFixed(1)}%`, x: M + 80, right: true, muted: true },
      ], { h: 5 })
    })
    const endY1 = y
    y = startY
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY)
    doc.text(t('Geografía', 'Geography'), colX2, y)
    y += 5
    data.geography.slice(0, 6).forEach((r) => {
      row([
        { text: regionLabel(r.key, locale, t('Otros', 'Other')).slice(0, 22), x: colX2 },
        { text: fmt(r.value), x: colX2 + 62, right: true },
        { text: `${r.pct.toFixed(1)}%`, x: colX2 + 80, right: true, muted: true },
      ], { h: 5 })
    })
    y = Math.max(endY1, y) + 4
  }

  // ══ 8. VENCIMIENTOS ══
  if (data.maturities.length > 0) {
    sectionTitle('Próximos vencimientos', 'Upcoming Maturities')
    tableHead([
      { label: t('Instrumento', 'Instrument'), x: M },
      { label: t('Vencimiento', 'Maturity'), x: M + 78 },
      { label: t('Días', 'Days'), x: M + 118, right: true },
      { label: t('Valor', 'Value'), x: M + 150, right: true },
      { label: t('Acción', 'Action'), x: pageW - M, right: true },
    ])
    data.maturities.forEach((r) => {
      const action = r.action === 'convert_equity' ? t('Convertir', 'Convert') : r.action === 'auto_renew' ? t('Renovar', 'Renew') : t('Capital', 'Capital')
      row([
        { text: String(r.name).slice(0, 30), x: M },
        { text: r.date, x: M + 78, muted: true },
        { text: String(r.days), x: M + 118, right: true, muted: true },
        { text: fmt(r.value), x: M + 150, right: true },
        { text: action, x: pageW - M, right: true, muted: true },
      ], { h: 5.5 })
    })
    y += 4
  }

  // ══ 9. JURISDICCIÓN ══
  if (data.jurisdictions.length > 0) {
    sectionTitle('Resumen por jurisdicción fiscal', 'Tax Jurisdiction Summary')
    tableHead([
      { label: t('País', 'Country'), x: M },
      { label: t('Posiciones', 'Positions'), x: M + 70, right: true },
      { label: t('Valor', 'Value'), x: M + 110, right: true },
      { label: '%', x: M + 128, right: true },
    ])
    data.jurisdictions.forEach((r) => {
      row([
        { text: regionLabel(r.key, locale, t('Otros', 'Other')).slice(0, 28), x: M },
        { text: r.count, x: M + 70, right: true, muted: true },
        { text: fmt(r.value), x: M + 110, right: true },
        { text: `${r.pct.toFixed(1)}%`, x: M + 128, right: true, muted: true },
      ], { h: 5.5 })
    })
    y += 4
  }

  // ══ 10. DEUDAS ══
  if (data.debts.length > 0) {
    sectionTitle('Deudas y pasivos', 'Debts & Liabilities')
    tableHead([
      { label: t('Nombre', 'Name'), x: M },
      { label: t('Saldo', 'Balance'), x: M + 90, right: true },
      { label: t('Tasa', 'Rate'), x: M + 115, right: true },
    ])
    data.debts.forEach((r) => {
      row([
        { text: String(r.name).slice(0, 34), x: M },
        { text: `(${fmtRaw(r.balance)})`, x: M + 90, right: true },
        { text: r.ratePct != null ? `${r.ratePct}%` : '-', x: M + 115, right: true, muted: true },
      ], { h: 5.5 })
    })
    row([
      { text: t('Total deuda', 'Total debt'), x: M },
      { text: `(${fmtRaw(data.kpis.debtTotal)})`, x: M + 90, right: true },
    ], { bold: true, h: 6 })
    y += 4
  }

  // ══ METODOLOGÍA Y NOTAS ══
  ensure(42)
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.2)
  doc.line(M, y, pageW - M, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK)
  doc.text(t('Metodología y notas', 'Methodology & Notes'), M, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  const notes = [
    t('¹ Ganancia y retorno del período: Modified Dietz, netos de depósitos y retiros. Un depósito nunca se cuenta como ganancia.',
      '¹ Period gain and return: Modified Dietz, net of deposits and withdrawals. A deposit is never counted as gain.'),
    t('² Retorno por posición: la ganancia se mide contra el principal e incluye los ingresos que el activo generó; el porcentaje divide entre el costo total desembolsado, comisión de entrada incluida.',
      '² Per-position return: gain is measured against principal and includes income the asset generated; the percentage divides by total cash outlay, entry fee included.'),
    t('³ Ganancia y retorno YTD por cuenta: motor de atribución sobre la misma base Dietz del encabezado; las filas suman el total del año.',
      '³ Per-account YTD gain and return: attribution engine on the same Dietz base as the headline; rows add up to the yearly total.'),
    t(`Los valores están expresados en ${baseCurrency}. Los montos negativos van entre paréntesis.`,
      `Values are expressed in ${baseCurrency}. Negative amounts appear in parentheses.`),
    t('Este reporte es informativo y no constituye asesoría de inversión.',
      'This report is informational and does not constitute investment advice.'),
  ]
  notes.forEach((n) => {
    const lines = doc.splitTextToSize(n, CW)
    ensure(lines.length * 3.4 + 2)
    doc.text(lines, M, y)
    y += lines.length * 3.4 + 1.5
  })

  // ══ PIE DE PÁGINA EN TODAS ══
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...FAINT)
    doc.text(`${t('Generado por', 'Generated by')} Chispudo · chispu.xyz · ${dateStr}`, M, pageH - 8)
    doc.text(t(`Página ${i} de ${totalPages}`, `Page ${i} of ${totalPages}`), pageW - M, pageH - 8, { align: 'right' })
  }

  const profileSlug = profileName
    ? '-' + profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
    : ''
  doc.save(`chispudo-report${profileSlug}-${now.toISOString().split('T')[0]}.pdf`)
}
