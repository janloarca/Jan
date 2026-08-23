// Pagar la tarjeta desde el banco no es un gasto, y cobrarlo en la tarjeta no
// es un ingreso: son las DOS MITADES del mismo movimiento entre cuentas propias.
//
// De donde sale el problema. Un pago a la tarjeta entra hoy como INGRESO
// 'Salario' (decision del usuario, 21 ago 2026) y la razon que la sostiene esta
// escrita: "para quien solo importa tarjetas el sueldo vive en el banco y el mes
// se lee como pura perdida". O sea es un SUSTITUTO del credito de sueldo que no
// se puede ver. En cuanto se importa el estado del BANCO ese credito si se ve, y
// el sustituto pasa a duplicarlo:
//
//   solo tarjeta   ingreso Q8,175 (sustituto)   gasto Q8,175 (compras reales)
//   ambos          ingreso Q15,000 (sueldo real) + Q8,175 (sustituto)
//                  gasto Q8,175 (compras) + Q8,175 (el pago saliendo del banco)
//
// Las dos caras del mes quedan infladas por el monto del pago, y el desglose por
// categoria recibe un gasto de Q8,175 que no le corresponde a nada.
//
// Como se reconoce el par, y por que NO por palabras clave. No tengo a la vista
// ningun estado de cuenta BANCARIO real de este usuario (los tres que subio son
// de TARJETA), asi que no se como redacta el banco esa linea. Escribir una lista
// de palabras para un formato que nunca vi es justo lo que este repo ya decidio
// no hacer: un lector que se equivoca sobre dinero es peor que uno que no
// existe. La evidencia esta en otro lado y es mas fuerte que el texto: un debito
// del banco cuyo monto coincide AL CENTAVO con un pago de tarjeta ya registrado,
// a pocos dias, ES ese pago. Las palabras solo se usan para desempatar cuando
// dos debitos del mismo monto compiten por el mismo pago, nunca como requisito.
//
// Modulo puro + tests.

const CENTS = (n) => Math.round((Number(n) || 0) * 100)

const DAY_MS = 86400000

// Solo para DESEMPATAR. Nunca decide por si sola si una fila es un pago.
const LOOKS_LIKE_CARD_PAYMENT = /tarjeta|\btc\b|visa|mastercard|credomatic|amex|american express|\bpago\b/i

function dayTs(date) {
  const ms = Date.parse(`${String(date || '').slice(0, 10)}T00:00:00Z`)
  return isFinite(ms) ? ms : null
}

// Las filas ya registradas que pueden ser la otra mitad: el pago que el estado
// de la TARJETA registro como ingreso.
//
// Se excluye lo ya neteado (`_nettedTransfer`) para que re-importar el mismo
// estado del banco no vuelva a emparejar una fila que ya dejo de ser ingreso.
export function cardPaymentCandidates(recorded) {
  return (recorded || []).filter(
    (tx) => tx?.type === 'INCOME' && tx?.kind === 'payment' && !tx?._nettedTransfer
  )
}

// Empareja 1:1 los debitos del banco con los pagos ya registrados desde la
// tarjeta.
//
// 1:1 y codicioso, la misma disciplina que `reconcileStatement`: cada debito
// reclama a lo sumo un pago y viceversa. Eso es lo que hace que dos pagos
// identicos del mismo mes sigan siendo dos y no colapsen en uno.
//
// Devuelve { pairs, bankIndexes, recordedIds }:
//   pairs        [{ bankIndex, bankRow, match }]
//   bankIndexes  Set de indices del banco que NO deben importarse (salieron
//                hacia la tarjeta: no son gasto)
//   recordedIds  Set de ids ya registrados que dejan de ser ingreso
export function planCardPaymentNetting(bankRows, recorded, { windowDays = 5 } = {}) {
  const pairs = []
  const bankIndexes = new Set()
  const recordedIds = new Set()

  const candidates = cardPaymentCandidates(recorded)
  if (!candidates.length) return { pairs, bankIndexes, recordedIds }

  const claimed = new Set()
  const window = windowDays * DAY_MS

  // Los debitos que ADEMAS suenan a pago de tarjeta se prueban primero: con dos
  // del mismo monto compitiendo, el que lo dice gana. Se conserva el indice
  // original porque es lo que el caller usa para excluir la fila.
  const order = (bankRows || [])
    .map((row, bankIndex) => ({ row, bankIndex }))
    .filter(({ row }) => row?.type === 'EXPENSE')
    .sort((a, b) => {
      const sa = LOOKS_LIKE_CARD_PAYMENT.test(a.row?.description || '') ? 0 : 1
      const sb = LOOKS_LIKE_CARD_PAYMENT.test(b.row?.description || '') ? 0 : 1
      return sa - sb || a.bankIndex - b.bankIndex
    })

  for (const { row, bankIndex } of order) {
    const cents = CENTS(row.amount)
    if (!cents) continue
    const ts = dayTs(row.date)
    if (ts == null) continue
    const currency = row.currency || 'GTQ'

    for (const tx of candidates) {
      if (claimed.has(tx.id)) continue
      if (CENTS(tx.amount) !== cents) continue
      if ((tx.currency || 'GTQ') !== currency) continue
      const txTs = dayTs(tx.date)
      if (txTs == null || Math.abs(txTs - ts) > window) continue

      claimed.add(tx.id)
      bankIndexes.add(bankIndex)
      if (tx.id) recordedIds.add(tx.id)
      pairs.push({ bankIndex, bankRow: row, match: tx })
      break
    }
  }

  return { pairs, bankIndexes, recordedIds }
}

// Lo que se le escribe a la fila ya registrada para que deje de contar como
// ingreso.
//
// Se DEGRADA, no se borra: la fila describe un movimiento que de verdad ocurrio
// y borrar datos del usuario en medio de un import es peor que reetiquetarlos.
// Queda visible en su lista, rotulada como lo que es.
export function transferDemotion() {
  return { category: 'Transferencia Recibida', _nettedTransfer: true, _categorySetByUser: true }
}
