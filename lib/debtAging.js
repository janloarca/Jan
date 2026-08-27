// ¿Cuánto tardo en pagar lo que gasto con la tarjeta?
//
// La regla la fijó el usuario: cada depósito de pago ATACA EL GASTO MÁS VIEJO
// que siga sin pagar. O sea una cola FIFO — el mismo criterio con el que un
// banco amortiza un saldo revolvente — y la respuesta sale de restar la fecha
// del cargo a la fecha del pago que terminó de cubrirlo.
//
// De dónde salen los dos lados, y por qué existen los dos:
//
//   cargos  — las filas del estado de cuenta de TARJETA (compras, cuotas,
//             comisiones, intereses). Todo lo que suma al saldo.
//   pagos   — las filas `kind:'payment'`. FASE KQ decidió que un pago a la
//             tarjeta entra como INGRESO 'Salario' (es un sustituto del sueldo
//             que no se ve cuando solo se importan tarjetas), y FASE KV lo
//             DEGRADA a transferencia cuando aparece el estado del banco que lo
//             pagó. En los dos casos la fila **conserva su `kind:'payment'`**, y
//             eso no es casualidad: está puesto ahí justamente para que un
//             consumidor futuro pueda reconocerla. Este es ese consumidor.
//
// ⛔ La cola es POR TARJETA Y POR MONEDA. Estos estados traen GTQ y USD en un
// mismo documento, así que una cola sola pagaría un cargo de Q200 con un
// depósito de $200: la misma trampa que `statementMatcher` ya documenta, acá
// con consecuencias peores porque el error se acumula cargo tras cargo.
//
// Lo que NO se inventa, y es la mitad honesta del módulo:
//
//   · Un pago que no encuentra cargos que atacar NO se descarta en silencio: se
//     reporta como `unattributed`. Es el caso NORMAL del primer estado que uno
//     sube — ese pago cubre consumos de un mes que nunca se importó — y callarlo
//     haría que el promedio se calculara sobre una historia incompleta sin que
//     nada lo dijera.
//   · Un cargo cancelado por un REEMBOLSO no cuenta para el promedio: la deuda
//     desapareció, pero no porque lo hayas pagado.
//   · Sin ningún pago registrado no se devuelve "tardas 0 días", se devuelve
//     null. "No se puede medir" y "pagas al instante" son conclusiones opuestas.
//
// Módulo puro + tests.

const DAY_MS = 86400000

const cents = (n) => Math.round((Number(n) || 0) * 100)

// Las fechas son cadenas 'YYYY-MM-DD' y se comparan como tales: su orden
// lexicográfico ES el cronológico, y `new Date('YYYY-MM-DD')` las lee en UTC,
// que al oeste de UTC devuelve el día anterior (la trampa que `financeMonth.js`
// ya prohíbe).
const dayOf = (v) => String(v || '').slice(0, 10)
const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!isFinite(a) || !isFinite(b)) return null
  return Math.round((b - a) / DAY_MS)
}

// Un pago a la tarjeta, esté degradado a transferencia o no.
export function isCardPayment(tx) {
  return tx?.kind === 'payment'
}

// "CORRECCION A PAGO": revierte una entrada de dinero, así que reduce lo pagado
// en vez de sumarlo. Ya entra al ledger con monto NEGATIVO (FASE KQ), así que
// se trata como un pago negativo y la aritmética se cuida sola.
export function isPaymentAdjustment(tx) {
  return tx?.kind === 'payment-adjustment'
}

// Qué suma al saldo de la tarjeta. Todo lo que no es un pago ni una promoción
// del banco: compras, cuotas, comisiones, intereses. Un REEMBOLSO llega con
// monto negativo y también entra acá, porque resta del saldo igual que un pago
// aunque no lo sea (se distingue al liquidar, no al clasificar).
export function isCardCharge(tx) {
  if (!tx || isCardPayment(tx) || isPaymentAdjustment(tx)) return false
  if (tx.kind === 'cashback') return false
  return tx.source === 'card_import'
}

// La tarjeta a la que pertenece una fila. `cardKey` lo estampa el parser
// ('bi:9856'); una fila vieja, anterior a ese campo, solo trae la etiqueta de
// cuenta que puso el import ("Bi (Contecnica) •9856").
export function cardOfRow(tx) {
  if (tx?.cardKey) return String(tx.cardKey)
  const m = String(tx?.account || '').match(/[•*]\s*(\d{4})/)
  return m ? `card:${m[1]}` : null
}

const groupKey = (card, currency) => `${card}|${currency}`

