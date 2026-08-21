// ⛔ FASE KF. Nunca borrar y actualizar el MISMO documento en el mismo lote.
//
// El caso real: una posición que se vendió por completo queda guardada en
// cantidad 0, y más adelante se vuelve a comprar. En el sync siguiente el feed
// la trae otra vez, así que:
//
//   - el bucle de reconciliación la encuentra como `existing` (por conid, o por
//     símbolo + cuenta) y la encola en `updateOps` con su cantidad nueva;
//   - la regla de limpieza de sobrantes ve `cantidad <= 0` con el símbolo
//     presente en el feed y encola su id en `deleteIds`.
//
// `bulkImport` encola los borrados PRIMERO y los updates después, y un
// `batch.update` de Firestore sobre un documento que ya no existe FALLA el
// commit entero: el chunk revienta ("N of M operations failed") o, según cómo
// caiga el corte de lotes, la posición reabierta se pierde.
//
// Manda el UPDATE, no el borrado: el broker acaba de reportar esa posición,
// así que existe. La regla de limpieza sigue valiendo para su caso real, que
// es el sobrante que NO se está actualizando (un cero viejo cuya fila nueva
// entra como item distinto porque cambió de cuenta o no tiene conid).
//
// Se resuelve acá y no dentro de `bulkImport` a propósito: cuál de las dos
// intenciones gana depende de la semántica del caller, y hacer que la capa de
// datos elija en silencio escondería el error del próximo caller que las
// encole juntas, que es exactamente la degradación muda que este repo prohíbe.

export function dropDeletesThatAreUpdated(deleteIds, updateOps) {
  const updated = new Set((updateOps || []).map((op) => op && op.id).filter(Boolean))
  if (updated.size === 0) return deleteIds || []
  return (deleteIds || []).filter((id) => !updated.has(id))
}
