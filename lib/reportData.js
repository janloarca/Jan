// FASE HT. UNA sola fuente de datos para los DOS reportes (el modal de
// imprimir y el PDF descargable). Antes cada generador recalculaba todo por su
// cuenta y divergieron hasta imprimir números indefendibles:
//
//   - "Return +1148.8%": (último snapshot - primer snapshot) / primer
//     snapshot, crudo. Sin netear un solo depósito y arrancando desde el
//     snapshot más viejo que exista. Cada depósito de la vida del usuario se
//     leía como ganancia (el error #3 documentado en la lógica congelada).
//   - P&L por posición con (precio actual - precio compra) / precio compra:
//     VITALI imprimía 0.00% cuando el número correcto y CONGELADO es 3.94%
//     (el cupón vive en getDividendIncomeByItem, que el reporte ignoraba).
//   - "Retornos mensuales" por diff de snapshots consecutivos: un mes con un
//     depósito de $1,450 salía como mes ganador.
//   - La serie de evolución usaba snapshots crudos sin resolver por día: los
//     docs de NAV solo-broker dibujaban el diente de sierra en el PDF.
//
// Este módulo NO inventa ninguna fórmula: adopta las compartidas (extender,
// no reescribir, según el protocolo de lib/assetLogic/). Los retornos de
// cabecera (YTD / desde inicio) NO se recalculan aquí: llegan del hook, que ya
// resolvió anclas, calibraciones y flujos (superficie congelada C). Lo único
// que este módulo calcula por su cuenta es el Dietz de un período corto
// (mes/trimestre) sobre un ancla resuelta con preferFullPortfolioPerDay, y lo
// hace llamando a computeModifiedDietz, nunca con una copia.
//
// Convención de moneda: items ENRIQUECIDOS (precios ya en baseCurrency);
// snapshots en USD (se convierten); transacciones en su moneda original (se
// convierten con `convert`). Los renderers formatean; aquí todo es numérico.

import {
  getItemValue,
  getItemCostBasis,
  getItemPrincipalCost,
  getDividendIncomeByItem,
  getTypeCategory,
  getItemPrice,
  isExcludedFromNetWorth,
  accountKeyOfItem,
  computeModifiedDietz,
  getGeographyFromItem,
  getSectorFromItem,
  effectiveAcqTs,
} from '../components/dashboard/utils'
import { preferFullPortfolioPerDay } from './snapshotSelect'
import { calendarYearGain } from './investedByYear'

// El ancla de un período corto tiene que ser una observación razonablemente
// cercana al arranque nominal: hasta 10 días antes (un 1 de mes que cae en
// fin de semana usa el cierre previo) o 7 días después (una cuenta que empezó
// a medirse dentro del período reporta "desde <fecha>" en vez de inventar el
// tramo que no existe). Más lejos que eso no es un ancla, es una adivinanza.
const ANCHOR_BEFORE_MS = 10 * 86400000
const ANCHOR_AFTER_MS = 7 * 86400000

export const REPORT_PERIODS = ['week', 'month', 'quarter', 'ytd', 'all']

// Etiqueta visible para una región/jurisdicción: un código ISO de 2 letras se
// traduce con Intl.DisplayNames ('GT' → 'Guatemala'), los buckets genéricos se
// normalizan, y cualquier otra cosa pasa tal cual. Compartida por los DOS
// renderers para que no diverjan.
export function regionLabel(key, locale = 'en', otherLabel = 'Other') {
  const k = String(key || '').trim()
  const up = k.toUpperCase()
  if (!k || up === 'UNKNOWN' || up === 'OTHER') return otherLabel
  if (up === 'GLOBAL') return 'Global'
  if (/^[A-Z]{2}$/.test(up)) {
    try {
      const name = new Intl.DisplayNames([locale], { type: 'region' }).of(up)
      if (name && name !== up) return name
    } catch { /* runtime sin DisplayNames: cae al código crudo */ }
  }
  return k
}

