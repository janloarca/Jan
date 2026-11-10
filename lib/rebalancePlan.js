// FASE RQ. Rebalanceo accionable. Puro para poder probarlo.
//
// Antes la tarjeta decía "Reducir Acciones -$12,000" y nada más: ni con qué
// instrumento, ni si se puede llegar sin vender, ni cuánto impuesto dispara
// vender ese lote, ni que VOO ya contiene AAPL y MSFT (o sea que tener las dos
// cosas concentra más de lo que el desglose por tipo deja ver).

import { getItemValue, getTypeCategory } from '../components/dashboard/utils.js'

const LONG_TERM_DAYS = 365

// Ejemplos de instrumentos amplios por clase, para cuando no tienes ninguno de
// esa clase. Son ejemplos de vehículos comunes, no una recomendación.
export const EXAMPLE_INSTRUMENTS = {
  stocks: ['VTI', 'VOO'],
  funds: ['VT', 'VXUS'],
  bonds: ['BND', 'AGG'],
  banks: ['SGOV', 'BIL'],
  crypto: ['BTC'],
  alternatives: ['GLD'],
}

// Componentes conocidos de fondos índice comunes (pertenencia, no pesos: los
// pesos cambian a diario y no se inventan). Solo las empresas más grandes.
const SP500_TOP = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AVGO', 'TSLA', 'BRK.B', 'JPM', 'LLY', 'V', 'UNH', 'XOM', 'JNJ', 'WMT', 'MA', 'PG', 'HD', 'COST', 'NFLX']
const NASDAQ100_TOP = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AVGO', 'TSLA', 'COST', 'NFLX', 'AMD', 'PEP', 'ADBE']
export const FUND_CONSTITUENTS = {
  VOO: SP500_TOP, SPY: SP500_TOP, IVV: SP500_TOP, SPLG: SP500_TOP,
  VTI: SP500_TOP, ITOT: SP500_TOP, SCHB: SP500_TOP,
  QQQ: NASDAQ100_TOP, QQQM: NASDAQ100_TOP,
  VT: SP500_TOP, ACWI: SP500_TOP,
}

/** Fondos que ya contienen acciones que también tienes sueltas. */
export function fundOverlap(items) {
  const syms = new Set((items || []).filter((it) => !it.isDebt && it.symbol).map((it) => it.symbol.toUpperCase()))
  const out = []
  for (const fund of syms) {
    const members = FUND_CONSTITUENTS[fund]
    if (!members) continue
    const overlap = members.filter((m) => syms.has(m))
    if (overlap.length) out.push({ fund, overlap })
  }
  return out
}

/**
 * Llegar al objetivo SOLO con dinero nuevo: se reparte entre las clases que
 * quedan por debajo del objetivo calculado sobre el total + el aporte, en
 * proporción a cuánto les falta. Nunca vende.
 */
export function contributionPlan(categories, totalAssets, newMoney) {
  const amt = Number(newMoney)
  if (!(amt > 0)) return { allocations: [], remainingDrift: null }
  const total = totalAssets + amt
  const gaps = categories.map((c) => ({ cat: c.cat, gap: Math.max(0, (c.targetPct / 100) * total - c.current) }))
  const sumGap = gaps.reduce((s, g) => s + g.gap, 0)
  if (sumGap <= 0) return { allocations: [], remainingDrift: 0 }
  const scale = Math.min(1, amt / sumGap)
  const allocations = gaps.filter((g) => g.gap > 0).map((g) => ({ cat: g.cat, amount: g.gap * scale }))
    .sort((a, b) => b.amount - a.amount)
  const coversAll = amt >= sumGap
  return { allocations, coversAll, neededToBalance: sumGap }
}

/**
 * Qué vender dentro de una clase sobreponderada, lote por lote, con el
 * impacto fiscal: ganancia no realizada y plazo (corto/largo).
 */
export function sellCandidates({ cat, amount, items, lots, now = new Date() }) {
  const inCat = (items || []).filter((it) => !it.isDebt && getTypeCategory(it) === cat)
    .sort((a, b) => getItemValue(b) - getItemValue(a))
  const nowTs = now.getTime()
  return inCat.slice(0, 3).map((it) => {
    const price = it.quantity > 0 ? getItemValue(it) / it.quantity : (it.currentPrice || 0)
    const itLots = (lots || []).filter((l) => l.status === 'open' && Number(l.quantity) > 0 &&
      (l.itemId ? l.itemId === it.id : (l.symbol || '').toUpperCase() === (it.symbol || '').toUpperCase()))
    const lotInfo = itLots.map((l) => {
      const ts = Date.parse(String(l.acquisitionDate || '').slice(0, 10))
      const days = isFinite(ts) ? Math.floor((nowTs - ts) / 86400000) : null
      const gainPerUnit = price - (Number(l.costBasis) || 0)
      return { since: isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null, qty: Number(l.quantity), gainPerUnit, term: days == null ? null : (days > LONG_TERM_DAYS ? 'long' : 'short') }
    }).sort((a, b) => (b.term === 'long') - (a.term === 'long') || b.gainPerUnit - a.gainPerUnit)
    const units = price > 0 ? Math.min(Number(it.quantity) || 0, amount / price) : 0
    return { item: it, units, value: units * price, lots: lotInfo }
  })
}
