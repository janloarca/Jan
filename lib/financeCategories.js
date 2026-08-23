export const FINANCE_CATEGORIES = {
  INCOME: [
    'Salario',
    'Freelance',
    'Side Hustle',
    'Inversiones',
    'Renta',
    'Promoción de tarjeta',
    'Transferencia Recibida',
    'Otros Ingresos',
  ],
  EXPENSE: [
    'Alimentación',
    'Transporte',
    'Vivienda',
    'Servicios',
    'Entretenimiento',
    'Salud',
    'Educación',
    'Compras',
    'Suscripciones',
    'Seguros',
    'Impuestos',
    'Comisiones',
    'Financiamiento',
    'Transferencia Enviada',
    'Otros Gastos',
  ],
}

// Mover dinero entre cuentas PROPIAS no es ingreso ni gasto: el patrimonio no
// cambia, solo cambia de bolsillo. Estas dos categorías ya existían y hasta
// ahora eran letra muerta por partida doble: sus arreglos de palabras clave
// están vacíos (así que ningún clasificador podía llegar a ellas) y aun así
// contaban en los totales, o sea ni se podían usar ni habrían servido.
//
// Ahora tienen un usuario real: el pago a la tarjeta neteado contra el estado
// del banco (lib/cardPaymentNetting.js). Y quedan FUERA de los totales, que es
// lo único que las vuelve útiles — una fila etiquetada "transferencia" que
// igual suma al ingreso no arregla nada.
export const TRANSFER_CATEGORIES = new Set(['Transferencia Recibida', 'Transferencia Enviada'])

export function isTransferCategory(category) {
  return TRANSFER_CATEGORIES.has(category)
}

// The SIX main expense groups the UI reports on (breakdown, insights, MoM/YoY
// comparisons). A grouping layer over the granular categories — existing data
// needs no migration, statements keep categorizing granularly.
export const EXPENSE_GROUPS = [
  { key: 'vivienda', label: 'Vivienda y Servicios', labelEn: 'Housing & Utilities', icon: '🏠', color: '#3b82f6', categories: ['Vivienda', 'Servicios', 'Suscripciones'] },
  { key: 'alimentacion', label: 'Alimentación', labelEn: 'Food', icon: '🍽', color: '#f59e0b', categories: ['Alimentación'] },
  { key: 'transporte', label: 'Transporte', labelEn: 'Transport', icon: '🚗', color: '#ef4444', categories: ['Transporte'] },
  { key: 'salud-edu', label: 'Salud y Educación', labelEn: 'Health & Education', icon: '🏥', color: '#14b8a6', categories: ['Salud', 'Educación'] },
  { key: 'personal', label: 'Personal y Entretenimiento', labelEn: 'Personal & Fun', icon: '🛍', color: '#ec4899', categories: ['Entretenimiento', 'Compras'] },
  // Obligations rather than choices: premiums, taxes, bank charges, the
  // instalments of something already bought, money moved out. They used to
  // fall into "Otros", which made the largest line of a real month (Q39,782 of
  // insurance) read as "we could not tell what this was".
  { key: 'financiero', label: 'Financiero', labelEn: 'Financial', icon: '💳', color: '#94a3b8', categories: ['Seguros', 'Impuestos', 'Comisiones', 'Financiamiento', 'Transferencia Enviada'] },
]

export const OTHER_GROUP = { key: 'otros', label: 'Otros', labelEn: 'Other', icon: '·', color: '#64748b', categories: ['Otros Gastos'] }

const GROUP_BY_CATEGORY = (() => {
  const map = {}
  for (const g of [...EXPENSE_GROUPS, OTHER_GROUP]) {
    for (const cat of g.categories) map[cat] = g
  }
  return map
})()

export function groupOfCategory(category) {
  return GROUP_BY_CATEGORY[category] || OTHER_GROUP
}

