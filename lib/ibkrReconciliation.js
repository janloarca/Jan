// FASE GK (Fase 4 del plan IBKR interconectado): el tablero de conciliación.
//
// La captura de PortfolioAnalyst (resumen persistido en settings.ibkrPaSummary,
// FASE GI) afirma tres primitivas de POR VIDA de la cuenta: NAV al cierre de la
// foto, depósitos netos acumulados, y (por diferencia) la ganancia de por vida.
// Nuestro archivo afirma las mismas tres con lo que tiene: el NAV sincronizado
// más cercano a esa fecha, los flujos exactos importados más los inferidos
// aceptados, y su diferencia. Este módulo las pone lado a lado con el delta
// visible: cuando los tres deltas están dentro de tolerancia, la cuenta está
// literalmente "al cien" y se ve; cuando no, el delta dice exactamente qué
// primitiva falta (¿NAV viejo? ¿un depósito sin registrar?).
//
// A propósito NO intenta reproducir el % del período de PA (68.23% en el caso
// de referencia): ese número es un TWR encadenado sobre la serie completa del
// broker, y compararlo exigiría reconstruir su metodología exacta; las tres
// primitivas de arriba son la evidencia cruda de la que ese % se deriva, así
// que cuadrarlas ES cuadrar la historia. El % de PA se muestra como referencia.
//
// Puro, sin imports (jest-safe). Todo llega por argumentos; la conversión de
// moneda llega como función.

// paSummary: settings.ibkrPaSummary ({beginning, ending, change, netFlows,
//   returnPeriodPct, currency, savedAt}).
// transactions: todas; se filtran aquí a _source 'ibkr' / 'inferred_flow'.
// snapshots: todos; se filtran aquí a NAV real del broker (_source 'ibkr',
//   sin _account/_calibrated; los docs paralelos ~nav~ibkr califican igual).
// toUSD: (monto, moneda) => USD.
export function ibkrReconciliationReport({ paSummary, transactions, snapshots, toUSD } = {}) {
  const pa = paSummary
  if (!pa || !isFinite(pa.netFlows) || !isFinite(pa.ending)) return null
  const conv = typeof toUSD === 'function' ? toUSD : (v) => Number(v) || 0
  const cur = pa.currency || 'USD'
  const r2 = (v) => Math.round(v * 100) / 100
  // La foto solo pudo contener lo anterior a su fecha: todo lo nuestro se
  // recorta a ese mismo "hasta aquí" para comparar manzanas con manzanas.
  const asOfDate = typeof pa.savedAt === 'string' && pa.savedAt.length >= 10
    ? pa.savedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  const paEndingUSD = conv(pa.ending, cur)
  const paNetFlowsUSD = conv(pa.netFlows, cur)
  const paBeginningUSD = isFinite(pa.beginning) ? conv(pa.beginning, cur) : 0
  const paPlUSD = paEndingUSD - paBeginningUSD - paNetFlowsUSD

  let ourNavUSD = null
  let ourNavDate = null
  for (const s of snapshots || []) {
    if (!s || !s.date || s._account || s._calibrated) continue
    if (s._source !== 'ibkr') continue
    if (s.date > asOfDate) continue
    if (ourNavDate == null || s.date > ourNavDate) {
      ourNavDate = s.date
      ourNavUSD = s.netWorthUSD ?? s.totalActivosUSD ?? 0
    }
  }

  let ourNetFlowsUSD = 0
  let flowCount = 0
  for (const tx of transactions || []) {
    if (!tx || (tx._source !== 'ibkr' && tx._source !== 'inferred_flow')) continue
    const ty = (tx.type || '').toUpperCase()
    if (ty !== 'DEPOSIT' && ty !== 'WITHDRAWAL') continue
    if (tx.date && tx.date > asOfDate) continue
    const amt = conv(Number(tx.totalAmount || 0), tx.currency || 'USD')
    if (!isFinite(amt)) continue
    ourNetFlowsUSD += ty === 'DEPOSIT' ? amt : -amt
    flowCount++
  }

  const ourPlUSD = ourNavUSD != null ? ourNavUSD - ourNetFlowsUSD : null

  // Tolerancia por fila: el mayor entre $5 y 1% de la magnitud de PA. El NAV
  // "nuestro" puede ser de unos días antes de la foto (fines de semana,
  // fechas sin reporte), así que centavos exactos no son la vara; un delta
  // que sobrevive esta banda es un hueco real, no ruido de calendario.
  const tol = (ref) => Math.max(Math.abs(ref) * 0.01, 5)
  const row = (paUSD, oursUSD) => ({
    paUSD: r2(paUSD),
    oursUSD: oursUSD != null ? r2(oursUSD) : null,
    deltaUSD: oursUSD != null ? r2(oursUSD - paUSD) : null,
    ok: oursUSD != null && Math.abs(oursUSD - paUSD) <= tol(paUSD),
  })

  return {
    asOfDate,
    periodPct: isFinite(pa.returnPeriodPct) ? pa.returnPeriodPct : null,
    nav: { ...row(paEndingUSD, ourNavUSD), oursDate: ourNavDate },
    netFlows: { ...row(paNetFlowsUSD, ourNetFlowsUSD), count: flowCount },
    pl: row(paPlUSD, ourPlUSD),
  }
}
