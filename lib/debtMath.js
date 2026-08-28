// El motor de deuda: qué cuesta deberla y cómo se reparte un pago.
//
// El caso que lo obligó (FASE LT): un préstamo familiar de USD 4,000 al 1.5%
// MENSUAL con interés sobre saldo. La app guardaba la tasa sin período (toda
// tasa se leía como anual, o sea 12x menos interés) y ninguna superficie decía
// cuánto se debe CON intereses ni cuánto de un pago es interés y cuánto baja
// el capital.
//
// Investigado antes de escribir (calculator.net/amortization, naranjax.com,
// webfinanciera.com): en LatAm conviven exactamente DOS esquemas de préstamo
// más el revolvente de tarjeta, y son los tres de acá:
//
//   'amortizing'    cuota fija (sistema francés): cada cuota trae interés sobre
//                   el saldo + capital; la cuota es constante y el interés baja
//                   mes a mes. El estándar de bancos (hipotecas, personales).
//   'interest_only' interés sobre saldo con capital libre: se paga el interés
//                   del mes y el capital cuando se puede (o al final). El
//                   estándar de préstamos familiares/informales, como el caso
//                   de referencia.
//   'revolving'     tarjeta: interés sobre el saldo, pago mínimo, sin plazo.
//
// ⛔ ESTE MÓDULO NUNCA ESCRIBE NI DECIDE: todo lo que devuelve es INFORMATIVO
// (decisión del usuario, 28 ago 2026: "solo mostrar el desglose"). Un pago de
// deuda baja el saldo por el monto que el usuario aplicó, exactamente como
// antes; este módulo solo dice cuánto de ese dinero fue interés y cuánto queda
// por pagar con intereses. Ninguna función de acá alimenta un retorno, un
// snapshot ni una reconstrucción.
//
// Módulo puro: sin React, sin Firestore. Los montos entran y salen en la
// moneda del propio ítem; convertir es problema del caller.

import { debtBalance } from '@/lib/propertyEquity'

// Techo de iteración del plan de pagos: 50 años de cuotas mensuales. Un plazo
// más largo que esto no es un préstamo, es un dato mal tecleado.
const MAX_MONTHS = 600
// Un mes promedio en ms, solo para estimar "meses hasta el vencimiento" cuando
// no hay cuotas configuradas. El resultado se presenta siempre como aproximado.
const MS_MONTH = 30.44 * 86400000

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// La tasa MENSUAL en fracción (1.5% mensual → 0.015). `ratePeriod` es el campo
// nuevo: 'monthly' | 'annual', con 'annual' como default porque es lo que toda
// deuda guardada antes de que el campo existiera asumía (el placeholder del
// formulario siempre fue "7.5", una tasa anual de banco). La convención
// anual→mensual es la nominal/12, que es la que usan los bancos de la región
// para armar la cuota francesa.
export function debtMonthlyRate(item) {
  const rate = num(item?.interestRate)
  if (!(rate > 0)) return 0
  return item?.ratePeriod === 'monthly' ? rate / 100 : rate / 100 / 12
}

// Qué esquema sigue esta deuda. Explícito cuando el usuario lo eligió
// (`debtScheme`); si no: una tarjeta es revolvente, y todo lo demás con cuota
// o número de cuotas configurado se asume cuota fija (los bancos son la
// mayoría). Un préstamo sin cuota ni plazo es interés sobre saldo: no hay
// ninguna cuota fija que calcular.
export function debtScheme(item) {
  const explicit = item?.debtScheme
  if (explicit === 'amortizing' || explicit === 'interest_only' || explicit === 'revolving') return explicit
  if (item?.subtype === 'credit_card') return 'revolving'
  if (num(item?.monthlyPayment) > 0 || num(item?.installmentsRemaining) > 0) return 'amortizing'
  return 'interest_only'
}

// El interés que este mes genera el saldo actual. Es la cifra que faltaba en
// todas las superficies: "le puse los 1.5% a los 4,000 pero me lo puso neto".
export function monthlyInterestOn(item, balance) {
  const b = balance != null ? num(balance) : debtBalance(item)
  return b > 0 ? b * debtMonthlyRate(item) : 0
}

// La cuota fija del sistema francés: capital × r / (1 − (1+r)^−n).
// Con tasa cero es el reparto plano.
export function frenchPayment(balance, monthlyRate, n) {
  const b = num(balance)
  const k = Math.round(num(n))
  if (!(b > 0) || !(k > 0)) return null
  const r = num(monthlyRate)
  if (!(r > 0)) return b / k
  return (b * r) / (1 - Math.pow(1 + r, -k))
}

// Cómo se reparte UN pago: primero el interés del mes sobre el saldo, el resto
// baja el capital. Un pago que no alcanza ni para el interés es todo interés y
// cero capital (y el que decide qué hacer con eso es el caller, no esto).
export function splitPayment({ balance, monthlyRate, payment }) {
  const b = num(balance)
  const p = num(payment)
  if (!(p > 0)) return { interest: 0, principal: 0 }
  const interest = Math.min(p, Math.max(0, b) * Math.max(0, num(monthlyRate)))
  return { interest, principal: p - interest }
}

