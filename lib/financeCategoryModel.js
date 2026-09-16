// La taxonomía del USUARIO, montada ENCIMA de la de fábrica.
//
// ⛔ LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO, Y NO ES NEGOCIABLE:
// el string en español de una categoría de fábrica ES LA LLAVE guardada en cada
// documento de Firestore. Lo escriben los tres parsers de estados de cuenta
// (lib/parsers/), `categorizeTransaction` y `categorizeExpense`, y lo compara
// todo el motor mensual. Renombrarlo rompería TODA transacción ya registrada, y
// los parsers seguirían escribiendo la llave vieja al día siguiente.
//
// Por eso el modelo es ADITIVO y nunca destructivo:
//
//   · RE-ROTULAR  sí: cambia lo que se MUESTRA, la llave no se toca.
//   · RE-AGRUPAR  sí: mueve la categoría a otro grupo del desglose.
//   · FIJO/VARIABLE sí: es una clasificación de lectura, no un dato de la fila.
//   · ESCONDER    sí, pero SOLO del selector. Una fila que ya usa esa categoría
//                 se sigue viendo con su rótulo: esconder nunca esconde DATOS.
//   · AGREGAR     sí: una categoría nueva cuya llave ES su nombre, igual forma
//                 que las de fábrica, así que se guarda y se lee sin ninguna
//                 rama especial en el resto de la app.
//   · RENOMBRAR la llave de una de fábrica: NO. BORRAR una de fábrica: NO.
//
// FORMA DE ALMACENAMIENTO: todo son ARREGLOS, jamás mapas. `saveSettings` hace
// `setDoc(..., {merge:true})` y Firestore fusiona un mapa anidado CAMPO POR
// CAMPO, así que quitar una llave de un mapa no se persistiría nunca (el
// override borrado "volvería" solo). Un arreglo se reemplaza entero. Es la
// misma lección que este repo ya pagó en FASE FT y en el plan del año.

import {
  FINANCE_CATEGORIES, EXPENSE_GROUPS, OTHER_GROUP,
  INCOME_GROUPS, INCOME_OTHER_GROUP, CATEGORY_LABELS_EN,
  groupOfCategory, incomeGroupOfCategory, isTransferCategory,
} from '@/lib/financeCategories'

// Un gasto FIJO es un compromiso ya adquirido: llega igual quieras o no. Uno
// VARIABLE es el que de verdad se puede mover este mes. Es la partición que un
// P&L de hogar usa para contestar "¿cuánto de mi gasto puedo controlar?", y sale
// por default de la categoría para que nadie tenga que configurar nada.
//
// Es un DEFAULT, no un veredicto: se cambia por categoría desde el editor.
const DEFAULT_FIXED = new Set([
  'Vivienda', 'Servicios', 'Suscripciones', 'Seguros', 'Impuestos',
  'Financiamiento', 'Educación',
])

export const CATEGORY_KEY_MAX = 32

// Una categoría nueva se guarda con su NOMBRE como llave, igual que las de
// fábrica, así que el nombre tiene que ser una llave usable: sin espacios de
// más y sin caracteres que un id de documento o un CSV no toleren.
export function normalizeCategoryKey(name) {
  return String(name || '')
    .replace(/[\s ]+/g, ' ')
    .replace(/[\/\\\n\r\t]/g, ' ')
    .trim()
    .slice(0, CATEGORY_KEY_MAX)
}

const ALL_BUILTIN = new Set([...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE])

export function isBuiltinCategory(key) {
  return ALL_BUILTIN.has(key)
}

// Por qué NO se puede usar este nombre. Devuelve null cuando sí se puede.
// Se contesta con una RAZÓN y no con un booleano porque el editor tiene que
// poder decir cuál de los tres casos es: vacío, ya existe, o colisiona con una
// categoría de fábrica (que no se puede duplicar aunque se escriba distinto).
export function categoryNameProblem(name, { model, type = 'EXPENSE', excludeKey = null } = {}) {
  const key = normalizeCategoryKey(name)
  if (!key) return 'empty'
  if (key === excludeKey) return null
  if (isBuiltinCategory(key)) return 'builtin'
  const existing = model ? [...model.expense, ...model.income] : []
  if (existing.some((c) => c.key.toLowerCase() === key.toLowerCase())) return 'duplicate'
  return null
}

