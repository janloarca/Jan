// Invertido y ganado POR AÑO: la tabla de historia de capital.
//
//   por cada año:  invertido = depósitos − retiros − comisiones de entrada
//                  ganancia  = Dietz del año calendario (neto de flujos)
//
// El invertido de cada año sale de lib/ytdInvested.js (el mismo motor del año
// en curso, parametrizado por año: una sola definición de "invertido"). La
// ganancia de un año CERRADO sale de calendarYearGain, el MISMO cálculo de
// años calendario que usa el reporte (lib/reportData.js llama esta función
// desde FASE IB: dos superficies, un motor, no pueden divergir). La ganancia
// del año EN CURSO llega del hook (returnYTD/ytdChange, el Dietz del
// encabezado) y JAMÁS se recalcula aquí: dos motores dando dos YTD es la
// historia que este repo ya pagó cara (FASE HT).
//
// Un año sin ancla de arranque o cierre en el archivo reporta ganancia null
// (la UI imprime "-"): un guión honesto antes que un número inventado. El
// total de ganancias solo existe cuando TODOS los años listados tienen dato;
// sumar solo los años que sí tienen se leería como "ganancia de por vida"
// siendo un subconjunto.

import { computeYtdInvested } from './ytdInvested'
import { computeModifiedDietz } from '../components/dashboard/utils'

// Mismas ventanas de ancla que el resto de reportData: hasta 10 días antes
// (un 1 de enero en fin de semana usa el cierre previo) o 7 después.
export const YEAR_ANCHOR_BEFORE_MS = 10 * 86400000
export const YEAR_ANCHOR_AFTER_MS = 7 * 86400000

// Ganancia de un año calendario CERRADO sobre una serie de valor ya ordenada
// (buildReportSeries). Extraída textual del loop de calendarYears de
// reportData (FASE HT5), que ahora la llama: null cuando falta cualquiera de
// las dos anclas reales, nunca un número inventado.
export function calendarYearGain({ series, year, transactions, convert, baseCurrency }) {
  const pts = series || []
  const yStart = new Date(year, 0, 1).getTime()
  const yEnd = new Date(year + 1, 0, 1).getTime()
  let startAnchor = null
  for (const p of pts) {
    if (p.ts <= yStart && p.ts >= yStart - YEAR_ANCHOR_BEFORE_MS) startAnchor = p
    if (p.ts > yStart) break
  }
  if (!startAnchor) startAnchor = pts.find((p) => p.ts >= yStart && p.ts <= yStart + YEAR_ANCHOR_AFTER_MS) || null
  let endAnchor = null
  for (const p of pts) {
    if (p.ts < yEnd && p.ts >= yEnd - YEAR_ANCHOR_BEFORE_MS) endAnchor = p
    if (p.ts >= yEnd) break
  }
  if (!startAnchor || !endAnchor || !(startAnchor.value > 0) || endAnchor.ts <= startAnchor.ts) return null
  // Regla de FASE DV heredada: un flujo fechado EXACTO en el ancla ya vive
  // dentro del valor del ancla, la ventana de flujos abre en anchorTs + 1.
  const { pct, abs } = computeModifiedDietz({
    startValue: startAnchor.value, endValue: endAnchor.value,
    startTs: startAnchor.ts + 1, endTs: endAnchor.ts,
    transactions: transactions || [], convert, baseCurrency,
  })
  if (!isFinite(pct)) return null
  return { pct, abs }
}

export function computeInvestedByYear({
  transactions, items, series, convert, baseCurrency,
  returnYTD = null, ytdChange = null, nowTs = Date.now(),
} = {}) {
  const nowYear = new Date(nowTs).getFullYear()

  // Años candidatos: donde hubo flujos externos reales, más todo el rango que
  // la serie de valor cubre (un año sin aportes pero con ganancias reales es
  // una fila informativa: invertido 0, ganado X).
  const years = new Set()
  for (const tx of transactions || []) {
    const t = (tx?.type || '').toUpperCase()
    if (t !== 'DEPOSIT' && t !== 'WITHDRAWAL') continue
    if (tx._source === 'manual_edit_adjustment') continue
    if (!tx.date) continue
    const y = new Date(tx.date).getUTCFullYear()
    if (isFinite(y) && y <= nowYear) years.add(y)
  }
  if (series && series.length > 0) {
    const firstYear = new Date(series[0].ts).getFullYear()
    for (let y = firstYear; y <= nowYear; y++) years.add(y)
  }

  const rows = []
  for (const year of [...years].sort((a, b) => b - a)) {
    const inv = computeYtdInvested({ transactions, items, year, convert, baseCurrency })
    const gain = year === nowYear
      ? (returnYTD != null && isFinite(returnYTD) ? { pct: returnYTD, abs: ytdChange ?? null } : null)
      : calendarYearGain({ series, year, transactions, convert, baseCurrency })
    // Un año sin actividad Y sin ganancia medible no dice nada: fuera.
    if (!inv.hasActivity && !gain) continue
    rows.push({
      year,
      invested: inv.invested,
      deposits: inv.deposits,
      withdrawals: inv.withdrawals,
      fees: inv.fees,
      gainAbs: gain && gain.abs != null && isFinite(gain.abs) ? gain.abs : null,
      gainPct: gain && gain.pct != null && isFinite(gain.pct) ? gain.pct : null,
      partial: year === nowYear,
    })
  }

  const totalInvested = rows.reduce((s, r) => s + r.invested, 0)
  const gainComplete = rows.length > 0 && rows.every((r) => r.gainAbs != null)
  const totalGain = gainComplete ? rows.reduce((s, r) => s + r.gainAbs, 0) : null

  return { rows, totalInvested, totalGain, hasData: rows.length > 0 }
}
