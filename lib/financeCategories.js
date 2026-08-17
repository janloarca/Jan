export const FINANCE_CATEGORIES = {
  INCOME: [
    'Salario',
    'Freelance',
    'Side Hustle',
    'Inversiones',
    'Renta',
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

// Income sections for the structured monthly view. 'Inversiones' is auto-only:
// it comes READ-ONLY from portfolio DIVIDEND transactions — never manually
// entered from the finances tab (statement imports may still categorize into it).
export const INCOME_GROUPS = [
  { key: 'fijos', label: 'Ingresos fijos', labelEn: 'Fixed income', icon: '💼', categories: ['Salario', 'Renta'] },
  { key: 'side', label: 'Side hustle', labelEn: 'Side hustle', icon: '🚀', categories: ['Freelance', 'Side Hustle'] },
  { key: 'inversion', label: 'Inversión', labelEn: 'Investments', icon: '🔒', categories: ['Inversiones'], autoOnly: true },
  { key: 'otros-in', label: 'Otros', labelEn: 'Other', icon: '·', categories: ['Transferencia Recibida', 'Otros Ingresos'] },
]

// Categories the manual entry modal must NOT offer (auto-fed elsewhere).
export const MANUAL_INCOME_BLOCKED = ['Inversiones']

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

export const CATEGORY_COLORS = {
  'Salario': '#34d399',
  'Freelance': '#34d399',
  'Side Hustle': '#22d3ee',
  'Inversiones': '#06b6d4',
  'Renta': '#8b5cf6',
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
