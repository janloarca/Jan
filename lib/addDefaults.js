// FASE QK. Con qué tipo abre el alta cuando una pantalla ya lo sabe.
//
// `app/spreadsheet/page.jsx` pasaba `defaults={addModalDefaults}` a
// `AddAccountModal` y ese prop NO existía en su lista de parámetros: era un
// no-op SILENCIOSO, así que "+ Agregar deuda" (pestaña Deudas) y las cuatro
// altas rápidas de Patrimonio aterrizaban TODAS en el tipo por defecto
// (Acciones), ignorando el botón que el usuario acababa de tocar. No falla
// ruidosamente: el formulario abre perfecto, solo en la pantalla equivocada.
//
// Lo que los dos callers mandan hoy, leído de sus call sites:
//   { isDebt: true }                                  (DebtSpreadsheet)
//   { type: 'RealEstate',  subtype: 'property' }       (Patrimonio)
//   { type: 'Alternative', subtype: 'vehicle' }
//   { type: 'Alternative', subtype: 'collectible' }
//   { type: 'Other' }
//
// ⛔ El SUBTIPO se pasa verbatim y NO se valida contra el catálogo del selector,
// y eso no es descuido: 'vehicle' no es una de las opciones de Alternative, y es
// justamente lo que hace que el bien aparezca en la pestaña desde la que se
// creó (`isPatrimonioItem` matchea /vehicle/ sobre el subtipo). Validarlo contra
// el selector lo borraría y el ítem nacería invisible ahí mismo. Medido
// ejecutando esas funciones: property, vehicle y collectible quedan visibles.
//
// ⛔ El TIPO tampoco se valida, por la misma razón: 'Other' no es una opción del
// selector (ahí no se resalta ninguna pastilla) pero sí es un tipo que el resto
// de la app entiende (`getTypeCategory('Other')` → 'other'). Mapearlo a
// Alternative lo movería de categoría sin que nadie lo pidiera.
//
// Es una ALLOWLIST a propósito: un caller que mande cualquier otra llave no
// puede inyectarla al formulario por accidente.

// Qué tipo y subtipo siembra el formulario. SIEMPRE devuelve un objeto con las
// dos llaves (cadenas vacías cuando no hay nada que sembrar), así el caller no
// tiene que desestructurar un posible null.
export function addDefaults(defaults) {
  const out = { type: '', subtype: '' }
  if (!defaults || typeof defaults !== 'object') return out
  // `isDebt` es una BANDERA, no un tipo: la pestaña Deudas dice "agregá una
  // deuda" sin decir de qué clase, así que el subtipo se queda vacío y lo elige
  // el usuario. Un `type` explícito gana, porque dice más.
  if (defaults.isDebt === true) out.type = 'Debt'
  if (typeof defaults.type === 'string' && defaults.type.trim()) out.type = defaults.type.trim()
  if (typeof defaults.subtype === 'string' && defaults.subtype.trim()) out.subtype = defaults.subtype.trim()
  return out
}