// transactions: financeTransactions del usuario (crudas).
//
// Devuelve un arreglo de grupos, uno por tarjeta y moneda:
//   { card, currency, settled[], outstanding[], avgDays, medianDays,
//     outstandingTotal, oldest, paidCount, unattributed }
export function buildDebtAging(transactions, { now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10)
  const groups = new Map()

  const ensure = (card, currency) => {
    const k = groupKey(card, currency)
    if (!groups.has(k)) groups.set(k, { card, currency, charges: [], payments: [] })
    return groups.get(k)
  }

  for (const tx of transactions || []) {
    const card = cardOfRow(tx)
    if (!card) continue
    const date = dayOf(tx.date)
    if (!date) continue
    const currency = String(tx.currency || 'GTQ').toUpperCase()

    if (isCardPayment(tx) || isPaymentAdjustment(tx)) {
      // Un pago entra al ledger como INGRESO con monto positivo; una corrección
      // ya viene negativa. La magnitud con su signo es lo que hay que aplicar.
      ensure(card, currency).payments.push({ date, amount: Number(tx.amount) || 0, description: tx.description || '' })
    } else if (isCardCharge(tx)) {
      ensure(card, currency).charges.push({
        date, amount: Number(tx.amount) || 0, description: tx.description || tx.merchant || '', kind: tx.kind || null,
      })
    }
  }

  const out = []
  for (const g of groups.values()) out.push(settleGroup(g, today))
  // El grupo con más deuda viva primero: es lo que se viene a mirar.
  return out.sort((a, b) => b.outstandingTotal - a.outstandingTotal)
}

// La cola FIFO de UN grupo (una tarjeta, una moneda).
function settleGroup({ card, currency, charges, payments }, today) {
  // Positivos = deuda que entra a la cola. Negativos (reembolsos) = crédito que
  // la reduce sin que nadie haya pagado.
  const queue = []
  const credits = []
  for (const c of charges) {
    if (cents(c.amount) > 0) queue.push({ ...c, left: cents(c.amount) })
    else if (cents(c.amount) < 0) credits.push({ ...c, left: -cents(c.amount) })
  }
  queue.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  credits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Los eventos que reducen la deuda, en orden: pagos y reembolsos mezclados
  // por fecha. Un reembolso también ataca el cargo más viejo, porque lo que
  // hace es bajar el saldo igual que un pago; lo que cambia es que el cargo
  // liquidado así NO cuenta como "lo pagaste".
  const events = [
    ...payments.map((p) => ({ ...p, cents: cents(p.amount), by: 'payment' })),
    ...credits.map((c) => ({ ...c, cents: c.left, by: 'refund' })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const settled = []
  let head = 0
  // Hasta dónde de la cola ya EXISTÍA cuando ocurrió el evento que se está
  // aplicando. Sin esto, un pago del 5 de julio liquidaba un cargo del 20 —
  // dinero pagando algo que todavía no se debía — y el "tardé" salía negativo.
  // Un cargo del MISMO día sí es elegible: comprás y pagás ese día.
  let admitted = 0
  let unattributed = 0
  let paidCount = 0

  for (const ev of events) {
    while (admitted < queue.length && queue[admitted].date <= ev.date) admitted++
    let left = ev.cents
    if (left <= 0) {
      // Una corrección a pago: devuelve deuda a la cola. Se aplica al cargo más
      // reciente ya liquidado, que es el que ese pago acababa de cubrir.
      const back = -left
      unattributed = Math.max(0, unattributed - back)
      continue
    }
    if (ev.by === 'payment') paidCount++

    while (left > 0 && head < admitted) {
      const charge = queue[head]
      const applied = Math.min(left, charge.left)
      charge.left -= applied
      left -= applied
      if (!charge.firstTouch) charge.firstTouch = ev.date
      // El cargo se liquida con el evento que cubre el ÚLTIMO centavo: hasta
      // entonces seguías debiendo parte de él.
      if (charge.left === 0) {
        settled.push({
          date: charge.date,
          description: charge.description,
          amount: cents(charge.amount) / 100,
          settledOn: ev.date,
          by: ev.by,
          days: daysBetween(charge.date, ev.date),
        })
        head++
      }
    }
    // Lo que sobra no tiene a qué atacar. NO se descarta: es el caso normal del
    // primer estado que uno sube (ese pago cubre consumos de un mes que nunca se
    // importó), y callarlo dejaría el promedio midiendo una historia incompleta.
    if (left > 0) unattributed += left
  }

  const outstanding = queue.slice(head)
    .filter((c) => c.left > 0)
    .map((c) => ({
      date: c.date,
      description: c.description,
      amount: cents(c.amount) / 100,
      remaining: c.left / 100,
      ageDays: daysBetween(c.date, today),
    }))

  // Solo lo que de verdad se PAGÓ entra al promedio: un cargo cancelado por un
  // reembolso desapareció sin que nadie lo pagara, y contarlo como "tardaste 3
  // días" sería inventar una virtud.
  const paid = settled.filter((s) => s.by === 'payment' && s.days != null && s.days >= 0)
  return {
    card,
    currency,
    settled,
    outstanding,
    // Ponderado por MONTO, que es lo que contesta la pregunta: veinte cafés
    // pagados rápido no pueden tapar una compra grande que llevás arrastrando.
    avgDays: weightedAverage(paid),
    medianDays: median(paid.map((s) => s.days)),
    paidCount,
    settledCount: paid.length,
    outstandingTotal: outstanding.reduce((s, c) => s + c.remaining, 0),
    oldest: outstanding[0] || null,
    // Pagos (en centavos) que no encontraron ningún cargo al que atacar.
    unattributed: unattributed / 100,
  }
}

function weightedAverage(rows) {
  if (!rows.length) return null
  let num = 0
  let den = 0
  for (const r of rows) {
    const w = Math.abs(cents(r.amount))
    num += w * r.days
    den += w
  }
  return den > 0 ? num / den : null
}

function median(values) {
  const v = values.filter((n) => n != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}
