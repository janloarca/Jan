// Qué significa corregir un número en la Hoja.
//
// El usuario lo planteó así: "cuando uno cambia el spreadsheet el cambio no es
// por pérdida, solo mal número, y no se tiene que tomar en cuenta en pérdida o
// ganancia". Tenía razón, y el problema era peor de lo que parece: la Hoja YA
// decidía por él, distinto según el tipo de activo, y sin decírselo nunca.
//
//   - Cuenta bancaria (isBankLike): escribía valor Y costo, así que TODA
//     corrección se leía como "dato equivocado". Si de verdad ganó intereses,
//     el rendimiento desaparecía.
//   - Bono, alternativo, inmueble: escribía SOLO el valor, así que TODA
//     corrección se leía como ganancia o pérdida. Un número mal tecleado se
//     leía como pérdida, que es exactamente lo que él vio.
//   - Acción o cripto: deriva la CANTIDAD del valor, o sea ni una cosa ni la
//     otra.
//
// La app no puede saber cuál de las dos es: solo lo sabe quien teclea. Así que
// se pregunta.
//
// ⛔ EXTIENDE LÓGICA CONGELADA (lib/assetLogic/corporateBondWithEntryFee.js y
// lib/assetLogic/liquidFundYield.js), con OK explícito del usuario (25 ago
// 2026). No cambia NINGUNA fórmula: cambia qué campos escribe una edición, que
// son entradas que esas fórmulas ya leían.
//
// ── LAS TRES RESPUESTAS, y por qué son exactamente tres ─────────────────────
//
// Un saldo que cambió solo puede deberse a una de tres cosas, y las tres tienen
// consecuencias DISTINTAS sobre el retorno:
//
//   FLUJO       entró o salió dinero. NO es ganancia ni pérdida: es capital
//               tuyo moviéndose, y tiene que netearse del retorno o depositar
//               se leería como haber ganado.
//   RENDIMIENTO el activo produjo (o perdió) valor. SÍ es ganancia o pérdida.
//   CORRECCIÓN  el número anterior estaba mal. Ni una cosa ni la otra: la
//               ganancia no se mueve.
//
// Es la misma partición que `EditAccountModal` ya ofrece al guardar, salvo que
// ese fusiona "Ganancia/pérdida o corrección" en un solo botón, o sea justo las
// dos que hay que separar.
//
// Sin la rama de FLUJO, un retiro de una cuenta líquida se registraba como
// pérdida y un depósito como intereses: las dos deforman el retorno en la
// dirección más visible que hay.

import { isBankLike } from '@/components/dashboard/utils'
import { isBankLikeItem, buildContributionFields, balanceQuantityPatch } from '@/lib/contributions'

// Por debajo de esto no hay nada que preguntar: es redondeo.
export const EDIT_EPSILON = 0.005

export const ANSWER_CORRECTION = 'correction'
export const ANSWER_RETURN = 'return'
export const ANSWER_FLOW = 'flow'

// Un movimiento escrito desde la Hoja. El prefijo "manual" es OBLIGATORIO: es
// lo que hace que `addTransaction` le agregue su nonce de unicidad, sin el cual
// dos retiros iguales el mismo día colapsarían en el mismo documento.
//
// Y es un origen PROPIO, distinto de `manual_edit_adjustment`, que es lo que
// escribe EditAccountModal ante la misma diferencia de saldo. Ese está EXCLUIDO
// de "invertido" (ytdInvested, investedByYear) porque ahí la app no preguntó y
// asume que una corrección de saldo suele ser rendimiento acumulado. Acá el
// usuario dijo explícitamente que metió o sacó dinero, así que SÍ tiene que
// contar como capital: reusar aquel origen lo haría desaparecer del invertido.
export const FLOW_SOURCE = 'manual_balance_flow'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Un ítem cuyo saldo lo escribe un SYNC no debe editarse desde una celda como
// si fuera un dato del usuario: el próximo sync lo pisa, y peor, la respuesta
// "metí dinero" archivaría un movimiento que el ledger real del broker ya trae.
const SYNCED_SOURCE = /^(ibkr|blockchain|ledger)$/i