// Meses aproximados desde `now` hasta una fecha 'YYYY-MM-DD'. Aproximado a
// propósito (mes promedio): alimenta cifras rotuladas "~", nunca un cálculo
// exacto. La fecha se parsea en UTC desde el texto, nunca con new Date() a
// secas (la trampa de zona ya documentada).
function monthsUntil(dateStr, nowTs) {
  if (!dateStr) return null
  const t = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  const months = Math.round((t - nowTs) / MS_MONTH)
  return months > 0 ? months : null
}

/**
 * El desglose completo de una deuda, para mostrar. Devuelve null sin saldo.
 *
 * {
 *   scheme, monthlyRate, balance,
 *   monthlyInterest,            // lo que el saldo genera ESTE mes
 *   payment,                    // la cuota: la configurada, o la francesa
 *                               // derivada de las cuotas restantes (aprox.)
 *   paymentDerived,             // true si la cuota se derivó (no la tecleó)
 *   split,                      // {interest, principal} de esa cuota, o null
 *   months,                     // cuotas/meses hasta liquidar, o null
 *   totalInterestRemaining,     // intereses que faltan por pagar, o null
 *   totalToPay,                 // capital + intereses restantes, o null
 *   paymentTooSmall,            // la cuota no cubre ni el interés del mes:
 *                               // con ese pago la deuda NUNCA baja
 * }
 *
 * `balance` se puede pasar explícito porque los ítems ENRIQUECIDOS traen el
 * precio convertido a moneda base: el caller que ya tiene el saldo en la
 * moneda que va a mostrar lo manda, y este módulo no adivina.
 */
export function debtBreakdown(item, { balance, now } = {}) {
  if (!item) return null
  const b = balance != null ? num(balance) : debtBalance(item)
  if (!(b > 0)) return null
  const r = debtMonthlyRate(item)
  const scheme = debtScheme(item)
  const nowTs = now != null ? Number(now) : Date.now()
  const monthlyInterest = b * r
  const installments = Math.round(num(item.installmentsRemaining))

  const base = { scheme, monthlyRate: r, balance: b, monthlyInterest, paymentTooSmall: false, paymentDerived: false }

  if (scheme === 'revolving') {
    const minPay = num(item.minimumPayment) || num(item.monthlyPayment)
    return {
      ...base,
      payment: minPay > 0 ? minPay : null,
      split: minPay > 0 ? splitPayment({ balance: b, monthlyRate: r, payment: minPay }) : null,
      months: null,
      totalInterestRemaining: null,
      totalToPay: null,
      // En una tarjeta, un mínimo que no cubre el interés significa que el
      // saldo CRECE aunque pagues: es lo más importante que se puede decir.
      paymentTooSmall: minPay > 0 && r > 0 && minPay <= monthlyInterest,
    }
  }

  if (scheme === 'interest_only') {
    // Se paga el interés del mes; el capital vence al final (o cuando se
    // pueda). Los meses salen de las cuotas configuradas o del vencimiento.
    const months = installments > 0 ? installments : monthsUntil(item.maturityDate, nowTs)
    const totalInterestRemaining = months != null && r > 0 ? months * monthlyInterest : (r > 0 ? null : 0)
    return {
      ...base,
      payment: r > 0 ? monthlyInterest : null,
      split: r > 0 ? { interest: monthlyInterest, principal: 0 } : null,
      months,
      totalInterestRemaining,
      totalToPay: totalInterestRemaining != null ? b + totalInterestRemaining : null,
      paymentTooSmall: false,
    }
  }

  // amortizing: cuota fija. La tecleada manda; sin ella se deriva la francesa
  // de las cuotas restantes.
  let payment = num(item.monthlyPayment)
  let paymentDerived = false
  if (!(payment > 0) && installments > 0) {
    payment = frenchPayment(b, r, installments)
    paymentDerived = payment != null
  }
  if (!(payment > 0)) {
    // Sin cuota ni cuotas restantes no hay plan que proyectar: solo el interés.
    return { ...base, payment: null, split: null, months: null, totalInterestRemaining: null, totalToPay: null }
  }
  if (r > 0 && payment <= monthlyInterest + 0.005) {
    // La cuota no cubre ni el interés: iterar no termina nunca, y decirlo es
    // más útil que cualquier tabla.
    return {
      ...base,
      payment,
      paymentDerived,
      split: splitPayment({ balance: b, monthlyRate: r, payment }),
      months: null,
      totalInterestRemaining: null,
      totalToPay: null,
      paymentTooSmall: true,
    }
  }
  let rem = b
  let totalInterest = 0
  let months = 0
  while (rem > 0.005 && months < MAX_MONTHS) {
    const interest = rem * r
    const principal = Math.min(rem, payment - interest)
    totalInterest += interest
    rem -= principal
    months += 1
  }
  return {
    ...base,
    payment,
    paymentDerived,
    split: splitPayment({ balance: b, monthlyRate: r, payment }),
    months,
    totalInterestRemaining: totalInterest,
    totalToPay: b + totalInterest,
    paymentTooSmall: false,
  }
}
