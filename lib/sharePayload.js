// FASE KK. Lo que un link compartido publica.
//
// Antes esta forma no existía: `app/api/share/route.js` mandaba los documentos
// CRUDOS de Firestore y `app/shared/[token]/page.jsx` los sumaba a mano. Eso la
// convertía en un TERCER generador de las mismas cifras, con los defectos que
// el resto de la app ya había arreglado en otro lado: sin conversión de moneda
// (un saldo en quetzales impreso con `$`), sin precios de mercado en vivo
// (`currentPrice` no se persiste por diseño, FASE EZ4), sin
// `isExcludedFromNetWorth`, con la gráfica dibujando los docs paralelos de NAV
// solo-broker al lado de los de portafolio completo (el diente de sierra), y
// con el retorno como `(último − primero) / primero` crudo, que es el error #3
// de la lógica congelada y el mismo `+1148.8%` que FASE HT sacó del PDF.
//
// Ahora el servidor manda CIFRAS y la página solo las dibuja. El motor es
// `buildReportData`, el mismo que alimenta el reporte PDF, así que el link y el
// PDF no pueden decir cosas distintas del mismo portafolio.
//
// ⚠️ Esto se PUBLICA: cualquiera con el link lo ve. Toda clave que se agregue
// acá sale del dominio del dueño. `lib/__tests__/sharePayload.test.js` fija el
// contrato, en particular que el modo 'percent' no emita un solo monto.

// Un link puede publicar montos, porcentajes, o las dos cosas.
//   'both'    todo (default)
//   'amounts' montos sí, rendimiento no
//   'percent' porcentajes sí, montos NO: no se emite ninguno.
//
// El modo 'percent' antes escalaba `quantity` y seis campos de precio por √k
// para que los ratios sobrevivieran al enmascarado. Con un payload calculado
// eso no hace falta: los montos simplemente no se emiten, que es más simple y
// más difícil de romper que una transformación que tiene que preservar
// exactamente las razones correctas.
export const DISPLAY_MODES = ['both', 'amounts', 'percent']

export function sanitizeDisplay(raw) {
  return DISPLAY_MODES.includes(raw) ? raw : 'both'
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)

// La serie en porcentaje, rebasada a su primer punto. Es lo que deja dibujar la
// misma forma sin publicar un solo valor: en 'percent' la gráfica sigue
// contando la historia y no dice cuánto dinero hay.
function rebasePct(series) {
  const first = series.find((p) => p.value > 0)
  if (!first) return []
  return series.map((p) => ({ ts: p.ts, date: p.date, pct: ((p.value - first.value) / first.value) * 100 }))
}

/**
 * Proyecta la salida de `buildReportData` a lo que el link publica.
 *
 * @param report  salida de buildReportData
 * @param opts.display        'both' | 'amounts' | 'percent'
 * @param opts.label          etiqueta del link (la escribe el dueño)
 * @param opts.scopeLabel     qué abarca ("Todo", "IDC", el nombre del portafolio)
 * @param opts.hasSeries      false en un link escopado: los snapshots son
 *                            patrimonio GLOBAL y no describen una rebanada
 * @param opts.incomeSources  [{ name, rateLabel, annual }] para la sección de ingresos
 * @param opts.degraded       true si alguna cotización no resolvió
 * @param opts.failedSymbols  cuáles, para poder decirlo en vez de callarlo
 */