// Un activo de MERCADO nunca entra a esta pregunta, y no es un olvido: su
// precio lo pone el mercado, así que "el valor está mal" solo puede significar
// "tengo otra cantidad", que es justo lo que la Hoja ya hace con él. Preguntarle
// a alguien si la bolsa se equivocó sería ruido. Tampoco un ítem sincronizado
// (su verdad vive en el broker) ni uno de demo (cero side-effects persistentes
// es el contrato del modo demo).
export function editNeedsAnswer({ item, oldValue, newValue, isMarket }) {
  if (isMarket) return false
  if (!item || !item.id) return false
  const src = String(item._source || '')
  if (SYNCED_SOURCE.test(src) || src === 'demo') return false
  const delta = num(newValue) - num(oldValue)
  // ⛔ Una DEUDA no es un activo y sus preguntas no son las de un activo (FASE
  // LR, reporte del usuario con captura: pagó su préstamo, editó la celda, y la
  // Hoja le ofreció "Saqué dinero / Perdió valor", que sobre una deuda son
  // sinsentidos que además ESCRIBEN mal: "Saqué dinero" archivaba un WITHDRAWAL
  // vinculado a la deuda, que el Dietz cuenta como flujo y el invertido del año
  // resta como si desinvertir la deuda fuera posible).
  //
  //   BAJÓ  → o hiciste un pago (se registra: el historial del préstamo lo
  //           rebobina y se puede borrar con reversa) o el número estaba mal.
  //           Se pregunta.
  //   SUBIÓ → intereses acumulados, más préstamo o corrección: ninguna de las
  //           tres mueve una ganancia ni registra hoy nada distinto, así que
  //           preguntar sería una elección falsa. Se escribe directo (los dos
  //           campos, como toda cuenta de saldo).
  if (item.isDebt) return delta < -EDIT_EPSILON
  return Math.abs(delta) > EDIT_EPSILON
}

// Una cuenta líquida no tiene "ganancia no realizada": el interés se acreditó,
// el dinero ESTÁ ahí. Un bono o un inmueble sí se revalúan sin que entre un
// centavo. Esa diferencia es la que decide cómo se registra el rendimiento.
// A propósito NO se usa `isBankLikeItem` acá, que es mucho más ancha: devuelve
// true para CUALQUIER estático con cantidad 1, o sea incluye a los bonos. Un
// bono que sube de precio no acreditó efectivo, se revaluó, y registrarle un
// ingreso sería inventar dinero que no llegó.
export function accruesInBalance(item) {
  return isBankLike(item)
}

// La rama de FLUJO sí usa la regla ancha, y la diferencia es deliberada: un
// aporte o un retiro sobre un estático de cantidad 1 es exactamente el caso que
// `buildContributionFields` resuelve DESPLAZANDO los dos campos, sin lotes. Un
// activo por CANTIDAD (varias unidades) necesita crear o cerrar lotes, que es
// trabajo del flujo de Movimiento y no de una celda: ahí no se ofrece, y la UI
// dice dónde sí se hace.
//
// ⛔ FASE NF. Una CUENTA DE SALDO ofrece la rama de flujo con la cantidad que
// tenga. Antes se exigía cantidad efectiva 1 en todos los casos (FASE JJ3), y
// eso escondía el botón justo en las cuentas cuya cantidad quedó escrita de
// otra forma — la forma "cantidad = saldo con precio 1" que documenta FASE JD3
// es una de las que este repo ya vio en datos reales. El usuario veía su fondo
// líquido bajar, y las únicas dos respuestas ofrecidas eran "perdió valor"
// (que le desinfla el retorno por dinero que él sacó) y "el número estaba mal".
//
// El guard de JJ3 era correcto para el defecto que lo motivó y quedó ANCHO de
// más: medido hoy, `buildContributionFields` solo se equivoca con cantidad ≠ 1
// cuando el `type` dice literalmente "banco"/"bank" (ahí toma su rama de saldo
// y desplaza los campos de PRECIO por el delta completo: qty 2, 1000 → 1300
// deja el valor en 1600). Con cualquier otro tipo de cuenta cae a la rama por
// cantidad y aterriza exacto. Así que la restricción no es del BOTÓN sino del
// motor, y se resuelve ahí: `planCellEdit` usa ese motor solo a cantidad 1 y
// escribe el parche por cantidad en los demás casos (ver abajo).
//
// Lo que NO se ensancha: un activo por CANTIDAD de verdad (una acción, una
// cripto, un bono con 3 unidades) sigue sin ofrecerlo, porque ahí sacar dinero
// es cerrar lotes y eso es trabajo del flujo de Movimiento, no de una celda.
// `isBankLike` mira el TIPO, y es la MISMA regla con la que la Hoja clasifica
// una fila bajo "Caja & Bancos": toda cuenta que el usuario ve ahí puede decir
// que metió o sacó dinero.
export function canRecordFlow(item) {
  if (!item) return false
  if (isBankLike(item)) return true
  // La MISMA convención de cantidad efectiva que usa `planCellEdit`
  // (`num(quantity) || 1`): sin cantidad, o en cero, el ítem se trata como 1.
  return isBankLikeItem(item) && (Number(item.quantity) || 1) === 1
}

