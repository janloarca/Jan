// Metas financieras: cuánto falta, cuánto habría que aportar, y qué tan
// probable es llegar.
//
// ⛔ LA REGLA QUE ORDENA TODO ESTE MÓDULO: la probabilidad se alimenta del
// aporte MEDIDO, jamás del "necesario".
//
// El defecto que lo obligó (reportado por el usuario con captura, 28 ago 2026):
// la card le pasaba al Monte Carlo el aporte del escenario base, o sea
// EXACTAMENTE la cantidad que hace aterrizar la meta si el retorno es 7%, y
// después corría la simulación a 7% y preguntaba qué tan probable era la meta.
// La pregunta es circular y la respuesta está fijada de antemano: la mediana
// cae sobre la meta por construcción, así que sale ~50% pase lo que pase.
//
// Medido ejecutando el motor real, con la meta del usuario y con metas
// absurdas:
//
//   28,873 -> 40,000 en 2 años  (aporte 264.84/mes)     50%
//   28,873 -> 500,000 en 2 años (aporte 18,176.89/mes)  45%   <- imposible
//   100    -> 40,000 en 2 años  (aporte 1,553.09/mes)   49%
//
// O sea una meta flatly imposible reportaba 45% y la meta real 50%: el número
// tenía cara de dato y no decía nada del usuario. La pregunta útil es la otra,
// y es la que este módulo contesta: dado lo que de VERDAD estás aportando,
// ¿llegas? Si no se puede medir, se dice; inventar un aporte sería volver al
// mismo número circular con otro disfraz.

import { computeYtdInvested } from '@/lib/ytdInvested'

// Meses de historial mínimos para afirmar un ritmo de aporte. Con uno o dos
// meses, anualizar es un volado: un mes en que se abrió una cuenta se lee como
// si ese fuera el aporte de todos los meses.
export const MIN_MONTHS_FOR_RATE = 3

// Cuántos meses faltan para la meta.
//
// El año objetivo se lee como "para el CIERRE de ese año", que es la lectura
// natural de "mi meta es 2028": tienes todo 2028. Antes esto era
// `targetYear - añoActual`, o sea un entero que no se movía en doce meses y
// después caía de golpe: en agosto de 2026 y en diciembre de 2026 decía lo
// mismo ("2 años", el mismo aporte necesario) aunque hubieran pasado cuatro
// meses sin aportar, y el 1 de enero saltaba a la mitad del horizonte con el
// aporte necesario disparado. Contar meses hace que el número se endurezca
// solo, mes a mes, que es lo que una meta con fecha tiene que hacer.
export function monthsUntilGoal(targetYear, nowTs = Date.now()) {
  const y = Number(targetYear)
  if (!Number.isFinite(y)) return 0
  const now = new Date(nowTs)
  // Fin del año objetivo, en UTC como el resto de las fronteras de año del repo
  // (lib/ytdInvested.js, calendarYearGain): con hora local, la frontera la
  // decidiría la zona de quien mire.
  const endTs = Date.UTC(y + 1, 0, 1)
  // Meses calendario COMPLETOS que quedan: el mes en curso ya va corrido, así
  // que no se cuenta entero (redondeo conservador, del lado de exigir un poco
  // más de aporte en vez de prometer un mes que no está).
  const months = (y + 1 - now.getUTCFullYear()) * 12 - (now.getUTCMonth() + 1)
  if (endTs <= nowTs) return 0
  return Math.max(0, months)
}

// El aporte mensual que cierra la brecha, a una tasa anual dada.
//
// Es la anualidad de siempre (verificada contra los números en pantalla: 5% ->
// 321.48, 7% -> 264.84, 10% -> 180.11 para 28,873 -> 40,000 en 24 meses); lo
// único que cambia es que el horizonte entra en MESES en vez de años enteros.
export function monthlyNeeded(currentValue, goalValue, annualRatePct, months) {
  const n = Math.round(Number(months) || 0)
  if (n <= 0) return 0
  const cur = Number(currentValue) || 0
  const goal = Number(goalValue) || 0
  if (goal <= cur) return 0
  const r = (Number(annualRatePct) || 0) / 100 / 12
  if (r === 0) return (goal - cur) / n
  const fvCurrent = cur * Math.pow(1 + r, n)
  const gap = goal - fvCurrent
  if (gap <= 0) return 0
  return (gap * r) / (Math.pow(1 + r, n) - 1)
}

// Cuánto está aportando el usuario DE VERDAD, por mes.
//
// Sale de `computeYtdInvested`, el MISMO motor que produce la card "Invertido
// por año", con sus mismas exclusiones (transferencias entre cuentas propias no
// son aporte, un dividendo no es aporte, el desembolso de un préstamo no es
// aporte, la comisión de entrada se descuenta una vez). Una segunda definición
// de "invertido" es exactamente cómo dos pantallas terminan diciendo cosas
// distintas del mismo dinero.
//
// Rehúsa antes que inventar, y la distinción importa:
//  - Sin NINGÚN movimiento de flujo en toda la historia no se puede medir un
//    ritmo. Es el caso normal de quien tecleó sus saldos y nunca capturó su
//    historia, y ahí "aporta $0/mes" sería una afirmación sobre su conducta que
//    nadie hizo. Se devuelve `measurable: false` con su razón.
//  - CON historia de flujos pero nada en la ventana, el ritmo es cero DE
//    VERDAD (dejó de aportar), y esa es información útil aunque incomode.
//  - Con menos de MIN_MONTHS_FOR_RATE meses de historia tampoco se afirma nada.
//
// La ventana se acorta a la historia disponible: quien lleva cuatro meses en la
// app y metió 1,200 aporta 300/mes, no 100 (que es lo que daría dividir entre
// doce meses de los que ocho no existen).
export function measuredMonthlyContribution({
  transactions, items, convert, baseCurrency,
  nowTs = Date.now(), windowMonths = 12,
} = {}) {
  const flows = (transactions || []).filter((tx) => {
    const type = (tx?.type || '').toUpperCase()
    return (type === 'DEPOSIT' || type === 'WITHDRAWAL') && tx?.date
  })
  const stamps = flows
    .map((tx) => new Date(tx.date).getTime())
    .filter((ts) => Number.isFinite(ts) && ts <= nowTs)

  if (stamps.length === 0) {
    return { monthly: 0, invested: 0, monthsCovered: 0, measurable: false, reason: 'no-flow-history' }
  }

  const now = new Date(nowTs)
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - windowMonths, now.getUTCDate())
  const firstFlow = Math.min(...stamps)
  const startTs = Math.max(windowStart, firstFlow)
  const monthsCovered = Math.max(0, (nowTs - startTs) / (30.4375 * 86400000))

  if (monthsCovered < MIN_MONTHS_FOR_RATE) {
    return { monthly: 0, invested: 0, monthsCovered, measurable: false, reason: 'too-short' }
  }

  const { invested } = computeYtdInvested({ transactions, items, convert, baseCurrency, startTs, endTs: nowTs })
  return { monthly: invested / monthsCovered, invested, monthsCovered, measurable: true, reason: null }
}
