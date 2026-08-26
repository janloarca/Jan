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

// El nucleo del emparejamiento, compartido por las dos direcciones.
//
// 1:1 y codicioso, la misma disciplina que `reconcileStatement`: cada fila
// nueva reclama a lo sumo una registrada y viceversa. Eso es lo que hace que
// dos pagos identicos del mismo mes sigan siendo dos y no colapsen en uno.
//
// Las filas que ADEMAS suenan a pago de tarjeta se prueban primero: con dos del
// mismo monto compitiendo, la que lo dice gana. Se conserva el indice original
// porque es lo que el caller usa para apartar la fila.
function pairRows(rows, candidates, windowDays) {
  const pairs = []
  const rowIndexes = new Set()
  const claimed = new Set()
  if (!candidates.length) return { pairs, rowIndexes }
  const window = windowDays * DAY_MS

  const order = rows
    .sort((a, b) => {
      const sa = LOOKS_LIKE_CARD_PAYMENT.test(a.row?.description || '') ? 0 : 1
      const sb = LOOKS_LIKE_CARD_PAYMENT.test(b.row?.description || '') ? 0 : 1
      return sa - sb || a.index - b.index
    })

  for (const { row, index } of order) {
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
      rowIndexes.add(index)
      pairs.push({ index, row, match: tx })
      break
    }
  }
  return { pairs, rowIndexes }
}

// Lo que se le escribe a la fila YA REGISTRADA para que deje de contar.
//
// Se DEGRADA, no se borra: la fila describe un movimiento que de verdad ocurrio
// y borrar datos del usuario en medio de un import es peor que reetiquetarlos.
// Queda visible en su lista, rotulada como lo que es.
//
// La categoria tiene que corresponder al TIPO de la fila: 'Transferencia
// Recibida' vive en la lista de ingresos y 'Transferencia Enviada' en la de
// gastos, asi que cruzarlas dejaria una fila con una categoria que su propia
// pantalla no ofrece.
export function transferDemotion(type = 'INCOME') {
  return {
    category: type === 'EXPENSE' ? 'Transferencia Enviada' : 'Transferencia Recibida',
    _nettedTransfer: true,
    _categorySetByUser: true,
  }
}

// Las escrituras que de verdad hacen falta.
//
// El emparejamiento SIEMPRE incluye a las filas ya degradadas (es lo que hace
// que un re-import siga apartando su contraparte), pero volver a escribirles la
// misma degradacion seria un write por nada en cada re-import.
function demotionsFor(pairs, type) {
  return pairs
    .filter((p) => p.match?.id && !p.match._nettedTransfer)
    .map((p) => ({ id: p.match.id, updates: transferDemotion(type) }))
}

// ── Direccion 1: llega el estado del BANCO ──────────────────────────────────
//
// Las filas ya registradas que pueden ser la otra mitad: el pago que el estado
// de la TARJETA registro como ingreso.
//
// ⛔ Una fila YA DEGRADADA sigue siendo candidata, y excluirla fue un defecto
// real: el neteo APARTA la fila del otro estado en vez de escribirla, asi que
// al re-importar el mismo estado no hay nada nuevo que la absorba. Con la
// degradada fuera de los candidatos, el segundo import no empareja, la fila
// apartada entra como NUEVA y el doble conteo vuelve. La fila degradada tiene
// que seguir absorbiendo su mitad en CADA re-import; lo que no se repite es la
// escritura (ver `demotions`).
export function cardPaymentCandidates(recorded) {
  return (recorded || []).filter((tx) => tx?.type === 'INCOME' && tx?.kind === 'payment')
}

// Devuelve { pairs, rowIndexes, demotions, direction }:
//   rowIndexes  indices del estado del banco que NO deben importarse (salieron
//               hacia la tarjeta: no son gasto)
//   demotions   [{ id, updates }] para las filas ya registradas que dejan de
//               contar como ingreso
export function planCardPaymentNetting(bankRows, recorded, { windowDays = 5 } = {}) {
  const rows = (bankRows || [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?.type === 'EXPENSE')
  const { pairs, rowIndexes } = pairRows(rows, cardPaymentCandidates(recorded), windowDays)
  return {
    direction: 'bank',
    pairs,
    rowIndexes,
    demotions: demotionsFor(pairs, 'INCOME'),
  }
}

// ── Direccion 2: llega el estado de la TARJETA ──────────────────────────────
//
// El caso espejo, y hace falta porque el orden de importacion no lo decide
// nadie: con el estado del banco importado primero, su debito ya quedo como
// gasto, y sin esto la fila de pago del estado de la tarjeta entraria como
// ingreso sin que nada las empareje. Mismo doble conteo, en el otro orden.
//
// Aca los candidatos se acotan a lo que vino de un estado de cuenta BANCARIO
// (`bi_import`), y eso importa: en la otra direccion el candidato ya venia
// rotulado como pago por el propio estado de la tarjeta (`kind: 'payment'`),
// mientras que aca "cualquier gasto registrado" seria un conjunto demasiado
// ancho para emparejar solo por monto. Un gasto TECLEADO a mano tampoco entra,
// a proposito: preferimos no netear antes que netear una compra real que por
// casualidad costo lo mismo.
//
// Una fila ya degradada sigue siendo candidata, por la misma razon que en la
// direccion 1: es la que aparta a su contraparte en cada re-import.
export function bankPaymentCandidates(recorded) {
  return (recorded || []).filter((tx) => tx?.type === 'EXPENSE' && tx?.source === 'bi_import')
}

// Devuelve la misma forma que la direccion 1:
//   rowIndexes  indices del estado de la tarjeta que NO deben importarse (el
//               pago ya esta registrado del lado del banco)
//   demotions   el debito del banco deja de contar como gasto
export function planStatementPaymentNetting(cardRows, recorded, { windowDays = 5 } = {}) {
  const rows = (cardRows || [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?.kind === 'payment')
  const { pairs, rowIndexes } = pairRows(rows, bankPaymentCandidates(recorded), windowDays)
  return {
    direction: 'card',
    pairs,
    rowIndexes,
    demotions: demotionsFor(pairs, 'EXPENSE'),
  }
}
