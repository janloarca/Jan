// Rendimiento propio de una cuenta líquida, deducido del saldo que el usuario
// teclea en vez de una tasa que no conoce con precisión.
//
// Caso de referencia: IDC. Tres bonos pagan cupón EN EFECTIVO a un fondo
// líquido, y ese fondo además rinde lo suyo a una tasa variable (4%-5%). El
// usuario sabe leer el saldo de su estado de cuenta; NO sabe qué tasa exacta le
// pagaron cada mes. Así que el saldo es el dato duro y la tasa es lo que se
// deduce, no al revés.
//
//   interés propio = saldo tecleado - aportes que ya conocíamos
//
// donde "aportes conocidos" son los movimientos que la app ya tiene archivados
// (depósito de apertura, cupones ruteados a esta cuenta, transferencias) hasta
// la fecha del saldo. Lo que sobra solo pudo generarlo la cuenta.
//
// La spec completa, con los invariantes y por qué cada regla existe, está en
// `lib/assetLogic/liquidFundYield.js`.
//
// Dos propiedades que este módulo tiene que garantizar, y que sus tests fijan:
//
//  1. IDENTIDAD: Σ aportes + Σ interés repartido == saldo tecleado, al centavo.
//     No por suerte: la tasa se resuelve justamente para que cierre, y el
//     redondeo a centavos se cuadra contra el último mes.
//  2. INDEPENDENCIA DEL ORDEN DE CARGA: cargar primero los bonos y después el
//     fondo tiene que dar el mismo resultado que al revés. El motor solo mira
//     los aportes que existen HOY y el saldo de HOY, nunca en qué orden se
//     tecleó nada.

import { xirr } from './ventureMetrics'

