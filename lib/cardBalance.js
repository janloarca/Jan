// El saldo al corte de un estado de cuenta de tarjeta: cuanto se debe.
//
// Los tres parsers (BI/Contecnica, G&T, BAC) emiten `closingBalance: {GTQ, USD}`
// desde que existen y NADIE lo leia. Este modulo es su primer consumidor, y
// existe aparte del componente por tres razones que son todas de honestidad:
//
//   1. "No se pudo leer el saldo" es un ESTADO, no un cero. Un cero afirma que
//      no debes nada; la ausencia dice que el numero no se pudo extraer. Desde
//      afuera se ven igual y significan lo contrario, asi que se separan aca y
//      no en el render.
//
//   2. Las dos monedas van SEPARADAS y jamas sumadas. Estos estados traen GTQ y
//      USD en el mismo documento y el saldo viene partido por moneda; sumarlas
//      necesita una tasa, y `convert` sin tasa devuelve el monto CRUDO en
//      silencio, o sea el total saldria en la moneda equivocada sin avisar. El
//      precedente es la cola de `lib/debtAging.js`, que es por tarjeta Y por
//      moneda por la misma razon.
//
//   3. El numero lo IMPRIME el banco, no lo calculamos nosotros, y la
//      reconciliacion del estado NO lo cubre: `buildReconciliation` compara los
//      totales de los grupos de detalle contra la re-suma de filas, y el saldo
//      se lee de un regex aparte. Presentarlo como verificado seria falso, asi
//      que el consumidor tiene que poder decir de donde sale.
//
// ⛔ NO se contrasta contra `buildDebtAging(...).outstandingTotal`, y la razon
// vale escribirla porque la idea es tentadora: esa cola FIFO se arma con las
// transacciones YA importadas, asi que con historia parcial (el caso normal:
// alguien que subio tres meses de estados) su saldo vivo no es el saldo de la
// tarjeta y discreparia casi siempre. Un aviso que grita lobo en cada import es
// peor que ninguno, porque el usuario deja de leerlo justo cuando importa.
//
// Modulo puro: entra el objeto del parser, sale una descripcion. Sin React, sin
// Firestore, sin formato de moneda (eso es del render, que conoce el idioma).

const SYMBOL = { GTQ: 'Q', USD: '$' }

// Un saldo en cero es un HECHO ("no debes nada en dolares") y se conserva; lo
// que se descarta es lo que no es un numero. Sin esta distincion, una tarjeta
// pagada por completo se veria igual que una que no se pudo leer.
function readable(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Describe el saldo al corte de un estado ya parseado.
 *
 * @param {object|null} card lo que devuelve `parseCardStatement`
 * @returns {{
 *   ok: boolean,            // se pudo leer al menos una moneda
 *   lines: Array<{currency: string, amount: number, text: string}>,
 *   owes: boolean,          // hay algo distinto de cero que deber
 *   cutDate: string|null,
 *   cardLabel: string|null, // "Bi (Contecnica) ·9856"
 * }}
 */
export function cardBalanceSummary(card) {
  const empty = { ok: false, lines: [], owes: false, cutDate: null, cardLabel: null }
  if (!card) return empty

  const cutDate = typeof card.cutDate === 'string' && card.cutDate ? card.cutDate : null
  const cardLabel = card.bankLabel
    ? `${card.bankLabel}${card.cardLast4 ? ` ·${card.cardLast4}` : ''}`
    : null

  const cb = card.closingBalance
  if (!cb || typeof cb !== 'object') return { ...empty, cutDate, cardLabel }

  // Orden fijo y no el del objeto: la moneda local primero, que es la que el
  // usuario lee. Un orden que dependa de las llaves cambia entre bancos.
  const lines = []
  for (const cur of ['GTQ', 'USD']) {
    const v = cb[cur]
    if (!readable(v)) continue
    const amount = Math.abs(v)
    lines.push({
      currency: cur,
      amount,
      text: `${SYMBOL[cur] || ''}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    })
  }

  return {
    ok: lines.length > 0,
    lines,
    owes: lines.some((l) => l.amount > 0),
    cutDate,
    cardLabel,
  }
}