// ⛔ LAS FRONTERAS DE PERÍODO VAN EN UTC. Ver la nota de `calendarYearGain`
// (lib/investedByYear.js): los `ts` de la serie salen de `Date.parse` sobre una
// fecha 'YYYY-MM-DD', o sea medianoche UTC. Con una frontera LOCAL, al oeste de
// UTC el 1 de enero cae SEIS HORAS DESPUÉS del snapshot fechado ese mismo día,
// así que el ancla de arranque del propio año quedaba fuera de su ventana. Y
// este módulo corre también en el SERVIDOR (correos, link compartido), donde
// "local" es la zona del datacenter: el año de un usuario no puede depender de
// dónde se ejecutó el cron.
export function periodRange(kind, now = new Date()) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  // 'week' (FASE HZ, para el correo semanal): los 7 días que terminan HOY, no
  // la semana calendario. El correo sale el domingo y cubre la semana que
  // acaba de cerrar, no un lunes-a-domingo parcial. Sin frontera de calendario,
  // así que no le aplica lo de arriba.
  if (kind === 'week') return { kind, startTs: now.getTime() - 7 * 86400000 }
  if (kind === 'month') return { kind, startTs: Date.UTC(y, m, 1) }
  if (kind === 'quarter') return { kind, startTs: Date.UTC(y, Math.floor(m / 3) * 3, 1) }
  if (kind === 'ytd') return { kind, startTs: Date.UTC(y, 0, 1) }
  return { kind: 'all', startTs: null }
}

function snapValueUSD(s) {
  const v = s.netWorthUSD ?? s.totalActivosUSD
  return v != null && isFinite(v) ? v : null
}

function toTs(s) {
  if (s.ts != null && isFinite(s.ts)) return s.ts
  if (s.date) {
    const t = Date.parse(s.date)
    if (!isNaN(t)) return t
  }
  return null
}

// Serie de valor del PORTAFOLIO COMPLETO, resuelta por día (un doc de NAV
// solo-broker jamás compite contra la observación completa del mismo día) y
// convertida a la moneda base. Ordenada por fecha.
export function buildReportSeries(snapshots, { convert, baseCurrency = 'USD' } = {}) {
  const resolved = preferFullPortfolioPerDay(snapshots || [])
  const pts = []
  for (const s of resolved) {
    if (!s || s._calibrated || s._account) continue
    const v = snapValueUSD(s)
    const ts = toTs(s)
    if (v == null || ts == null || !(v > 0)) continue
    const value = convert && baseCurrency !== 'USD' ? convert(v, 'USD', baseCurrency) : v
    pts.push({ ts, date: s.date || null, value, src: s._source || null })
  }
  pts.sort((a, b) => a.ts - b.ts)
  return pts
}

// Dietz de un período corto (mes/trimestre) sobre un ancla real de la serie.
// Regla de FASE DV heredada: un flujo fechado EXACTO en el ancla ya vive
// dentro del valor del ancla, así que la ventana de flujos abre en
// anchorTs + 1 para no restarlo doble.
function periodDietz({ series, startTs, endTs, endValue, transactions, convert, baseCurrency }) {
  if (!startTs || !series.length) return null
  let anchor = null
  for (const p of series) {
    if (p.ts <= startTs && p.ts >= startTs - ANCHOR_BEFORE_MS) anchor = p
    if (p.ts > startTs) break
  }
  if (!anchor) {
    anchor = series.find((p) => p.ts >= startTs && p.ts <= startTs + ANCHOR_AFTER_MS) || null
  }
  if (!anchor || !(anchor.value > 0)) return null
  const { pct, abs } = computeModifiedDietz({
    startValue: anchor.value,
    endValue,
    startTs: anchor.ts + 1,
    endTs,
    transactions,
    convert,
    baseCurrency,
  })
  if (!isFinite(pct)) return null
  return { pct, abs, fromTs: anchor.ts }
}