const DAY = 86400000
// 365.25, no 365, y no es un detalle: tiene que ser EXACTAMENTE la convención
// que usa `xnpv` (lib/ventureMetrics.js), que es quien resuelve la tasa. Con 365
// aquí y 365.25 allá, componer hacia adelante con la tasa que el solver devolvió
// aterriza a ~10 centavos del saldo tecleado sobre dos años, y la identidad que
// sostiene todo este módulo deja de cerrar. Lo cazó el test que reconstruye el
// saldo desde la tasa implícita.
const YEAR_DAYS = 365.25

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const toTs = (d) => {
  if (d == null || d === '') return null
  const s = typeof d === 'string' && d.length === 10 ? `${d}T00:00:00Z` : d
  const t = new Date(s).getTime()
  return Number.isFinite(t) ? t : null
}
const monthKeyOf = (ts) => new Date(ts).toISOString().slice(0, 7)
const isoDay = (ts) => new Date(ts).toISOString().slice(0, 10)
const startOfNextMonth = (ts) => {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

// Un residuo por debajo de esto es redondeo del estado de cuenta, no
// rendimiento: no vale la pena escribir 26 transacciones por 40 centavos.
export const NEGLIGIBLE_PCT = 0.5
// Por encima de esto la explicación probable NO es un fondo generoso: es un
// depósito sin registrar. No se aplica solo, se marca para que el usuario mire.
export const MAX_PLAUSIBLE_RATE_PCT = 25
// Y si el usuario ya declaró su tasa, el mismo criterio pero relativo a ella.
export const DECLARED_RATE_FACTOR = 3

// --- Aportes conocidos -------------------------------------------------------

// Todo lo que ENTRÓ o SALIÓ de esta cuenta por una vía que la app ya archiva,
// hasta `asOfTs`, en la moneda de la CUENTA.
//
// El enrutado espeja `indexBalanceEvents` (lib/historicalValues.js) a propósito:
// si esta función contara un movimiento que aquel motor no rebobina (o al
// revés), el interés deducido y la reconstrucción del pasado dirían cosas
// distintas sobre la misma cuenta.
//
// Lo que NO cuenta como aporte, y es la mitad importante de la regla: el
// ingreso que esta MISMA cuenta generó. Eso es exactamente lo que estamos
// deduciendo, así que meterlo del lado de los aportes lo haría desaparecer del
// residuo. Cubre tanto lo que escribió el motor automático (`_source:'auto'`
// reinvertido) como lo que escribió una corrida previa de esta inferencia
// (`_source:'inferred_yield'`).
export function knownContributions({ item, items, transactions, convert, asOfTs } = {}) {
  if (!item || !item.id) return []
  const cur = item.currency || item._originalCurrency || 'USD'
  const conv = (amt, from) => {
    const a = num(amt)
    if (!convert || !from || from === cur) return a
    const out = Number(convert(a, from, cur))
    return Number.isFinite(out) ? out : a
  }

  const byId = new Map()
  const bySym = new Map()
  const byName = new Map()
  for (const it of items || []) {
    if (it?.id) byId.set(it.id, it)
    if (it?.symbol) bySym.set(String(it.symbol).toUpperCase(), it)
    if (it?.name) byName.set(String(it.name).toUpperCase(), it)
  }
  const resolveRef = (ref) => {
    if (!ref) return null
    return byId.get(ref) || bySym.get(String(ref).toUpperCase()) || byName.get(String(ref).toUpperCase()) || null
  }
  const destinationOf = (tx) => {
    if (tx._destinationItemId && byId.get(tx._destinationItemId)) return byId.get(tx._destinationItemId)
    const linked = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
    if (!linked || !linked.incomeDestination) return null
    if (tx._reinvested === true || linked.dividendAction === 'reinvest') return null
    return resolveRef(linked.incomeDestination)
  }

  const out = []
  for (const tx of transactions || []) {
    if (!tx) continue
    const ts = toTs(tx.date)
    if (ts == null) continue
    if (asOfTs != null && ts > asOfTs) continue
    if (tx._source === 'inferred_yield') continue
    const ty = String(tx.type || '').toUpperCase()
    const raw = Math.abs(num(tx.totalAmount ?? tx.amount))
    if (!(raw > 0)) continue
    const amount = conv(raw, tx.currency)
    const mine = tx._linkedItemId === item.id

    // `source` y `date` viajan con cada movimiento para que la UI pueda
    // BORRARLO bien: un pago que escribió el motor automático (`_source:'auto'`)
    // se regenera solo en la siguiente corrida si no se excluye además su fecha
    // en el activo que lo produce, así que borrarlo a secas no sirve de nada.
    const meta = { txId: tx.id, source: tx._source || null, date: tx.date || null, sourceItemId: tx._linkedItemId || null }
    if (ty === 'DEPOSIT' && mine) out.push({ ts, amount, kind: 'deposit', ...meta })
    else if (ty === 'WITHDRAWAL' && mine) out.push({ ts, amount: -amount, kind: 'withdrawal', ...meta })
    else if (ty === 'DIVIDEND') {
      // El ingreso que esta cuenta produjo NO es aporte: es el rendimiento que
      // estamos deduciendo. Solo cuenta el que viene de OTRO activo.
      if (mine) continue
      const dest = destinationOf(tx)
      if (dest && dest.id === item.id) out.push({ ts, amount, kind: 'income', ...meta })
    } else if (ty === 'SELL' && tx._destinationItemId === item.id) {
      out.push({ ts, amount, kind: 'sale', ...meta })
    } else if (ty === 'TRANSFER') {
      if (tx._linkedItemId === item.id) out.push({ ts, amount, kind: 'transfer-in', ...meta })
      else if (tx._originItemId === item.id) out.push({ ts, amount: -amount, kind: 'transfer-out', ...meta })
    }
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

// --- Tasa implícita ----------------------------------------------------------

// Los aportes son entradas y el saldo final es el valor terminal, así que la
// tasa que los concilia ES un IRR. Se resuelve con el `xirr` que ya existe
// (Newton-Raphson con fallback de bisección determinista, `lib/ventureMetrics`):
// devuelve null cuando no hay solución en vez de un número inventado.
export function impliedYieldRate(contributions, finalBalance, asOfTs) {
  const flows = (contributions || [])
    .filter((c) => c && Number.isFinite(c.ts) && num(c.amount) !== 0)
    .map((c) => ({ ts: c.ts, amount: -num(c.amount) }))
  if (flows.length === 0) return null
  flows.push({ ts: asOfTs, amount: num(finalBalance) })
  const r = xirr(flows)
  return r == null ? null : r * 100
}

// --- Reparto en el tiempo ----------------------------------------------------

// Compone hacia adelante desde el primer aporte, partiendo la línea de tiempo en
// CADA fecha de aporte además de en cada cambio de mes. Ese detalle no es
// cosmético: un cupón que entra el 15 tiene que empezar a rendir el 15, no el 1
// del mes siguiente, y sin partir ahí la suma no aterriza en el saldo tecleado.
//
// Devuelve el interés agregado por mes (para escribir UNA transacción mensual,
// que es como paga un fondo líquido de verdad y como el motor automático ya
// escribe el rendimiento de ClubCashIn) y el saldo final que resulta.
export function accrualSchedule(contributions, ratePct, { startTs, endTs } = {}) {
  const list = (contributions || []).filter((c) => c && Number.isFinite(c.ts)).sort((a, b) => a.ts - b.ts)
  if (list.length === 0 || endTs == null) return { months: [], finalBalance: 0, interest: 0 }
  const start = startTs != null ? startTs : list[0].ts
  if (!(endTs > start)) return { months: [], finalBalance: list.reduce((s, c) => s + num(c.amount), 0), interest: 0 }

  const r = num(ratePct) / 100
  const bounds = new Set([endTs])
  for (const c of list) if (c.ts > start && c.ts < endTs) bounds.add(c.ts)
  for (let m = startOfNextMonth(start); m < endTs; m = startOfNextMonth(m)) bounds.add(m)
  const points = [...bounds].sort((a, b) => a - b)

  let balance = 0
  let interest = 0
  let cur = start
  let i = 0
  const byMonth = new Map()
  for (const next of points) {
    while (i < list.length && list[i].ts <= cur) { balance += num(list[i].amount); i++ }
    const days = (next - cur) / DAY
    const grown = balance * (Math.pow(1 + r, days / YEAR_DAYS) - 1)
    if (Number.isFinite(grown) && grown !== 0) {
      const mk = monthKeyOf(cur)
      byMonth.set(mk, (byMonth.get(mk) || 0) + grown)
      balance += grown
      interest += grown
    }
    cur = next
  }
  while (i < list.length && list[i].ts <= endTs) { balance += num(list[i].amount); i++ }

  const months = [...byMonth.entries()].map(([month, amount]) => {
    // La transacción se fecha al CIERRE del mes (o en la fecha del saldo, para
    // el mes parcial en curso): el interés se devengó a lo largo del mes, no el
    // día 1. Y así `hasDividendInMonth` la ve en su mes y el motor automático no
    // escribe una segunda encima.
    const monthEnd = startOfNextMonth(toTs(`${month}-01`)) - DAY
    return { month, ts: Math.min(monthEnd, endTs), date: isoDay(Math.min(monthEnd, endTs)), amount }
  }).sort((a, b) => a.ts - b.ts)

  return { months, finalBalance: balance, interest }
}

// Redondea a centavos SIN perder ni inventar un centavo: la diferencia de
// redondeo se acumula en el último mes, así que la suma de lo escrito es
// exactamente el interés deducido.
function roundToCents(months, target) {
  const kept = months.filter((m) => Math.abs(m.amount) >= 0.005)
  if (kept.length === 0) return []
  const out = kept.map((m) => ({ ...m, amount: Math.round(m.amount * 100) / 100 }))
  const diff = Math.round((num(target) - out.reduce((s, m) => s + m.amount, 0)) * 100) / 100
  if (diff !== 0) out[out.length - 1].amount = Math.round((out[out.length - 1].amount + diff) * 100) / 100
  return out.filter((m) => m.amount > 0)
}

// --- Orquestador -------------------------------------------------------------

/**
 * Descompone el saldo tecleado en "lo que entró" y "lo que la cuenta generó".
 *
 * status:
 *  - 'ok'                : hay interés deducible y la tasa es plausible
 *  - 'no-contributions'  : no hay contra qué medir, no se infiere nada
 *  - 'negligible'        : el residuo es redondeo
 *  - 'negative-residual' : el saldo es MENOR que lo aportado. No se escribe
 *                          interés negativo: falta registrar un retiro
 *  - 'unsolvable'        : el IRR no converge (no debería pasar con datos sanos)
 *  - 'implausible-rate'  : hay residuo, pero la tasa que implica no se sostiene.
 *                          Devuelve igual el desglose, marcado, para que el
 *                          usuario decida: la app no lo aplica sola
 */
export function computeLiquidYield({ contributions, finalBalance, asOfTs, declaredRatePct } = {}) {
  const list = (contributions || []).filter((c) => c && Number.isFinite(c.ts))
  const contributed = list.reduce((s, c) => s + num(c.amount), 0)
  const balance = num(finalBalance)
  const base = {
    status: 'no-contributions', contributed, finalBalance: balance, interest: 0,
    ratePct: null, months: [], declared: null,
  }
  if (list.length === 0 || !(contributed > 0) || asOfTs == null) return base

  const interest = balance - contributed
  const negligible = Math.max(Math.abs(contributed) * (NEGLIGIBLE_PCT / 100), 0.01)
  if (interest < -negligible) return { ...base, status: 'negative-residual', interest }
  if (interest <= negligible) return { ...base, status: 'negligible', interest }

  const ratePct = impliedYieldRate(list, balance, asOfTs)
  if (ratePct == null) return { ...base, status: 'unsolvable', interest }

  const sched = accrualSchedule(list, ratePct, { endTs: asOfTs })
  const months = roundToCents(sched.months, interest)

  const declared = num(declaredRatePct) > 0
    ? (() => {
        const exp = accrualSchedule(list, num(declaredRatePct), { endTs: asOfTs })
        return {
          ratePct: num(declaredRatePct),
          expectedInterest: Math.round(exp.interest * 100) / 100,
          unexplained: Math.round((interest - exp.interest) * 100) / 100,
        }
      })()
    : null

  const implausible = ratePct > MAX_PLAUSIBLE_RATE_PCT
    || (declared && declared.ratePct > 0 && ratePct > declared.ratePct * DECLARED_RATE_FACTOR)

  return {
    status: implausible ? 'implausible-rate' : 'ok',
    contributed, finalBalance: balance,
    interest: Math.round(interest * 100) / 100,
    ratePct, months, declared,
  }
}

// Firma de lo que la inferencia MIDIÓ. Guardada en el ítem al aceptar o
// descartar, es lo que evita que la propuesta reaparezca sola: mientras el
// saldo, su fecha y los aportes conocidos sean los mismos, la respuesta ya está
// dada. Cambiar cualquiera de los tres (teclear un saldo nuevo, o agregar
// después un bono que paga a esta cuenta) produce una firma distinta y la
// pregunta se vuelve a hacer, que es exactamente lo que tiene que pasar.
export function yieldSignature({ asOfTs, finalBalance, contributions } = {}) {
  const list = (contributions || []).filter((c) => c && Number.isFinite(c.ts))
  const sum = list.reduce((s, c) => s + num(c.amount), 0)
  return [
    asOfTs == null ? '-' : isoDay(asOfTs),
    num(finalBalance).toFixed(2),
    list.length,
    sum.toFixed(2),
  ].join('|')
}

// Las transacciones que una corrida previa de esta inferencia escribió para
// este ítem, más el rendimiento que el motor automático le haya escrito DENTRO
// de la ventana que ahora manda el saldo. Todo eso queda superado: hasta
// `balanceAsOf` la verdad es el saldo, y cualquier rendimiento que hubiéramos
// booked antes es una afirmación vieja sobre el mismo dinero.
export function supersededYieldTxIds(transactions, item, asOfTs) {
  const itemId = typeof item === 'string' ? item : item?.id
  if (!itemId) return []
  const cfg = typeof item === 'string' ? {} : (item || {})
  // ¿El ingreso que el motor automático escribió para este ítem SE QUEDÓ en él?
  // Solo entonces está adentro del saldo y queda superado por él.
  //
  // El chequeo NO puede ser solo `tx._reinvested === true`: esa bandera se
  // estampa al escribir, así que un pago escrito cuando la cuenta estaba en
  // "recibo el efectivo" no la lleva, y sin embargo TODOS los motores lo tratan
  // hoy como reinvertido si la cuenta ahora reinvierte (`indexBalanceEvents`
  // mira `linked.dividendAction`). El caso es real: el fondo del usuario tenía
  // 19 pagos escritos así antes de cambiarlo a reinvertir. Sin esta regla se
  // sumarían al rendimiento deducido y contarían el mismo dinero dos veces.
  //
  // Un pago que se FUE a otra cuenta no se toca: borrarlo exigiría revertir el
  // crédito del destino, que es una operación distinta y de otro dueño.
  const staysHere = (tx) => tx._reinvested === true
    || cfg.dividendAction === 'reinvest'
    || !cfg.incomeDestination
  return (transactions || []).filter((tx) => {
    if (!tx || !tx.id || tx._linkedItemId !== itemId) return false
    if (String(tx.type || '').toUpperCase() !== 'DIVIDEND') return false
    if (tx._source === 'inferred_yield') return true
    if (tx._source !== 'auto') return false
    if (!staysHere(tx)) return false
    const ts = toTs(tx.date)
    return ts != null && asOfTs != null && ts <= asOfTs
  }).map((tx) => tx.id)
}