export function buildSharePayload(report, {
  display = 'both', label = null, scopeLabel = null, hasSeries = true,
  incomeSources = [], degraded = false, failedSymbols = [],
} = {}) {
  const mode = sanitizeDisplay(display)
  const showAmounts = mode !== 'percent'
  const showPerf = mode !== 'amounts'

  const k = report?.kpis || {}
  const meta = report?.meta || {}
  const series = hasSeries ? (report?.series || []) : []

  const kpis = {}
  if (showAmounts) {
    kpis.netWorth = num(k.netWorth) ?? 0
    kpis.totalAssets = num(k.totalAssets) ?? 0
    kpis.debtTotal = num(k.debtTotal) ?? 0
  }
  kpis.holdingsCount = report?.holdings?.length || 0
  if (showPerf) {
    // El retorno del año y el de toda la vida salen del motor del reporte: son
    // Dietz sobre la serie archivada, con los flujos neteados. Nunca el cambio
    // crudo de valor, que lee un depósito como ganancia.
    if (k.ytd) kpis.ytd = { pct: num(k.ytd.pct), ...(showAmounts ? { abs: num(k.ytd.abs) } : {}) }
    if (k.sinceStart) kpis.sinceStart = { pct: num(k.sinceStart.pct), date: k.sinceStart.date || null }
  }

  const holdings = (report?.holdings || []).map((h) => ({
    id: h.id,
    name: h.name,
    symbol: h.symbol || null,
    type: h.type || null,
    weightPct: num(h.weightPct) ?? 0,
    ...(showAmounts ? { value: num(h.value) ?? 0 } : {}),
    // El retorno por posición es el de la fórmula congelada
    // (ganancia contra el principal más el ingreso que el activo GENERÓ,
    // dividido entre el costo total), no `(actual − compra) / compra`, que
    // imprime 0.0% sobre un bono que sí está pagando cupones.
    ...(showPerf ? { retPct: num(h.retPct) } : {}),
  }))

  const allocation = (report?.allocation || []).map((a) => ({
    cat: a.cat,
    count: a.count,
    pct: num(a.pct) ?? 0,
    ...(showAmounts ? { value: num(a.value) ?? 0 } : {}),
  }))

  const maturities = (report?.maturities || []).map((m) => ({
    name: m.name,
    date: m.date,
    days: m.days,
    ...(showAmounts ? { value: num(m.value) ?? 0 } : {}),
  }))

  const income = showAmounts
    ? {
      projectedAnnual: num(report?.income?.projectedAnnual) ?? 0,
      yieldPct: num(report?.income?.yieldPct),
      sources: incomeSources.map((s) => ({ name: s.name, rateLabel: s.rateLabel, annual: num(s.annual) })),
    }
    : {
      yieldPct: num(report?.income?.yieldPct),
      sources: incomeSources.map((s) => ({ name: s.name, rateLabel: s.rateLabel })),
    }

  return {
    display: mode,
    owner: meta.owner || '',
    asOf: num(meta.generatedTs),
    baseCurrency: meta.baseCurrency || 'USD',
    label: label || null,
    scopeLabel: scopeLabel || null,
    hasSeries,
    kpis,
    allocation,
    holdings,
    // En 'percent' la serie viaja rebasada: misma forma, cero montos.
    series: showAmounts
      ? series.map((p) => ({ ts: p.ts, date: p.date, value: num(p.value) ?? 0 }))
      : rebasePct(series),
    income,
    maturities,
    degraded: !!degraded,
    failedSymbols: degraded ? failedSymbols.slice(0, 10) : [],
  }
}

// El riesgo que la página muestra (concentración) se deriva ENTERO de los pesos
// que ya vienen en `holdings`, así que el conteo de posiciones de esta tarjeta y
// el del pie de la asignación no pueden volver a discrepar: hoy dicen 33 y 32
// porque cada uno cuenta sobre una lista distinta.
export function concentrationFrom(holdings = [], categoryCount = 0) {
  const weights = holdings.map((h) => h.weightPct || 0).filter((w) => w > 0).sort((a, b) => b - a)
  if (weights.length === 0) return null
  const hhi = weights.reduce((s, w) => s + w * w, 0)
  const largest = weights[0]
  const top3 = weights.slice(0, 3).reduce((s, w) => s + w, 0)

  let score = 100
  if (hhi > 5000) score -= 30
  else if (hhi > 2500) score -= 15
  if (largest > 50) score -= 25
  else if (largest > 30) score -= 10
  if (categoryCount < 3) score -= 20
  else if (categoryCount < 5) score -= 5

  return {
    score: Math.max(0, Math.min(100, score)),
    positions: weights.length,
    categories: categoryCount,
    largestPct: largest,
    top3Pct: top3,
  }
}
