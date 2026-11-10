// FASE RQ. "Lo invertible": activos que se pueden rebalancear, comparar contra
// un índice o mover para alcanzar una meta. Fuera: deudas, lo excluido del
// patrimonio y la VIVIENDA. Una casa pesa 72% del activo de este usuario y
// metida en una meta de portafolio la daba "superada 3.5x" sin que la cartera
// invertida estuviera cerca; en riesgo y rendimiento, una valuación que se
// mueve dos veces al año aplana la volatilidad y mezcla otra pregunta.
// Una sola definición, para que meta, riesgo y rendimiento no discrepen.

import { getItemValue, getTypeCategory, isExcludedFromNetWorth } from '../components/dashboard/utils.js'

export function isInvestable(it) {
  if (!it || it.isDebt) return false
  if (isExcludedFromNetWorth(it)) return false
  return getTypeCategory(it.type) !== 'realestate'
}

export function investableValue(items) {
  return (items || []).reduce((s, it) => (isInvestable(it) ? s + (getItemValue(it) || 0) : s), 0)
}

export function realEstateValue(items) {
  return (items || []).reduce((s, it) => (!it?.isDebt && !isExcludedFromNetWorth(it) && getTypeCategory(it.type) === 'realestate' ? s + (getItemValue(it) || 0) : s), 0)
}

// Serie de snapshots SIN la vivienda, para riesgo comparable. Aproximación
// declarada: la casa se resta a su valor de HOY desde su fecha de compra (una
// valuación manual casi nunca se mueve dentro de la ventana, y restarla deja
// la volatilidad de lo que de verdad cotiza). `toUSD` convierte de la moneda
// base de los ítems a USD, que es la unidad de los snapshots.
export function snapshotsWithoutRealEstate(snapshots, items, toUSD = (v) => v) {
  const homes = (items || []).filter((it) => !it?.isDebt && !isExcludedFromNetWorth(it) && getTypeCategory(it.type) === 'realestate')
  if (homes.length === 0) return snapshots || []
  const parts = homes.map((it) => ({
    usd: toUSD(getItemValue(it) || 0),
    from: String(it.acquisitionDate || '').slice(0, 10) || null,
  }))
  return (snapshots || []).map((s) => {
    const d = String(s.date || '').slice(0, 10)
    const re = parts.reduce((sum, p) => (!p.from || d >= p.from ? sum + p.usd : sum), 0)
    if (re <= 0) return s
    const out = { ...s }
    if (typeof s.netWorthUSD === 'number') out.netWorthUSD = s.netWorthUSD - re
    if (typeof s.totalActivosUSD === 'number') out.totalActivosUSD = s.totalActivosUSD - re
    return out
  })
}

// TWR del año en curso sobre la serie de snapshots: encadena los retornos de
// cada tramo (cada uno neteando sus flujos), así el momento de los aportes no
// cuenta. Es lo comparable contra un índice. null sin dos puntos del año.
export function ytdTwrFromSnapshots(snapshots, transactions, convert, computePeriodicReturns, now = new Date()) {
  const y = now.getFullYear()
  const start = `${y}-01-01`
  const sorted = [...(snapshots || [])].filter((s) => s && s.date && !s._calibrated && !s._account)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  let anchorIdx = -1
  for (let i = 0; i < sorted.length; i++) { if (String(sorted[i].date).slice(0, 10) <= start) anchorIdx = i }
  const win = sorted.slice(Math.max(0, anchorIdx)).filter((s, i) => i === 0 || String(s.date).slice(0, 4) === String(y))
  if (win.length < 2 || String(win[win.length - 1].date).slice(0, 4) !== String(y)) return null
  const rets = computePeriodicReturns(win, transactions, convert, 'USD')
  if (!rets.length) return null
  const g = rets.reduce((p, r) => p * (1 + r), 1) - 1
  return isFinite(g) ? g * 100 : null
}