// Income sections for the structured monthly view.
//
// ⛔ 'Inversiones' YA NO se alimenta del portafolio. Era auto-only: su monto
// llegaba de las transacciones DIVIDEND del portafolio, y por eso escribirlo a
// mano se bloqueaba (habría contado dos veces). Flujo y Patrimonio son dos
// segmentos separados, así que ese auto-jalado se eliminó y con él la razón del
// bloqueo. La categoría se queda porque describe dinero REAL de Flujo: un
// dividendo que cayó en tu cuenta bancaria y entró por el estado de cuenta es
// movimiento de efectivo, y quitarla dejaría esas filas sin dónde ir. Lo que
// mide el rendimiento de esa inversión sigue siendo Patrimonio, no esta fila.
// Los colores salen de CHART_PALETTE (lib/colors.js), que es la paleta ya
// medida para series ADYACENTES, que es exactamente lo que estas barras son.
// El gris de "Otros" es el mismo neutro que usa OTHER_GROUP del lado del gasto,
// para que "no supimos qué es esto" se lea igual en las dos mitades.
export const INCOME_GROUPS = [
  { key: 'fijos', label: 'Ingresos fijos', labelEn: 'Fixed income', icon: '💼', color: '#08A8AF', categories: ['Salario', 'Renta'] },
  { key: 'side', label: 'Side hustle', labelEn: 'Side hustle', icon: '🚀', color: '#E07227', categories: ['Freelance', 'Side Hustle'] },
  { key: 'inversion', label: 'Inversión', labelEn: 'Investments', icon: '🔒', color: '#B274DC', categories: ['Inversiones'] },
  // Cashback, reintegros y bonificaciones de la tarjeta. Fila PROPIA por
  // decisión del usuario: es dinero que devuelve el banco, no un sueldo, y
  // mezclarlo en "Otros" lo hacía invisible.
  //
  // El color sale de CHART_PALETTE y se ELIGIÓ MIDIENDO con lib/colorMath.js
  // contra los otros cuatro grupos, no a ojo: ΔE 13.29 en visión normal y 8.94
  // bajo daltonismo, el mejor de los candidatos con sentido semántico.
  // Descartados: #BD2D76 (3.27 bajo daltonismo, el par magenta-morado que
  // lib/colors.js ya documenta como irresoluble) y #B6BFCC (mejor número, pero
  // sería un segundo gris al lado de "Otros").
  { key: 'promo', label: 'Promoción de tarjeta', labelEn: 'Card rewards', icon: '🎁', color: '#00764F', categories: ['Promoción de tarjeta'] },
  { key: 'otros-in', label: 'Otros', labelEn: 'Other', icon: '·', color: '#64748b', categories: ['Transferencia Recibida', 'Otros Ingresos'] },
]

export const INCOME_OTHER_GROUP = INCOME_GROUPS[INCOME_GROUPS.length - 1]

const INCOME_GROUP_BY_CATEGORY = (() => {
  const map = {}
  for (const g of INCOME_GROUPS) {
    for (const cat of g.categories) map[cat] = g
  }
  return map
})()

// Espejo de `groupOfCategory` para el lado del ingreso, para que las dos
// mitades de la pantalla de Flujo se agrupen con la misma mecánica en vez de
// que una de las dos lo arme a mano.
export function incomeGroupOfCategory(category) {
  return INCOME_GROUP_BY_CATEGORY[category] || INCOME_OTHER_GROUP
}

// Categorías que el alta manual no debe ofrecer.
//
// Vacío desde que 'Inversiones' dejó de alimentarse sola del portafolio: el
// bloqueo existía para que teclearla no contara dos veces contra ese número
// automático, y sin el auto-jalado esa razón desapareció. Se conserva el gancho
// porque el modal ya lo consume y volver a necesitarlo es plausible.
export const MANUAL_INCOME_BLOCKED = []

const CATEGORY_KEYWORDS = {
  'Salario': ['nomina', 'salario', 'sueldo', 'planilla'],
  'Freelance': ['honorario', 'freelance', 'consultoria', 'servicio profesional'],
  'Side Hustle': ['side hustle', 'venta', 'emprendimiento', 'negocio'],
  'Inversiones': ['dividendo', 'interes', 'rendimiento', 'cupon', 'ganancia'],
  'Renta': ['alquiler', 'renta', 'arrendamiento'],
  'Alimentación': ['supermercado', 'restaurante', 'comida', 'paiz', 'walmart', 'la torre', 'pollo campero', 'mcdonalds', 'burger', 'pizza'],
  'Transporte': ['gasolina', 'uber', 'combustible', 'parqueo', 'peaje', 'shell', 'texaco', 'puma'],
  'Vivienda': ['hipoteca', 'mantenimiento', 'condominio', 'seguro hogar'],
  'Servicios': ['agua', 'luz', 'energía', 'eegsa', 'empagua', 'internet', 'telefono', 'tigo', 'claro', 'movistar', 'gas'],
  'Entretenimiento': ['cine', 'netflix', 'spotify', 'hbo', 'disney', 'amazon prime', 'juego'],
  'Salud': ['farmacia', 'hospital', 'clinica', 'medico', 'doctor', 'laboratorio', 'seguro medico'],
  'Educación': ['colegio', 'universidad', 'curso', 'libro', 'matricula', 'inscripcion'],
  'Compras': ['tienda', 'amazon', 'mercado libre', 'compra', 'electronica'],
  'Suscripciones': ['suscripcion', 'membresia', 'mensualidad', 'gym', 'gimnasio'],
  // VACÍOS A PROPÓSITO, no es un hueco por llenar. A estas dos se llega por
  // EVIDENCIA, no por texto: el neteo del pago de tarjeta las asigna cuando el
  // débito del banco y el pago de la tarjeta se emparejan al centavo
  // (lib/cardPaymentNetting.js), y el usuario puede elegirlas a mano cuando
  // sabe que una fila movió dinero entre cuentas suyas.
  //
  // Agregarles palabras clave las volvería peligrosas justamente ahora que no
  // cuentan en los totales: "TRANSFERENCIA" en el estado de un banco es casi
  // siempre dinero enviado a OTRA persona, o sea un gasto real, y clasificarlo
  // acá lo haría desaparecer del mes en silencio.
  'Transferencia Recibida': [],
  'Transferencia Enviada': [],
}

