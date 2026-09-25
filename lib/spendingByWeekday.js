// El ritmo de gasto: cuánto sale cada día, y qué días de la semana pesan más.
//
// Contesta dos preguntas distintas desde el MISMO cubo de datos:
//   · "semana a semana, cuánto se gasta cada día" — un HECHO por día, que se
//     puede mostrar siempre.
//   · "qué días gasto más y qué días gasto menos, y en qué" — un PATRÓN, que
//     solo se puede afirmar con suficientes observaciones.
// La segunda tiene pisos que la primera no necesita, y por eso viven separadas.
//
// ⛔ QUÉ CUENTA COMO GASTO NO SE REDEFINE ACÁ. `isSpendRow` y `txAmount` salen
// de lib/financeMonth.js, el MISMO par con el que `summarizeMonth` produce el
// total del mes, así que la suma de los cubos diarios de un mes ES el gasto de
// ese mes por construcción (lo fija un test de paridad). Con una copia de la
// regla, la rejilla y el encabezado del mes divergirían a la primera
// transferencia degradada (lib/cardPaymentNetting.js) que apareciera.

import { isSpendRow, txAmount } from '@/lib/financeMonth'
import { merchantRuleKey, merchantDisplay } from '@/lib/merchantLabels'

// ── Aritmética de calendario ────────────────────────────────────────────────
//
// El día de la semana sale de la CADENA 'YYYY-MM-DD' leída como fecha de
// calendario, jamás de `new Date(str)`: JS lee esa forma como medianoche UTC y
// en Guatemala (UTC-6) `getDay()` devuelve el día ANTERIOR, o sea cada fecha
// caería en el día de la semana equivocado. Es la misma trampa que la cabecera
// de lib/financeMonth.js ya prohíbe para comparar y que `formatFinanceDate` ya
// prohíbe para mostrar.
//
// `Date.UTC` se usa como MÁQUINA DE CONTAR DÍAS y nunca como instante: UTC no
// tiene horario de verano, así que sumar 86400000 siempre avanza exactamente un
// día calendario. La suite corre fijada en America/Guatemala (FASE LF), así que
// un reimplementado con `new Date(str)` falla de forma observable.
const DAY_MS = 86400000

function partsOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}

function utcOf(iso) {
  const p = partsOf(iso)
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null
}

