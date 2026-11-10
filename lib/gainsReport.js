// FASE RQ. Ganancias realizadas / no realizadas por posición, separando lo
// INVERTIBLE del inmueble. Puro para poder probarlo.
//
// Por qué: "No realizada $52,572.23" incluía $25,000 de plusvalía de la casa, y
// ese número se leía como el P&L de la cartera. Una vivienda no es una
// posición que uno rebalancee ni venda para tomar ganancia: se reporta aparte.
// Y cada posición ahora dice costo por unidad y desde cuándo se tiene (plazo
// del lote más viejo abierto), que es lo que decide corto vs largo plazo.

import { getTypeCategory } from '../components/dashboard/utils.js'

const LONG_TERM_DAYS = 365

export function isRealEstateItem(it) {
  return !!it && getTypeCategory(it.type) === 'realestate'
}

function findItem(lot, items, bySym) {
  if (lot.itemId) {
    const hit = items.find((it) => it.id === lot.itemId)
    if (hit) return hit
  }
  return bySym.get((lot.symbol || '').toUpperCase()) || null
}

export function buildGainsReport({ lots = [], items = [], convert, baseCurrency = 'USD', now = new Date() }) {
  if (!lots || lots.length === 0) return null
  const base = baseCurrency || 'USD'
  const toBase = (v, lot) => {
    const c = lot.currency || base
    return convert && c !== base ? convert(v, c, base) : v
  }
  const bySym = new Map()
  ;(items || []).forEach((it) => { if (it.symbol) bySym.set(it.symbol.toUpperCase(), it) })

  const rows = {}
  const nowTs = now.getTime()
  for (const lot of lots) {
    const sym = lot.symbol || 'Unknown'
    const item = findItem(lot, items || [], bySym)
    const realEstate = isRealEstateItem(item)
    const key = `${realEstate ? 're' : 'inv'}:${sym}`
    if (!rows[key]) rows[key] = { symbol: sym, name: item?.name || sym, realEstate, realized: 0, unrealized: 0, openQty: 0, openCost: 0, oldestTs: null, closedLots: 0, openLots: 0 }
    const r = rows[key]
    if (lot.status === 'closed' && lot.realizedGain != null) {
      r.realized += toBase(Number(lot.realizedGain) || 0, lot)
      r.closedLots += 1
    } else if (lot.status === 'open' && Number(lot.quantity) > 0) {
      const qty = Number(lot.quantity)
      const costInBase = toBase(Number(lot.costBasis) || 0, lot)
      const price = item?.currentPrice || item?.purchasePrice || costInBase
      r.unrealized += (price - costInBase) * qty
      r.openQty += qty
      r.openCost += costInBase * qty
      r.openLots += 1
      const ts = Date.parse(String(lot.acquisitionDate || '').slice(0, 10))
      if (isFinite(ts) && (r.oldestTs == null || ts < r.oldestTs)) r.oldestTs = ts
    }
  }

  const list = Object.values(rows).map((r) => {
    const heldDays = r.oldestTs == null ? null : Math.max(0, Math.floor((nowTs - r.oldestTs) / 86400000))
    return {
      ...r,
      total: r.realized + r.unrealized,
      avgCost: r.openQty > 0 ? r.openCost / r.openQty : null,
      heldDays,
      term: heldDays == null ? null : (heldDays > LONG_TERM_DAYS ? 'long' : 'short'),
      since: r.oldestTs == null ? null : new Date(r.oldestTs).toISOString().slice(0, 10),
    }
  }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
  const inv = list.filter((r) => !r.realEstate)
  const re = list.filter((r) => r.realEstate)
  return {
    investable: { realized: sum(inv, 'realized'), unrealized: sum(inv, 'unrealized'), total: sum(inv, 'total'), symbols: inv },
    realEstate: { realized: sum(re, 'realized'), unrealized: sum(re, 'unrealized'), total: sum(re, 'total'), symbols: re },
  }
}