/**
 * Qué escribir para una edición de celda ya resuelta a la moneda del ítem.
 *
 * Devuelve `{ patch, income, flow }`. `income` y `flow` son movimientos REALES
 * a registrar (o null). El caller escribe todo; este módulo no toca Firestore.
 *
 * ⛔ EL INVARIANTE, y es literalmente lo que el usuario pidió:
 *    con `correction`, la ganancia/pérdida de la cuenta NO se mueve.
 *
 * Por eso el costo se DESPLAZA por la diferencia en vez de sobreescribirse con
 * el valor nuevo. Sobreescribir solo conserva la ganancia cuando costo y valor
 * ya coincidían (una cuenta de banco); en un bono comprado a 6,000 que hoy vale
 * 6,200, corregir el 6,200 a 6,100 con sobreescritura borraría los 200 de
 * apreciación real que sí existían. Desplazando, la apreciación sobrevive
 * intacta y solo se corrige el número que estaba mal.
 *
 * `flow` desplaza IGUAL (por la misma razón: sacar dinero de un activo que se
 * apreció no borra la apreciación), así que las dos ramas escriben el mismo
 * parche y lo único que las distingue es que una deja constancia del
 * movimiento. Eso es exactamente la diferencia real entre las dos.
 */
export function planCellEdit({ item, oldValue, newValue, answer, currency, date }) {
  if (!item) return null
  const qty = num(item.quantity) || 1
  const oldV = num(oldValue)
  const newV = num(newValue)
  const delta = newV - oldV
  const cur = currency || item._originalCurrency || item.currency || 'USD'
  const price = newV / qty
  const day = date || new Date().toISOString().slice(0, 10)
  // ⛔ La cantidad que hace legible el saldo escrito. Solo para un item de
  // SALDO: ahi los campos de precio son el saldo y `getItemValue` los multiplica
  // por la cantidad, asi que con una cantidad inservible (cero, ausente) el
  // numero tecleado se escribia y la app lo leia como 0.00. En un activo por
  // CANTIDAD no aplica: ahi el precio es por unidad y la cantidad es un dato
  // real del usuario (cantidad 0 es una posicion vendida, no un defecto).
  // Una sola definicion, compartida con buildContributionFields.
  const qtyPatch = isBankLikeItem(item) ? balanceQuantityPatch(item, newV) : {}

  // ── DEUDA: sus dos respuestas, ninguna de activo ─────────────────────────
  //
  // El parche es el MISMO en ambas (los dos campos al saldo nuevo: una deuda no
  // tiene "ganancia" que preservar desplazando el costo, y dejar purchasePrice
  // en el saldo viejo solo deja un campo mintiendo). Lo que cambia es si queda
  // CONSTANCIA: "hice un pago" archiva el movimiento con la forma EXACTA que ya
  // escribe CashFlowModal (`_debtItemId`, FASE KW/KZ3), así que el historial
  // del préstamo se rebobina bien (`indexBalanceEvents` sube la magnitud hacia
  // atrás), la fila se ve y se borra con reversa (transferReversal SUBE la
  // deuda), y el pasado deja de estar plano. Sin cuenta origen a propósito:
  // desde una celda no se sabe de dónde salió el dinero, y la UI dice dónde se
  // registra un pago que SÍ salió de una cuenta registrada.
  if (item.isDebt) {
    const patch = { currentPrice: price, purchasePrice: price }
    if (answer === ANSWER_FLOW && delta < 0) {
      return { patch, income: null, flow: null, debtPayment: { amount: Math.abs(delta), currency: cur, date: day } }
    }
    return { patch, income: null, flow: null, debtPayment: null }
  }

  if (answer === ANSWER_FLOW) {
    if (canRecordFlow(item)) {
      const flow = { type: delta > 0 ? 'DEPOSIT' : 'WITHDRAWAL', amount: Math.abs(delta), currency: cur, source: FLOW_SOURCE, date: day }
      // ⛔ FASE NF. A cantidad efectiva 1 manda el MISMO motor que usan
      // Movimiento y el editor de cuenta, no una segunda copia: si escribieran
      // distinto, el mismo aporte dejaría la cuenta en un estado según por qué
      // puerta se registró. Ese es el caso común y queda byte-idéntico.
      //
      // Con CUALQUIER otra cantidad se escribe el parche de CORRECCIÓN, que es
      // el único que aterriza en el valor tecleado pase lo que pase (divide
      // entre la cantidad en vez de desplazar el precio por el delta completo).
      // No es una tercera regla: es literalmente la promesa de FASE JJ2 — las
      // dos ramas escriben el mismo parche y lo único que las distingue es que
      // una deja constancia del movimiento. Medido, el motor compartido solo
      // se desvía con cantidad ≠ 1 cuando el tipo dice "banco" (deja 1600 sobre
      // un valor tecleado de 1300), y ese caso ahora no lo alcanza.
      if (qty === 1) {
        const { itemFields } = buildContributionFields({
          item, amount: Math.abs(delta), date: day, isAdd: delta > 0, currency: cur,
        })
        return { patch: itemFields, income: null, flow }
      }
      const { patch } = planCellEdit({ item, oldValue, newValue, answer: ANSWER_CORRECTION, currency, date })
      return { patch, income: null, flow }
    }
    // Sin forma de registrar el movimiento (activo por cantidad, o banco con
    // cantidad ≠ 1: la UI ni ofrece el botón, esto es defensa en profundidad),
    // "metí/saqué dinero" JAMÁS puede degradar a la rama de rendimiento: sobre
    // una cuenta líquida eso inventaría un ingreso `manual_yield` con dinero
    // que el usuario acaba de decir que es capital. Se aplica el parche de
    // corrección (la ganancia no se mueve) y no se archiva ningún movimiento.
    return planCellEdit({ item, oldValue, newValue, answer: ANSWER_CORRECTION, currency, date })
  }

  if (answer === ANSWER_CORRECTION) {
    const oldCost = num(item.purchasePrice)
    // El costo se mueve lo MISMO que el valor, así la diferencia se cancela.
    // Nunca por debajo de cero: un costo negativo no significa nada y haría que
    // toda la ganancia futura saliera inflada.
    // Es el mismo principio que `lib/contributions.js` ya aplica al aportar o
    // retirar sobre un estático: cada campo conserva su propio nivel, "so an
    // asset whose market value drifted from cost doesn't lose the gain".
    const nextCost = Math.max(0, oldCost + delta / qty)
    return { patch: { currentPrice: price, purchasePrice: nextCost, ...qtyPatch }, income: null, flow: null }
  }

  // "El activo cambió de valor".
  if (accruesInBalance(item) && delta > 0) {
    // El costo SIGUE al saldo y el rendimiento se registra como movimiento.
    // Dejar el costo quieto acá sería contarlo dos veces: `acceptLiquidYield`
    // escribe el ingreso sin tocar el costo, así que la cuenta terminaría con
    // la diferencia contada como ganancia no realizada Y como ingreso.
    return {
      patch: { currentPrice: price, purchasePrice: price, ...qtyPatch },
      income: {
        type: 'DIVIDEND',
        amount: delta,
        currency: cur,
        // MISMA forma que escribe `acceptLiquidYield`, para que todo consumidor
        // ya existente lo trate igual. Lo único distinto es el origen: este lo
        // declaró el usuario, no lo dedujo el motor.
        source: 'manual_yield',
        reinvested: true,
        date: day,
      },
      flow: null,
    }
  }

  // Todo lo demás se revalúa: el costo se queda donde está y la diferencia ES
  // la ganancia o la pérdida. Una cuenta líquida que BAJA cae acá a propósito:
  // no existe un "ingreso negativo", así que la baja se muestra como la pérdida
  // que es, y quien sacó el dinero tiene la rama de FLUJO para decirlo.
  return { patch: { currentPrice: price, ...qtyPatch }, income: null, flow: null }
}