function isoOf(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function addDaysISO(iso, n) {
  const ms = utcOf(iso)
  return ms == null ? null : isoOf(ms + n * DAY_MS)
}

// 0 = lunes. La semana arranca en lunes (convención local), así que el fin de
// semana queda junto al final de la fila en vez de partido entre dos filas.
export function weekdayOf(iso) {
  const ms = utcOf(iso)
  if (ms == null) return null
  return (new Date(ms).getUTCDay() + 6) % 7
}

export function weekStartOf(iso) {
  const w = weekdayOf(iso)
  return w == null ? null : addDaysISO(iso, -w)
}

// La ventana: los últimos N meses, terminando HOY y no a fin de mes.
//
// Que termine hoy no es un detalle: los días que todavía no ocurrieron son
// ocurrencias con gasto cero, y contarlos arrastraría hacia abajo el promedio
// de cada día de la semana en proporción a cuántos le tocaron. El mes en curso
// haría ver todo más barato solo por ser día 3.
export function windowRange(months, today) {
  const p = partsOf(today)
  if (!p) return null
  const n = Math.max(1, Math.floor(months) || 1)
  const startMonth = Date.UTC(p.y, p.m - 1 - (n - 1), 1)
  return { fromDate: isoOf(startMonth), toDate: today }
}

export function monthKeysBetween(fromDate, toDate) {
  const a = partsOf(fromDate)
  const b = partsOf(toDate)
  if (!a || !b) return []
  const out = []
  let y = a.y
  let m = a.m
  while (y < b.y || (y === b.y && m <= b.m)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

// Las ventanas que la card ofrece, en meses. Viven acá y no en el componente
// porque `lib/financeSections.js` tiene que preguntar por la MÁS ANCHA para
// decidir si la sección tiene contenido: con dos listas, la sección podría
// dibujar su encabezado sobre una card que ya se ocultó.
export const RHYTHM_WINDOWS = [1, 3, 6]
export const WIDEST_RHYTHM_MONTHS = Math.max(...RHYTHM_WINDOWS)

// ── Pisos de honestidad ─────────────────────────────────────────────────────

// Cuántas veces tiene que haberse observado un día de la semana antes de
// afirmar un patrón sobre él. Con 2 lunes, "los lunes gastás más" es ruido.
export const MIN_WEEKS_OBSERVED = 4

// Cuánto tiene que despegarse el día más caro del día típico para que valga
// nombrarlo. Por debajo, la respuesta honesta es "tus días son parejos", que
// también es información.
export const MIN_SPREAD_RATIO = 0.25

// El promedio de un día lo puede jalar un solo cargo grande (la prima anual que
// cayó un martes vuelve al martes "el día caro" para siempre). Se detecta
// comparando promedio contra MEDIANA y exigiendo además que ese cargo pese de
// verdad dentro del día.
export const PULL_RATIO = 1.6
export const PULL_SHARE = 0.3

// Para nombrar un comercio hace falta que se repita (no un cargo suelto) y que
// pese dentro del día. Si no, se cae a la categoría, que es una afirmación más
// débil pero cierta.
export const MERCHANT_MIN_SHARE = 0.2
export const MERCHANT_MIN_DAYS = 2
export const CATEGORY_MIN_SHARE = 0.25

function median(values) {
  const a = values.filter((v) => isFinite(v)).slice().sort((x, y) => x - y)
  if (a.length === 0) return 0
  const mid = a.length >> 1
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

function topOf(map, pick) {
  let best = null
  for (const entry of map.values()) {
    if (!best || pick(entry) > pick(best)) best = entry
  }
  return best
}

// ── El motor ────────────────────────────────────────────────────────────────

export function buildSpendingRhythm(transactions, {
  fromDate, toDate, convert = null, labelIndex = null, annualDates = null,
} = {}) {
  const empty = {
    days: [], weeks: [], profile: [], spent: 0, dayCount: 0,
    fromDate: null, toDate: null, typical: 0, claim: { status: 'insufficient', weeksObserved: 0 },
  }
  if (!partsOf(fromDate) || !partsOf(toDate) || toDate < fromDate) return empty

  const rows = (transactions || []).filter((tx) => isSpendRow(tx)
    && typeof tx.date === 'string' && tx.date >= fromDate && tx.date <= toDate)

  // La ventana se recorta al primer gasto que existe: promediar sobre meses de
  // los que no hay un solo dato no mide una conducta, mide un archivo vacío.
  // Los meses SIN datos diluirían los siete días por igual, así que el orden
  // sobreviviría pero los montos dejarían de significar nada.
  const start = rows.length
    ? rows.reduce((min, tx) => (tx.date < min ? tx.date : min), rows[0].date)
    : fromDate

  const byDate = new Map()
  const startMs = utcOf(start)
  const endMs = utcOf(toDate)
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const date = isoOf(ms)
    byDate.set(date, { date, weekday: weekdayOf(date), total: 0, count: 0, rows: [] })
  }

  let spent = 0
  for (const tx of rows) {
    const bucket = byDate.get(tx.date)
    if (!bucket) continue
    const amt = txAmount(tx, convert)
    bucket.total += amt
    bucket.count += 1
    bucket.rows.push({ tx, amount: amt })
    spent += amt
  }

  const days = Array.from(byDate.values())
  const annual = annualDates instanceof Set ? annualDates : new Set(annualDates || [])
  for (const d of days) {
    d.hasAnnual = annual.has(d.date)
    const big = d.rows.reduce((b, r) => (!b || r.amount > b.amount ? r : b), null)
    d.topLabel = big ? merchantDisplay(big.tx.merchant || big.tx.description || '', labelIndex) : null
  }

  // ── Semanas ───────────────────────────────────────────────────────────────
  // Siempre siete celdas: las que caen fuera de la ventana se marcan y se
  // dibujan vacías, nunca como un día de cero (que afirmaría que no gastaste).
  const weeks = []
  const firstWeek = weekStartOf(start)
  const lastWeek = weekStartOf(toDate)
  for (let ms = utcOf(firstWeek); ms <= utcOf(lastWeek); ms += 7 * DAY_MS) {
    const weekStart = isoOf(ms)
    const cells = []
    let total = 0
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(weekStart, i)
      const d = byDate.get(date)
      if (d) { cells.push({ ...d, inWindow: true }); total += d.total }
      else cells.push({ date, weekday: i, total: 0, count: 0, rows: [], inWindow: false, hasAnnual: false, topLabel: null })
    }
    weeks.push({ start: weekStart, end: addDaysISO(weekStart, 6), days: cells, total })
  }

  // ── Perfil por día de la semana ───────────────────────────────────────────
  //
  // El promedio es POR OCURRENCIA, jamás el total: tres meses traen 13 lunes y
  // 12 martes, así que comparar totales haría "ganar" al lunes por puro
  // calendario. Es la misma enfermedad que la ventana parcial de FASE JL.
  //
  // Un día en el que no se gastó nada SÍ es una ocurrencia: ese cero es
  // información sobre la conducta, no un hueco de datos.
  const profile = Array.from({ length: 7 }, (_, w) => {
    const mine = days.filter((d) => d.weekday === w)
    const totals = mine.map((d) => d.total)
    const occurrences = mine.length
    const total = totals.reduce((s, v) => s + v, 0)
    const avg = occurrences ? total / occurrences : 0
    const med = median(totals)

    const merchants = new Map()
    const categories = new Map()
    let biggest = null
    for (const d of mine) {
      for (const r of d.rows) {
        if (r.amount > (biggest?.amount || -Infinity)) {
          biggest = { amount: r.amount, date: d.date, label: merchantDisplay(r.tx.merchant || r.tx.description || '', labelIndex) }
        }
        const key = merchantRuleKey(r.tx.merchant || r.tx.description || '')
        if (key) {
          const e = merchants.get(key) || { key, sum: 0, dates: new Set(), label: merchantDisplay(r.tx.merchant || r.tx.description || '', labelIndex) }
          e.sum += r.amount
          e.dates.add(d.date)
          merchants.set(key, e)
        }
        const cat = r.tx.category || 'Otros Gastos'
        const c = categories.get(cat) || { category: cat, sum: 0 }
        c.sum += r.amount
        categories.set(cat, c)
      }
    }

    // El promedio lo jala un solo cargo: se DICE, nunca se esconde. El dinero
    // sigue entero en el total del día; lo que cambia es que se nombra.
    const pulled = total > 0 && biggest != null
      && avg >= med * PULL_RATIO
      && biggest.amount >= total * PULL_SHARE

    const topMerchant = topOf(merchants, (e) => e.sum)
    const merchantOk = topMerchant && total > 0
      && topMerchant.sum > 0
      && topMerchant.dates.size >= MERCHANT_MIN_DAYS
      && topMerchant.sum >= total * MERCHANT_MIN_SHARE

    const topCategory = topOf(categories, (e) => e.sum)
    const categoryOk = topCategory && total > 0
      && topCategory.sum >= total * CATEGORY_MIN_SHARE

    return {
      weekday: w,
      occurrences,
      total,
      avg,
      median: med,
      pulledBy: pulled ? biggest : null,
      merchant: merchantOk ? { label: topMerchant.label, sum: topMerchant.sum, days: topMerchant.dates.size } : null,
      category: categoryOk ? { category: topCategory.category, sum: topCategory.sum } : null,
    }
  })

  // ── La afirmación ─────────────────────────────────────────────────────────
  //
  // "Un día normal" es la MEDIANA de los siete promedios y no su media: con la
  // media, el propio día caro arrastra la vara contra la que se lo compara.
  const typical = median(profile.map((p) => p.avg))
  const weeksObserved = Math.min(...profile.map((p) => p.occurrences))
  const ranked = profile.filter((p) => p.occurrences > 0).slice().sort((a, b) => b.avg - a.avg)
  const top = ranked[0] || null
  const bottom = ranked[ranked.length - 1] || null

  let claim
  if (weeksObserved < MIN_WEEKS_OBSERVED || !top || !(top.avg > 0)) {
    claim = { status: 'insufficient', weeksObserved, typical, top: null, bottom: null, overPct: null }
  } else {
    // Sin día típico (la mediana en cero: se gasta solo dos días a la semana) el
    // porcentaje no existe, y eso NO invalida la afirmación: "los lunes son tu
    // día más caro, Q400 en promedio" sigue siendo cierto. Lo que se calla es
    // el "38% más", que sería una división entre cero disfrazada de dato.
    const overPct = typical > 0 ? ((top.avg - typical) / typical) * 100 : null
    const flat = overPct != null && overPct < MIN_SPREAD_RATIO * 100
    claim = { status: flat ? 'flat' : 'ok', weeksObserved, typical, top, bottom, overPct }
  }

  return { days, weeks, profile, spent, dayCount: days.length, fromDate: start, toDate, typical, claim }
}
