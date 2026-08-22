// Lo que el usuario corrige EN LA VISTA PREVIA del import, convertido en
// conocimiento.
//
// El hueco que esto cierra: el desplegable de categoría de la vista previa solo
// mutaba estado local. O sea corregir "FRIDAS LA ESTACION → Alimentación" antes
// de importar cambiaba esa fila y nada más: la próxima vez que el comercio
// apareciera volvía a "Otros Gastos", y la corrección en la lista de Flujo (que
// SÍ enseña) era el único camino que funcionaba. El usuario estaba corrigiendo
// en el único lugar donde la corrección se perdía.
//
// Dos cosas, y la segunda importa tanto como la primera:
//
//   1. La corrección se enseña (una regla por comercio).
//   2. Se aplica a las DEMÁS filas del mismo comercio EN ESTE MISMO import. Si
//      FRIDAS aparece tres veces en el estado, corregir una arregla las tres
//      antes de importar; sin esto habría que corregir cada una a mano y la
//      regla recién aprendida no alcanzaría a las que ya están en pantalla.
//
// Módulo puro: recibe filas, devuelve filas y el plan de lo que hay que enseñar.

import { merchantRuleKey } from './merchantLabels'

// Una fila cuya categoría la decidió el KIND no se enseña, porque su texto no
// describe un comercio: "GRACIAS POR SU PAGO" es un pago, "CREDITO P/CARGOS
// BONIFICABLES" es una promoción del banco y "FIN/CT 0013 000001 27" nombra un
// contrato. Aprender de ellas ensuciaría la tabla con reglas que nunca vuelven
// a aplicar, y peor: podrían pisar la clasificación correcta de otra fila.
const KIND_NOT_A_MERCHANT = new Set(['payment', 'payment-adjustment', 'cashback', 'fee', 'installment'])

export function isTeachableRow(row) {
  if (!row) return false
  if (KIND_NOT_A_MERCHANT.has(row.kind)) return false
  return !!merchantRuleKey(row.merchant || row.description || '')
}

// Aplica la corrección a la fila tocada Y a toda otra fila del mismo comercio
// que el usuario no haya corregido a mano.
//
// `touched` son las llaves de comercio que el usuario ya decidió en esta
// sesión: una fila que él puso en otra categoría no se pisa por corregir una
// hermana, porque en ese caso la decisión más reciente sobre ESA fila es la
// suya, no una consecuencia.
export function applyCategoryToMatchingRows(rows, index, category, touched = new Set()) {
  const list = Array.isArray(rows) ? rows : []
  const target = list[index]
  if (!target) return { rows: list, changed: 0 }
  const key = merchantRuleKey(target.merchant || target.description || '')

  let changed = 0
  const next = list.map((row, i) => {
    if (i === index) {
      changed++
      return { ...row, category, _categorySetByUser: true }
    }
    // Solo hermanas del MISMO comercio, y solo si su categoría no la decidió
    // el kind (una promoción del banco no cambia porque un restaurante sí).
    if (!key || !isTeachableRow(row)) return row
    if (row._categorySetByUser) return row
    if (merchantRuleKey(row.merchant || row.description || '') !== key) return row
    changed++
    return { ...row, category, _categorySetByUser: true }
  })
  return { rows: next, changed, key }
}

// Lo que hay que enseñar al terminar el import: una entrada por comercio, con
// la categoría que quedó. Se deriva de las filas y NO de un registro aparte de
// clics, para que lo que se enseña sea exactamente lo que se importó — si el
// usuario cambia de opinión tres veces, se aprende la última.
export function learnablesFrom(rows) {
  const byKey = new Map()
  for (const row of rows || []) {
    if (!row?._categorySetByUser || !row.category) continue
    if (!isTeachableRow(row)) continue
    const merchant = row.merchant || row.description || ''
    const key = merchantRuleKey(merchant)
    if (!key) continue
    // La última gana: recorrer en orden y sobreescribir es justamente lo que
    // hace que "cambié de opinión" termine en la categoría final.
    byKey.set(key, { merchant, category: row.category })
  }
  return [...byKey.values()]
}
