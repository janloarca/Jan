// La llave de un documento de transacción, en UN solo lugar.
//
// Es determinística a propósito: el mismo evento reintentado (una escritura que
// falla y se repite, un re-sync que vuelve a entregar el mismo reporte) tiene
// que resolver al MISMO documento, o cada reintento escribiría un movimiento
// nuevo. Esa propiedad es la que hace que un import se pueda correr dos veces
// sin duplicar nada.
//
// El costo de esa misma propiedad es el que se paga acá: dos eventos REALES que
// resuelvan a la misma llave colapsan en uno y el segundo se pierde EN SILENCIO.
// Tragarse un cobro es el error que este repo declara irrecuperable ("un
// duplicado que el usuario ve y borra se recupera; un cobro tragado no"), así
// que cada campo que entra a la llave está acá por un caso concreto:
//
//   · `_ibkrTxnId` — el id del evento en el broker. Cuando la query lo trae,
//     es la respuesta exacta y nada más hace falta.
//   · `_ibkrAccountId` — cuando NO lo trae. Un Flex cuya query no seleccionó
//     `transactionID` (FASE KE documenta que eso pasa: agregar una sección no
//     incluye sus columnas) deja todas sus filas sin id, y ahí dos depósitos
//     del mismo monto el mismo día en cuentas distintas resolvían al MISMO
//     documento. Es el defecto que FASE LD cerró del lado de los gastos, del
//     lado del portafolio.
//
// ⛔ Lo que NO entra, y su razón: la hora de LLEGADA. Cambia entre reintentos,
// así que meterla rompería justo la idempotencia por la que esta llave existe
// (la lección de FASE LD, que sí metió el instante REPORTADO por venir dentro
// del propio cuerpo del evento).

// El sufijo que califica una fila de broker sin id de transacción. Vive acá
// porque `detectAccountQualifiedIdDuplicates` (lib/badDataCleanup.js) lo
// necesita para reconocer la versión VIEJA de un documento durante la
// transición, y dos copias de esta regla es cómo una se queda atrás.
export function accountIdSuffix(accountId) {
  return accountId ? `-${accountId}` : ''
}

export function transactionDocId(tx = {}) {
  const amt = Math.round((tx.totalAmount || tx.amount || 0) * 100)
  const base = `${tx.date || 'nodate'}-${(tx.symbol || 'nosym').toUpperCase()}-${tx.type || 'tx'}-${amt}`
  if (tx._ibkrTxnId) return `${base}-${tx._ibkrTxnId}`
  return `${base}${accountIdSuffix(tx._ibkrAccountId)}`
}
