export const FINANCE_CATEGORIES = {
  INCOME: [
    'Salario',
    'Freelance',
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
    'Transferencia Enviada',
    'Otros Gastos',
  ],
}

const CATEGORY_KEYWORDS = {
  'Salario': ['nomina', 'salario', 'sueldo', 'planilla'],
  'Freelance': ['honorario', 'freelance', 'consultoria', 'servicio profesional'],
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
  'Salario': '#22c55e',
  'Freelance': '#10b981',
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
  'Transferencia Enviada': '#94a3b8',
  'Otros Gastos': '#64748b',
}
