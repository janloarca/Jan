// Desglose de Ingresos Pasivos por mes: QUÉ cobraste (o qué viene) y de QUÉ
// cuenta. Puro, sin React: la card lo consume y los tests lo fijan.
//
// Una sola fuente para tres superficies que antes calculaban por su cuenta y
// ya habían divergido:
//  · la barra del historial y el popup de un mes cobrado (`buildReceivedByMonth`),
//  · la barra "mes a mes", el calendario y la lista de próximos pagos
//    (`projectNext12`): el calendario recorría enero a diciembre con el calendario
//    CONFIGURADO y no descontaba lo ya cobrado este mes, mientras la barra de
//    al lado sí; el mismo mes decía dos cifras distintas en la misma card,
//  · la comparación contra el año pasado (`yoySamePeriod`), que enfrentaba el
//    año pasado COMPLETO contra este año a la fecha y así subestimaba (o
//    sobreestimaba) el crecimiento según el mes en que se mirara.
import { itemLabel, getTypeCategory } from '@/components/dashboard/utils'
import { isReinvestedDividend, reinvestIndex } from './dividendCash'
import { ymOfDate, ymdOfDate } from './dateParts'
import { clampPayDay } from './incomeSchedule'

export const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`

export function incomeTypeOf(item) {
  const cat = getTypeCategory(item?.type)
  return cat === 'bonds' ? 'coupon' : cat === 'banks' ? 'interest' : 'dividend'
}

const finite = (n) => (Number.isFinite(n) ? n : 0)
const isDividend = (tx) => (tx?.type || '').toUpperCase() === 'DIVIDEND'

// Pagos recibidos agrupados por mes y, dentro del mes, por activo. El total de
// `rows` es EXACTAMENTE lo que dibuja la barra de ese mes: lo reinvertido no
// entra a él (no es efectivo cobrado) y se lista aparte para que quien lo
// busque lo encuentre en vez de pensar que falta un pago.
export function buildReceivedByMonth({ transactions, items, convert, baseCurrency }) {
  const base = baseCurrency || 'USD'
  const idx = reinvestIndex(items)
  const byId = new Map((items || []).map((it) => [it?.id, it]))
  const months = {}

  ;(transactions || []).forEach((tx) => {
    if (!isDividend(tx)) return
    const ym = ymOfDate(tx.date)
    if (!ym) return
    const key = monthKey(ym.y, ym.m)
    const reinvested = isReinvestedDividend(tx, idx)
    const cur = tx.currency || 'USD'
    const raw = finite(Number(tx.totalAmount ?? 0))
    const amount = finite(convert ? convert(raw, cur, base) : raw)

    const bucket = months[key] || (months[key] = {
      key, year: ym.y, month: ym.m, total: 0, reinvestedTotal: 0,
      cash: new Map(), reinvested: new Map(),
    })
    const map = reinvested ? bucket.reinvested : bucket.cash
    if (reinvested) bucket.reinvestedTotal += amount
    else bucket.total += amount

    const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
    const rowKey = tx._linkedItemId || `sym:${tx.symbol || tx.description || ''}`
    let row = map.get(rowKey)
    if (!row) {
      const dest = tx._destinationItemId && tx._destinationItemId !== tx._linkedItemId
        ? byId.get(tx._destinationItemId) : null
      row = {
        id: rowKey,
        label: linked ? itemLabel(linked) : (tx.symbol || tx.description || '?'),
        incomeType: incomeTypeOf(linked),
        amount: 0, count: 0, dates: [],
        nativeByCur: {},
        destLabel: dest ? itemLabel(dest) : null,
      }
      map.set(rowKey, row)
    }
    row.amount += amount
    row.count += 1
    const d = ymdOfDate(tx.date)
    if (d) row.dates.push(d)
    row.nativeByCur[cur] = (row.nativeByCur[cur] || 0) + raw
  })

  const finish = (map) => [...map.values()].map((r) => {
    const curs = Object.keys(r.nativeByCur)
    const { nativeByCur, ...rest } = r
    return {
      ...rest,
      dates: r.dates.sort(),
      // Solo se muestra el monto original cuando es de UNA moneda y no es la
      // base: con varias, sumarlas en crudo sería mezclar monedas.
      native: curs.length === 1 && curs[0] !== base ? { amount: nativeByCur[curs[0]], currency: curs[0] } : null,
    }
  }).sort((a, b) => b.amount - a.amount)

  const out = {}
  Object.values(months).forEach((b) => {
    out[b.key] = {
      key: b.key, year: b.year, month: b.month,
      total: b.total, reinvestedTotal: b.reinvestedTotal,
      rows: finish(b.cash), reinvestedRows: finish(b.reinvested),
    }
  })
  return out
}

// Los próximos 12 meses, EMPEZANDO en el actual (nunca en enero), con el
// desglose por activo de cada mes. Un activo que YA registró su pago este mes
// no vuelve a contarse en el mes en curso.
export function projectNext12(sources, paidItemIds, now = new Date()) {
  const cy = now.getFullYear()
  const cm = now.getMonth()
  const paid = paidItemIds || new Set()
  const out = []
  for (let offset = 0; offset < 12; offset++) {
    const m = (cm + offset) % 12
    const y = cy + Math.floor((cm + offset) / 12)
    out.push({ key: monthKey(y, m), month: m, year: y, offset, value: 0, rows: [], paidCount: 0 })
  }
  ;(sources || []).forEach((s) => {
    const months = s.months || []
    const perPayment = s.annual / (months.length || 12)
    for (let offset = 0; offset < 12; offset++) {
      const b = out[offset]
      if (!months.includes(b.month)) continue
      if (offset === 0 && paid.has(s.id)) { b.paidCount += 1; continue }
      b.value += perPayment
      b.rows.push({
        id: s.id, label: s.label, amount: perPayment,
        day: clampPayDay(s.payDay, b.year, b.month),
        incomeType: s.incomeType, destLabel: s.destLabel || null, reinvest: !!s.reinvest,
      })
    }
  })
  out.forEach((b) => b.rows.sort((a, c) => a.day - c.day || c.amount - a.amount))
  return out
}

// Este año a la fecha contra el año pasado HASTA EL MISMO DÍA. Comparar contra
// el año pasado completo hace que el porcentaje dependa de en qué mes lo mires.
// Si el año pasado no tenía nada en ese tramo pero sí después, no hay base
// comparable: se muestra el año completo y sin porcentaje.
export function yoySamePeriod({ transactions, items, convert, baseCurrency, now = new Date() }) {
  const idx = reinvestIndex(items)
  const base = baseCurrency || 'USD'
  const ty = now.getFullYear()
  const ly = ty - 1
  const cutoff = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let thisYear = 0, lastSame = 0, lastFull = 0
  let any = false
  ;(transactions || []).forEach((tx) => {
    if (!isDividend(tx) || isReinvestedDividend(tx, idx)) return
    const ymd = ymdOfDate(tx.date)
    if (!ymd) return
    const y = Number(ymd.slice(0, 4))
    if (y !== ty && y !== ly) return
    any = true
    const raw = finite(Number(tx.totalAmount ?? 0))
    const amt = finite(convert ? convert(raw, tx.currency || 'USD', base) : raw)
    if (y === ty) thisYear += amt
    else {
      lastFull += amt
      if (ymd.slice(5) <= cutoff) lastSame += amt
    }
  })
  if (!any) return null
  const samePeriod = lastSame > 0
  const lastYear = samePeriod ? lastSame : lastFull
  const growth = samePeriod ? ((thisYear - lastSame) / lastSame) * 100 : null
  return { thisYear, lastYear, lastYearFull: lastFull, samePeriod, growth }
}