export function categorizeTransaction(description, type) {
  if (!description) return type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos'
  const lower = description.toLowerCase()

  const validCategories = type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (!validCategories.includes(category)) continue
    if (keywords.some(kw => lower.includes(kw))) return category
  }

  return type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos'
}

// Las 22 categorías en inglés.
//
// El string en español ES LA LLAVE: está guardado en cada documento de
// Firestore, lo escriben los parsers de estados de cuenta y lo compara
// `categorizeTransaction`. Renombrarlo rompería toda transacción ya
// registrada, así que la traducción vive APARTE, igual que el `labelEn` que
// los grupos ya tienen desde siempre.
//
// Sin esto, en inglés la pantalla mezclaba los dos idiomas: "Housing &
// Utilities" (grupo, traducido) encima de "Alimentación" (categoría, no).
export const CATEGORY_LABELS_EN = {
  // Ingresos
  'Salario': 'Salary',
  'Freelance': 'Freelance',
  'Side Hustle': 'Side hustle',
  'Inversiones': 'Investments',
  'Renta': 'Rental income',
  'Promoción de tarjeta': 'Card rewards',
  'Transferencia Recibida': 'Transfer received',
  'Otros Ingresos': 'Other income',
  // Gastos
  'Alimentación': 'Food',
  'Transporte': 'Transport',
  'Vivienda': 'Housing',
  'Servicios': 'Utilities',
  'Entretenimiento': 'Entertainment',
  'Salud': 'Health',
  'Educación': 'Education',
  'Compras': 'Shopping',
  'Suscripciones': 'Subscriptions',
  'Seguros': 'Insurance',
  'Impuestos': 'Taxes',
  'Comisiones': 'Bank fees',
  'Financiamiento': 'Loan payments',
  'Transferencia Enviada': 'Transfer sent',
  'Otros Gastos': 'Other expenses',
}

// Una categoría que no esté en el mapa se imprime tal cual: es preferible ver
// el español a ver un hueco, y así una categoría nueva nunca desaparece de la
// pantalla por olvidar traducirla.
export function categoryLabel(category, lang = 'es') {
  if (!category) return ''
  if (lang === 'es') return category
  return CATEGORY_LABELS_EN[category] || category
}

export const CATEGORY_COLORS = {
  'Salario': '#34d399',
  'Freelance': '#34d399',
  'Side Hustle': '#22d3ee',
  'Inversiones': '#06b6d4',
  'Renta': '#8b5cf6',
  'Promoción de tarjeta': '#00764F',
  'Transferencia Recibida': '#6366f1',
  'Otros Ingresos': '#64748b',
  'Alimentación': '#f59e0b',
  'Transporte': '#ef4444',
  'Vivienda': '#3b82f6',
  'Servicios': '#8b5cf6',
  'Entretenimiento': '#ec4899',
  'Salud': '#14b8a6',
  'Educación': '#6366f1',
  'Compras': '#f97316',
  'Suscripciones': '#a855f7',
  'Seguros': '#0ea5e9',
  'Impuestos': '#b45309',
  'Comisiones': '#78716c',
  'Financiamiento': '#7c3aed',
  'Transferencia Enviada': '#94a3b8',
  'Otros Gastos': '#64748b',
}
