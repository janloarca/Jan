// ¿Qué secciones de Flujo tienen algo que mostrar?
//
// POR QUÉ EXISTE. Las cards de Flujo se auto-ocultan cuando no tienen contenido
// (`if (plans.length === 0) return null`), y eso es correcto por sí solo: una
// card vacía prometiendo una función es ruido. Pero al agruparlas bajo un
// encabezado de sección aparece un caso nuevo: si TODAS las cards de una
// sección devuelven null, el encabezado queda colgado sobre nada.
//
// ⛔ LA RESPUESTA NO ES DUPLICAR EL UMBRAL DE CADA CARD. Cada una deriva su
// vacío de un SELECTOR PURO compartido, así que acá se pregunta lo mismo con la
// MISMA función. Una sola fuente de verdad: si mañana cambia qué cuenta como
// plan activo, cambia en `lib/installmentPlans.js` y las dos superficies se
// enteran a la vez.
//
// Lo único que se repite es el umbral (`.length === 0`), y eso lo cubre
// `financeSections.test.js`, que lee los ARCHIVOS de las cards y exige que
// sigan preguntándole al mismo selector.

import { activeInstallmentPlans } from '@/lib/installmentPlans'
import { detectRecurringCharges } from '@/lib/recurringCharges'
import { buildDebtAging } from '@/lib/debtAging'
import { yearTotalsByMonth } from '@/lib/financeMonth'

// Las dos derivaciones de "hoy" que las cards hacen por su cuenta. Viven acá
// para que la pregunta y la respuesta no puedan quedar en instantes distintos.
export function nowMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
export function nowDateKey(now = new Date()) {
  return now.toLocaleDateString('en-CA')
}

// "¿A qué estoy amarrado hacia adelante?": cuotas, cargos recurrentes y deuda.
// La sección existe si CUALQUIERA de las tres tiene algo, porque cada card se
// oculta sola y basta una para que el encabezado tenga contenido debajo.
export function commitmentsHaveContent(transactions, { convert = null, now = new Date() } = {}) {
  const txs = transactions || []
  if (activeInstallmentPlans(txs, { convert, nowMonth: nowMonthKey(now) }).length > 0) return true
  if ((detectRecurringCharges(txs, { convert, nowDate: nowDateKey(now) }).monthly || []).length > 0) return true
  if (buildDebtAging(txs, { now: now.getTime() }).length > 0) return true
  return false
}

// La sección "Movimientos" NO tiene función acá a propósito: el libro mayor
// (`FinanceTransactionList`) nunca se auto-oculta, con el mes vacío dibuja su
// propio "Sin transacciones", así que esa sección siempre tiene contenido y
// preguntarlo sería un helper que nadie consume.

// "¿Cómo va el año?" `YearInViewCard` se oculta con un año sin un solo
// movimiento; `IncomePlanCalendar` no se oculta nunca (es un plan que se teclea,
// no un derivado), así que la sección siempre tiene al menos esa card.
export function yearInViewHasContent(transactions, year, convert = null) {
  return yearTotalsByMonth(transactions || [], year, convert).some((m) => m.income > 0 || m.expenses > 0)
}
