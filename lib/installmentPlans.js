// Cuotas: cuánto de tu futuro ya está comprometido.
//
// El caso real que lo motiva (FASE JW, con montos reales): julio cargó
// Q2,688.50 de "Financiamiento" que son diez cuotas de un plan de 36 posteadas
// de un solo golpe. Eso no es consumo nuevo, es deuda vieja liquidándose, y
// hasta ahora la app no podía decir la diferencia ni decir cuánto falta.
//
// El dato ya estaba capturado y nadie lo leía: cada fila de estado de cuenta
// con "(22/36)" en su texto lleva `installment: {num, of}` desde el parser
// (lib/parsers/guateCardStatements.js), y `enrichmentFor` lo propaga a filas
// capturadas antes. Este módulo solo lo agrega.
//
// ⛔ HABLA SOLO DE FLUJO (pagos futuros), NUNCA del saldo de la tarjeta: el
// saldo es un pasivo de Patrimonio y los dos segmentos están separados por
// decisión del usuario (FASE JZ). Mientras esto se quede en "cuánto pagas por
// mes y hasta cuándo", no toca esa frontera.
//
// Módulo puro + tests.

import { merchantRuleKey } from './merchantLabels'
import { FINANCE_CURRENCY } from './financeMonth'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

function toGtq(amount, currency, convert) {
  const amt = num(amount)
  const cur = currency || FINANCE_CURRENCY
  if (cur === FINANCE_CURRENCY || typeof convert !== 'function') return amt
  const out = convert(amt, cur, FINANCE_CURRENCY)
  return isFinite(out) ? out : amt
}

// 'YYYY-MM' + N meses, por aritmética de componentes (nunca new Date(str):
// la trampa de UTC-6 que la cabecera de financeMonth.js prohíbe).
export function addMonths(monthKey, n) {
  const [y, m] = String(monthKey).split('-').map(Number)
  if (!y || !m) return null
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

function isInstallmentExpense(tx) {
  if (!tx || tx.type !== 'EXPENSE') return false
  const inst = tx.installment
  if (!inst) return false
  const n = num(inst.num)
  const of = num(inst.of)
  // num > of es un dato corrupto, no un plan; amount <= 0 es un reverso.
  return n >= 1 && of >= n && num(tx.amount) > 0
}

// Los planes activos, uno por comercio + total de cuotas.
//
// La llave de agrupación es `merchantRuleKey(texto sin el "(n/m)")` + `of`:
// la misma normalización que junta "ISHOP GUATEMALA NL 01" con "ISHOP
// GUATEMALA" cuando dos bancos lo escriben distinto, y el total de cuotas
// separa dos planes DISTINTOS del mismo comercio (uno de 12 y uno de 36 no son
// el mismo contrato).
//
// Lo que se afirma por plan sale de la ÚLTIMA cuota vista (la de `num` más
// alto), nunca de un promedio: el monto de una cuota es contractual y el más
// reciente es el vigente. Diez cuotas posteadas de golpe (el caso real) dejan
// `paid` en la más alta del lote, que es exactamente lo ya liquidado.
//
// `freesUpMonth` es el mes de la última cuota vista + las que faltan: un
// ESTIMADO por construcción (si el banco postea tarde o el usuario abona
// anticipado, se corre), y por eso la UI lo rotula como estimación.
export function activeInstallmentPlans(transactions, { convert = null, nowMonth = null } = {}) {
  const byPlan = new Map()
  for (const tx of transactions || []) {
    if (!isInstallmentExpense(tx)) continue
    const text = String(tx.merchant || tx.description || '')
    const label = text.replace(/\s*\(\d{1,2}\/\d{1,2}\)\s*/g, ' ').trim() || text
    const mk = typeof tx.date === 'string' && tx.date.length >= 7 ? tx.date.slice(0, 7) : null
    if (!mk) continue
    const key = `${merchantRuleKey(label) || label.toLowerCase()}|${num(tx.installment.of)}`
    const row = {
      label,
      month: mk,
      n: num(tx.installment.num),
      of: num(tx.installment.of),
      amountGtq: toGtq(tx.amount, tx.currency, convert),
    }
    const prev = byPlan.get(key)
    if (!prev) {
      byPlan.set(key, { rows: [row], latest: row })
    } else {
      prev.rows.push(row)
      // La última cuota manda: num más alto, y a igual num la fecha más nueva.
      if (row.n > prev.latest.n || (row.n === prev.latest.n && row.month > prev.latest.month)) {
        prev.latest = row
      }
    }
  }

  const out = []
  for (const { rows, latest } of byPlan.values()) {
    const remaining = latest.of - latest.n
    // Un plan que ya llegó a su última cuota no compromete nada: no es activo.
    if (remaining <= 0) continue
    const plan = {
      label: latest.label,
      paid: latest.n,
      of: latest.of,
      monthly: latest.amountGtq,
      remaining,
      remainingAmount: remaining * latest.amountGtq,
      lastSeenMonth: latest.month,
      freesUpMonth: addMonths(latest.month, remaining),
      // Sin cuota vista en los últimos ~2 meses el plan puede estar liquidado
      // anticipado o el estado sin importar: se dice, no se esconde.
      stale: nowMonth ? addMonths(latest.month, 2) < nowMonth : false,
      monthsSeen: [...new Set(rows.map((r) => r.month))].sort(),
    }
    out.push(plan)
  }
  // Lo más pesado primero: el compromiso restante es la cifra que importa.
  return out.sort((a, b) => b.remainingAmount - a.remainingAmount)
}

// Cuánto del gasto de UN mes son cuotas de compras anteriores. Es la línea
// "de tus Q8,412 de gasto, Q2,688 son cuotas": consumo de otro momento
// liquidándose, no consumo del mes.
export function installmentsInMonth(transactions, monthKey, { convert = null } = {}) {
  let sum = 0
  let count = 0
  for (const tx of transactions || []) {
    if (!isInstallmentExpense(tx)) continue
    if (typeof tx.date !== 'string' || !tx.date.startsWith(monthKey)) continue
    sum += toGtq(tx.amount, tx.currency, convert)
    count += 1
  }
  return { sum, count }
}