// Máxima caída pico-a-valle de una serie ya ordenada por ts. La convención de
// siempre: negativo, en %, con las fechas del pico y del valle.
export function maxDrawdown(series) {
  if (!Array.isArray(series) || series.length < 2) return null
  let peak = series[0]
  let worst = null
  for (const p of series) {
    if (p.value > peak.value) { peak = p; continue }
    if (peak.value > 0) {
      const dd = ((p.value - peak.value) / peak.value) * 100
      if (!worst || dd < worst.pct) worst = { pct: dd, fromTs: peak.ts, toTs: p.ts }
    }
  }
  if (!worst || worst.pct > -0.005) return null
  return worst
}

export function buildReportData({
  items,
  transactions,
  snapshots,
  netWorth,
  totalAssets,
  returnYTD = null,
  ytdChange = null,
  returnSinceStart = null,
  sinceStartDate = null,
  ytdBreakdown = null,
  ytdBreakdownReason = null,
  annualDividends = 0,
  estimatedAnnualIncome = 0,
  benchmarkName = null,
  benchmarkYtdPct = null,
  volatilityPct = null,
  sharpe = null,
  beta = null,
  baseCurrency = 'USD',
  convert = null,
  profileName = '',
  period = 'ytd',
  periodStartTs = null,
  topN = 15,
  now = new Date(),
}) {
  const nowTs = now.getTime()
  const range = periodRange(period, now)
  // FASE IE (correo mensual): el correo sale el día 1 y cubre el mes que
  // acaba de CERRAR, pero periodRange('month') ancla en el mes EN CURSO (lo
  // correcto para el modal del reporte). El caller puede fijar el arranque
  // explícito sin cambiar nada más: misma serie, mismo Dietz, misma ventana
  // de flujos, solo movida al mes de referencia.
  if (periodStartTs != null && isFinite(periodStartTs)) range.startTs = periodStartTs
  const list = (items || []).filter((it) => it && !isExcludedFromNetWorth(it))
  const assets = list.filter((it) => !it.isDebt)
  const debts = list.filter((it) => it.isDebt)
  const txs = transactions || []

  // ── Valores por ítem (una sola pasada, helpers compartidos) ──
  const divIncome = getDividendIncomeByItem(txs, list, convert, baseCurrency)
  const holdingsAll = assets
    .map((it) => {
      const value = getItemValue(it)
      const costBasis = getItemCostBasis(it)
      const principal = getItemPrincipalCost(it)
      const income = divIncome.get(it.id) || 0
      // La fórmula congelada de las tarjetas: ganancia contra el PRINCIPAL más
      // el ingreso que el activo GENERÓ; el % divide entre el costo total.
      const gain = (value - principal) + income
      const retPct = costBasis > 0 ? (gain / costBasis) * 100 : null
      return {
        id: it.id,
        name: it.name || it.symbol || '',
        symbol: it.symbol || null,
        type: it.type || null,
        subtype: it.subtype || null,
        institution: it.institution || null,
        qty: Number(it.quantity) || 0,
        price: getItemPrice(it),
        value,
        costBasis,
        income,
        gain,
        retPct: retPct != null && isFinite(retPct) ? retPct : null,
      }
    })
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
  const assetsTotal = holdingsAll.reduce((s, h) => s + h.value, 0)
  holdingsAll.forEach((h) => { h.weightPct = assetsTotal > 0 ? (h.value / assetsTotal) * 100 : 0 })

  // ── Asignación por categoría ──
  const catMap = new Map()
  for (const h of holdingsAll) {
    const cat = getTypeCategory({ type: h.type })
    const row = catMap.get(cat) || { cat, count: 0, value: 0 }
    row.count++
    row.value += h.value
    catMap.set(cat, row)
  }
  const allocation = [...catMap.values()]
    .map((r) => ({ ...r, pct: assetsTotal > 0 ? (r.value / assetsTotal) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)

  // ── Instituciones: valor de hoy siempre; ganancia/retorno YTD cuando el
  //    motor de atribución (FASE GR) los tiene. Nunca se recalculan aquí. ──
  const instValue = new Map()
  const instName = new Map()
  for (const it of list) {
    const k = accountKeyOfItem(it)
    if (!k) continue
    const val = getItemValue(it)
    instValue.set(k, (instValue.get(k) || 0) + (it.isDebt ? -Math.abs(val) : val))
    if (!instName.has(k)) {
      instName.set(k, k === 'ibkr' ? 'Interactive Brokers' : (it.institution || '').trim() || k)
    }
  }
  const breakdownByKey = new Map()
  let unexplainedRow = null
  if (ytdBreakdown && Array.isArray(ytdBreakdown.groups)) {
    for (const g of ytdBreakdown.groups) {
      if (g.isUnexplained) unexplainedRow = { gain: g.gain }
      else breakdownByKey.set(g.key, g)
    }
  }
  const institutions = [...instValue.entries()]
    .map(([key, value]) => {
      const g = breakdownByKey.get(key)
      return {
        key,
        name: instName.get(key) || key,
        value,
        weightPct: netWorth > 0 ? (value / netWorth) * 100 : 0,
        ytdGain: g ? g.gain : null,
        ytdRetPct: g && g.ret != null ? g.ret : null,
      }
    })
    .sort((a, b) => b.value - a.value)

  // ── Flujos y ingresos cobrados del período ──
  const startTs = range.startTs
  const inWindow = (tx) => {
    if (!tx.date) return false
    const t = new Date(tx.date).getTime()
    if (isNaN(t) || t > nowTs) return false
    return startTs == null || t >= startTs
  }
  const conv = (amt, cur) => (convert ? convert(amt, cur || 'USD', baseCurrency) : amt)
  const flows = { deposits: 0, withdrawals: 0, net: 0, depositCount: 0, withdrawalCount: 0, incomeCollected: 0, incomeCount: 0 }
  const byId = new Map(list.map((it) => [it.id, it]))
  for (const tx of txs) {
    const ty = (tx.type || '').toUpperCase()
    if (ty === 'DEPOSIT' || ty === 'WITHDRAWAL') {
      if (!inWindow(tx)) continue
      const amt = conv(Math.abs(tx.totalAmount ?? tx.amount ?? 0), tx.currency)
      if (!(amt > 0)) continue
      if (ty === 'DEPOSIT') { flows.deposits += amt; flows.depositCount++ }
      else { flows.withdrawals += amt; flows.withdrawalCount++ }
    } else if (ty === 'DIVIDEND' || ty === 'INTEREST') {
      if (!inWindow(tx)) continue
      const raw = Number(tx.totalAmount ?? tx.amount ?? 0)
      if (!(raw > 0)) continue
      const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
      if (tx._reinvested === true || (linked && linked.dividendAction === 'reinvest')) continue
      flows.incomeCollected += conv(raw, tx.currency)
      flows.incomeCount++
    }
  }
  flows.net = flows.deposits - flows.withdrawals

  // ── Serie y retorno del período ──
  const seriesAll = buildReportSeries(snapshots, { convert, baseCurrency })
  const series = startTs == null ? seriesAll : seriesAll.filter((p) => p.ts >= startTs)

  let periodReturn = null
  if (range.kind === 'ytd') {
    if (returnYTD != null) periodReturn = { pct: returnYTD, abs: ytdChange, fromTs: startTs, source: 'header' }
    else {
      // Sin la cifra del hook (el caso del servidor: el cron no corre el
      // dashboard), se resuelve con el MISMO Dietz que los demás períodos.
      // El hook siempre gana cuando existe: esto solo llena un hueco que
      // antes se imprimía como "-".
      const d = periodDietz({ series: seriesAll, startTs, endTs: nowTs, endValue: netWorth, transactions: txs, convert, baseCurrency })
      if (d) periodReturn = { ...d, source: 'dietz' }
    }
  } else if (range.kind === 'all') {
    if (returnSinceStart != null) {
      periodReturn = { pct: returnSinceStart, abs: null, fromTs: sinceStartDate ? Date.parse(sinceStartDate) || null : null, source: 'header' }
    } else if (seriesAll.length > 0) {
      // Mismo criterio que el YTD (FASE IE7): sin la cifra del hook, se
      // resuelve con el mismo Dietz desde el primer punto de la serie, en vez
      // de imprimir "-" en un documento que sí tiene con qué medirlo. Un
      // reporte que dice "no sé el retorno desde el inicio" pero declara años
      // calendario completos se contradice a sí mismo.
      const d = periodDietz({ series: seriesAll, startTs: seriesAll[0].ts, endTs: nowTs, endValue: netWorth, transactions: txs, convert, baseCurrency })
      if (d) periodReturn = { ...d, source: 'dietz' }
    }
  } else {
    const d = periodDietz({ series: seriesAll, startTs, endTs: nowTs, endValue: netWorth, transactions: txs, convert, baseCurrency })
    if (d) periodReturn = { ...d, source: 'dietz' }
  }

  // Cambio de VALOR del período: informativo, incluye flujos, y se etiqueta
  // así en los renderers. Nunca se presenta como retorno.
  let valueChange = null
  if (series.length > 0) {
    const first = series[0]
    valueChange = { first: first.value, firstTs: first.ts, last: netWorth, lastTs: nowTs, abs: netWorth - first.value }
  }

  // ── Tabla de rendimiento por horizonte (el estándar de un reporte
  //    profesional: retornos rodantes lado a lado). 1M/3M/1A son Dietz sobre
  //    un ancla resuelta; YTD y Desde inicio llegan del hook y JAMÁS se
  //    recalculan aquí. Sin ancla → pct null y el renderer imprime "-". ──
  // Ventana RODANTE ("hace N meses"), no una frontera de calendario, asi que
  // leer y escribir el mes con el mismo par es correcto de las dos formas. Va
  // en UTC igual que todo lo demas de este modulo, para que el servidor (donde
  // corren los correos) y el navegador no resuelvan ventanas distintas.
  const rollingStart = (months) => {
    const d = new Date(now)
    d.setUTCMonth(d.getUTCMonth() - months)
    return d.getTime()
  }
  const rollingDietz = (months) => periodDietz({
    series: seriesAll, startTs: rollingStart(months), endTs: nowTs,
    endValue: netWorth, transactions: txs, convert, baseCurrency,
  })
  const ytdFallback = returnYTD == null
    ? periodDietz({ series: seriesAll, startTs: periodRange('ytd', now).startTs, endTs: nowTs, endValue: netWorth, transactions: txs, convert, baseCurrency })
    : null
  const performance = [
    { key: '1m', ...(rollingDietz(1) || { pct: null }) },
    { key: '3m', ...(rollingDietz(3) || { pct: null }) },
    // El YTD del hook manda cuando existe; si no (el caso del SERVIDOR, que no
    // corre el dashboard), se resuelve con el mismo Dietz que las demás filas.
    // Sin esto, el mismo documento imprimía "+3.12%" en el resumen y "-" en la
    // tabla de rendimiento: dos respuestas para la misma pregunta.
    { key: 'ytd', ...(returnYTD != null
      ? { pct: returnYTD, abs: ytdChange, fromTs: periodRange('ytd', now).startTs }
      : (ytdFallback || { pct: null, fromTs: periodRange('ytd', now).startTs })) },
    { key: '1y', ...(rollingDietz(12) || { pct: null }) },
    // Desde el inicio: el hook manda cuando existe; si no, el mismo Dietz
    // sobre toda la serie archivada (FASE IE7).
    { key: 'all', ...(returnSinceStart != null
      ? { pct: returnSinceStart, abs: null, fromTs: sinceStartDate ? (Date.parse(sinceStartDate) || null) : null }
      : (seriesAll.length > 0
        ? (periodDietz({ series: seriesAll, startTs: seriesAll[0].ts, endTs: nowTs, endValue: netWorth, transactions: txs, convert, baseCurrency }) || { pct: null })
        : { pct: null })) },
  ]
  // 3 y 5 años ANUALIZADOS, solo cuando el archivo de verdad alcanza (decisión
  // del usuario: "solo poner los datos que estén", nunca una fila de guiones
  // para un horizonte que la cuenta no tiene). Dietz sobre la ventana completa,
  // anualizado geométrico.
  for (const { key, months } of [{ key: '3y', months: 36 }, { key: '5y', months: 60 }]) {
    const d = rollingDietz(months)
    if (!d || d.pct == null || !isFinite(d.pct) || d.pct <= -100) continue
    const annualizedPct = (Math.pow(1 + d.pct / 100, 12 / months) - 1) * 100
    performance.push({ key, pct: annualizedPct, abs: d.abs, fromTs: d.fromTs, annualized: true })
  }

  // ── Años calendario (la barra clásica de factsheet): cada año con ancla de
  //    arranque Y de cierre reales; el año en curso usa el YTD del hook. Un
  //    año sin datos simplemente no aparece. ──
  // El año cerrado se calcula en calendarYearGain (lib/investedByYear.js),
  // extraído textual de aquí en FASE IB: la tarjeta de invertido por año del
  // dashboard usa el MISMO motor, dos superficies no pueden divergir.
  const calendarYears = []
  if (seriesAll.length > 0) {
    // UTC, igual que `calendarYearGain` y que los `ts` de la propia serie.
    const firstYear = new Date(seriesAll[0].ts).getUTCFullYear()
    const nowYear = now.getUTCFullYear()
    for (let year = firstYear; year <= nowYear; year++) {
      if (year === nowYear) {
        // El YTD del hook manda cuando existe; sin él (el caso del SERVIDOR:
        // correos y link compartido, donde el dashboard no corre) el año en
        // curso usa el MISMO ytdFallback que ya alimenta la fila YTD de la
        // tabla de rendimiento, así la barra de años y la tabla no pueden
        // decir cosas distintas. Sin ancla de arranque, se sigue omitiendo.
        if (returnYTD != null) calendarYears.push({ year, pct: returnYTD, abs: ytdChange ?? null, partial: true })
        else if (ytdFallback) calendarYears.push({ year, pct: ytdFallback.pct, abs: ytdFallback.abs ?? null, partial: true })
        continue
      }
      const g = calendarYearGain({ series: seriesAll, year, transactions: txs, convert, baseCurrency })
      if (g) calendarYears.push({ year, pct: g.pct, abs: g.abs, partial: false })
    }
  }

  // ── Riesgo del período: máxima caída de la serie mostrada; la volatilidad
  //    anualizada llega del hook (riskMetrics), nunca se recalcula. ──
  const risk = {
    maxDrawdown: maxDrawdown(series),
    volatilityPct: volatilityPct != null && isFinite(volatilityPct) && volatilityPct > 0 ? volatilityPct : null,
    sharpe: sharpe != null && isFinite(sharpe) ? sharpe : null,
    beta: beta != null && isFinite(beta) ? beta : null,
  }

  // ── Comisiones de entrada pagadas (transparencia de costos): del período y
  //    de toda la vida. Solo entry fees registradas en los items; en ambos
  //    modos (separate/deducted) la comisión es dinero real que salió. ──
  // La comisión se toma tal cual del item, la MISMA convención de
  // getItemCostBasis (que suma entryFee cruda al principal): convertirla aquí
  // por separado haría que "comisiones" y "costo total" contaran la misma
  // comisión con dos números distintos.
  const fees = { periodEntryFees: 0, totalEntryFees: 0 }
  for (const it of list) {
    const fee = Number(it.entryFee) || 0
    if (!(fee > 0)) continue
    fees.totalEntryFees += fee
    const acqTs = effectiveAcqTs(it)
    if (acqTs != null && acqTs <= nowTs && (startTs == null || acqTs >= startTs)) fees.periodEntryFees += fee
  }

  const benchmark = (benchmarkYtdPct != null && isFinite(benchmarkYtdPct))
    ? { name: benchmarkName || 'S&P 500', ytdPct: benchmarkYtdPct }
    : null

  // ── Ingresos ──
  const income = {
    ttmDividends: annualDividends || 0,
    projectedAnnual: estimatedAnnualIncome || 0,
    projectedMonthly: (estimatedAnnualIncome || 0) / 12,
    yieldPct: totalAssets > 0 && estimatedAnnualIncome > 0 ? (estimatedAnnualIncome / totalAssets) * 100 : null,
  }

  // ── Exposición por moneda (denominación ORIGINAL) y geografía ──
  const curMap = new Map()
  const geoMap = new Map()
  // La geografía se mergea SIN distinguir mayúsculas: en datos reales
  // conviven 'GLOBAL' y 'Global' para la misma cosa, y dos filas que solo
  // difieren en caja se leen como un dato duplicado. Se conserva la caja de
  // la primera aparición como key visible.
  const geoCanonical = new Map()
  for (const it of assets) {
    const value = getItemValue(it)
    if (!(value > 0)) continue
    const cur = it._originalCurrency || it.currency || baseCurrency
    curMap.set(cur, (curMap.get(cur) || 0) + value)
    const geoRaw = String(getGeographyFromItem(it) || 'Other').trim() || 'Other'
    const canon = geoRaw.toUpperCase()
    if (!geoCanonical.has(canon)) geoCanonical.set(canon, geoRaw)
    const geo = geoCanonical.get(canon)
    geoMap.set(geo, (geoMap.get(geo) || 0) + value)
  }
  const toRows = (map) => [...map.entries()]
    .map(([key, value]) => ({ key, value, pct: assetsTotal > 0 ? (value / assetsTotal) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
  const currencies = toRows(curMap)
  const geography = toRows(geoMap)

  // ── Exposición por sector (misma regla que la pestaña del dashboard). ──
  const secMap = new Map()
  for (const it of assets) {
    const value = getItemValue(it)
    if (!(value > 0)) continue
    const sec = getSectorFromItem(it) || 'Unknown'
    secMap.set(sec, (secMap.get(sec) || 0) + value)
  }
  const sectors = toRows(secMap)

  // ── Vencimientos y jurisdicción ──
  const maturities = assets
    .filter((it) => it.maturityDate && Date.parse(it.maturityDate) > nowTs)
    .map((it) => ({
      name: it.name || it.symbol || '',
      date: String(it.maturityDate).slice(0, 10),
      value: getItemValue(it),
      days: Math.ceil((Date.parse(it.maturityDate) - nowTs) / 86400000),
      action: it.maturityAction || null,
    }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 15)

  const jurMap = new Map()
  for (const it of assets) {
    if (!it.taxJurisdiction) continue
    const value = getItemValue(it)
    if (!(value > 0)) continue
    const row = jurMap.get(it.taxJurisdiction) || { key: it.taxJurisdiction, count: 0, value: 0 }
    row.count++
    row.value += value
    jurMap.set(it.taxJurisdiction, row)
  }
  const jurisdictions = [...jurMap.values()]
    .map((r) => ({ ...r, pct: assetsTotal > 0 ? (r.value / assetsTotal) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)

  // ── Deudas ──
  const debtRows = debts.map((it) => ({
    name: it.name || it.symbol || '',
    balance: Math.abs(getItemValue(it)),
    ratePct: it.interestRate || null,
  })).sort((a, b) => b.balance - a.balance)
  const debtTotal = debtRows.reduce((s, d) => s + d.balance, 0)

  return {
    meta: {
      generatedTs: nowTs,
      periodKind: range.kind,
      periodStartTs: startTs,
      baseCurrency,
      owner: profileName || '',
      breakdownReason: ytdBreakdownReason || null,
    },
    performance,
    calendarYears,
    risk,
    fees,
    benchmark,
    sectors,
    kpis: {
      netWorth,
      totalAssets,
      debtTotal,
      holdingsCount: holdingsAll.length,
      ytd: returnYTD != null ? { pct: returnYTD, abs: ytdChange } : null,
      sinceStart: returnSinceStart != null ? { pct: returnSinceStart, date: sinceStartDate || null } : null,
      periodReturn,
      valueChange,
    },
    allocation,
    holdings: holdingsAll.slice(0, topN),
    institutions,
    ytdUnexplained: unexplainedRow,
    flows,
    income,
    series,
    currencies,
    geography,
    maturities,
    jurisdictions,
    debts: debtRows,
  }
}