function arr(v) { return Array.isArray(v) ? v : [] }

// La config cruda del usuario, saneada. Todo lo que no se entienda se descarta
// en silencio: una config a medias jamás puede impedir que la pantalla cargue.
export function sanitizeCategoryConfig(raw) {
  const seen = new Set()
  const custom = []
  for (const c of arr(raw?.custom)) {
    const key = normalizeCategoryKey(c?.key ?? c?.name)
    if (!key || isBuiltinCategory(key) || seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    custom.push({
      key,
      type: c?.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      group: typeof c?.group === 'string' ? c.group : null,
      fixed: c?.fixed === true,
    })
  }
  const ovSeen = new Set()
  const overrides = []
  for (const o of arr(raw?.overrides)) {
    const key = typeof o?.key === 'string' ? o.key : null
    if (!key || ovSeen.has(key)) continue
    ovSeen.add(key)
    const entry = { key }
    if (typeof o.label === 'string' && o.label.trim()) entry.label = o.label.trim().slice(0, CATEGORY_KEY_MAX)
    if (typeof o.group === 'string' && o.group) entry.group = o.group
    if (typeof o.fixed === 'boolean') entry.fixed = o.fixed
    if (o.hidden === true) entry.hidden = true
    // Un override que no dice NADA es ruido: no se conserva.
    if (Object.keys(entry).length > 1) overrides.push(entry)
  }
  return { custom, overrides }
}

// Los grupos disponibles por lado. Una categoría custom se asigna a uno de
// ESTOS: no se inventan grupos nuevos, porque cada grupo lleva un color ya
// medido (lib/colors.js) y la dona de la pantalla depende de que ese juego de
// colores siga siendo el mismo en las dos superficies.
export function groupsFor(type) {
  return type === 'INCOME' ? INCOME_GROUPS : [...EXPENSE_GROUPS, OTHER_GROUP]
}

function groupByKey(type, key) {
  return groupsFor(type).find((g) => g.key === key) || null
}

/**
 * El modelo resuelto: la lista completa de categorías de cada lado con su
 * rótulo, su grupo, su color y si es fija o variable, ya con los overrides del
 * usuario aplicados encima.
 */
export function resolveCategoryModel(rawConfig) {
  const config = sanitizeCategoryConfig(rawConfig)
  const ovByKey = new Map(config.overrides.map((o) => [o.key, o]))

  const build = (key, type, { custom = false, baseGroup = null, baseFixed = null } = {}) => {
    const ov = ovByKey.get(key) || {}
    const defaultGroup = baseGroup
      || (type === 'INCOME' ? incomeGroupOfCategory(key) : groupOfCategory(key))
    const group = (ov.group && groupByKey(type, ov.group)) || defaultGroup
    return {
      key,
      type,
      custom,
      // El rótulo del usuario gana sobre los dos idiomas: es SU palabra.
      label: ov.label || key,
      labelEn: ov.label || CATEGORY_LABELS_EN[key] || key,
      renamed: !!ov.label,
      groupKey: group.key,
      groupLabel: group.label,
      groupLabelEn: group.labelEn || group.label,
      color: group.color || 'var(--text-muted)',
      // Un ingreso no se parte en fijo/variable: eso es una lectura del GASTO.
      fixed: type === 'INCOME' ? false
        : (typeof ov.fixed === 'boolean' ? ov.fixed
          : (baseFixed != null ? baseFixed : DEFAULT_FIXED.has(key))),
      hidden: ov.hidden === true,
      // Una transferencia entre cuentas propias no cuenta en ningún total, así
      // que tampoco entra al estado de resultados.
      transfer: isTransferCategory(key),
    }
  }

  const expense = [
    ...FINANCE_CATEGORIES.EXPENSE.map((k) => build(k, 'EXPENSE')),
    ...config.custom.filter((c) => c.type === 'EXPENSE')
      .map((c) => build(c.key, 'EXPENSE', {
        custom: true,
        baseGroup: groupByKey('EXPENSE', c.group) || OTHER_GROUP,
        baseFixed: c.fixed,
      })),
  ]
  const income = [
    ...FINANCE_CATEGORIES.INCOME.map((k) => build(k, 'INCOME')),
    ...config.custom.filter((c) => c.type === 'INCOME')
      .map((c) => build(c.key, 'INCOME', {
        custom: true,
        baseGroup: groupByKey('INCOME', c.group) || INCOME_OTHER_GROUP,
      })),
  ]

  const byKey = new Map([...expense, ...income].map((c) => [c.key, c]))

  return {
    config,
    expense,
    income,
    byKey,
    /** Lo que el selector OFRECE: sin lo escondido. Nunca filtra datos. */
    pickable(type) {
      return (type === 'INCOME' ? income : expense).filter((c) => !c.hidden)
    },
    /**
     * El rótulo de una categoría, incluida una que ya no está en el modelo
     * (borrada de una versión vieja, o escrita por un parser que aún no
     * conocemos): se imprime tal cual en vez de dejar un hueco.
     */
    labelOf(key, lang = 'es') {
      const c = byKey.get(key)
      if (!c) return key || ''
      return lang === 'es' ? c.label : c.labelEn
    },
    entry(key) { return byKey.get(key) || null },
    isFixed(key) {
      const c = byKey.get(key)
      return c ? c.fixed : DEFAULT_FIXED.has(key)
    },
  }
}

// Los tres escritores de config. Devuelven la config NUEVA completa (arreglos),
// lista para `saveSettings({ financeCategoryConfig })`: nunca un parche parcial,
// justamente porque Firestore fusionaría un parche de mapa campo por campo.
export function withCustomCategory(rawConfig, { name, type = 'EXPENSE', group = null, fixed = false }) {
  const config = sanitizeCategoryConfig(rawConfig)
  const key = normalizeCategoryKey(name)
  if (!key || isBuiltinCategory(key)) return config
  if (config.custom.some((c) => c.key.toLowerCase() === key.toLowerCase())) return config
  return {
    ...config,
    custom: [...config.custom, { key, type: type === 'INCOME' ? 'INCOME' : 'EXPENSE', group, fixed: fixed === true }],
  }
}

export function withCategoryOverride(rawConfig, key, patch) {
  const config = sanitizeCategoryConfig(rawConfig)
  if (!key) return config
  const rest = config.overrides.filter((o) => o.key !== key)
  const prev = config.overrides.find((o) => o.key === key) || { key }
  const next = { ...prev, ...patch, key }
  // ⛔ Un `undefined` tiene que DESAPARECER, no quedarse como llave vacía.
  // `{...prev, fixed: undefined}` conserva la llave `fixed` con valor
  // undefined, y eso (a) hace que el override se vea "con contenido" y
  // sobreviva cuando debía borrarse, y (b) revienta la escritura: `saveSettings`
  // limpia los undefined del nivel de arriba, no los de adentro de un arreglo,
  // y Firestore rechaza un undefined anidado con "Unsupported field value".
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  // Un rótulo vacío o igual a la llave NO es un override: es volver al default.
  if (!next.label || next.label === key) delete next.label
  if (next.hidden !== true) delete next.hidden
  const meaningful = Object.keys(next).filter((k) => k !== 'key').length > 0
  return { ...config, overrides: meaningful ? [...rest, next] : rest }
}

/**
 * Quitar una categoría CUSTOM. Solo se puede cuando NINGUNA fila la usa: si la
 * usa aunque sea una, borrarla dejaría esas filas con una categoría que ya no
 * existe en ningún lado, que es exactamente lo que este modelo existe para
 * impedir. En ese caso el camino honesto es esconderla.
 */
export function canDeleteCustomCategory(key, transactions) {
  if (!key || isBuiltinCategory(key)) return false
  return !(transactions || []).some((tx) => tx?.category === key)
}

export function withoutCustomCategory(rawConfig, key) {
  const config = sanitizeCategoryConfig(rawConfig)
  return {
    custom: config.custom.filter((c) => c.key !== key),
    overrides: config.overrides.filter((o) => o.key !== key),
  }
}
