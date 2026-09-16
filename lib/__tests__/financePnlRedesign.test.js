// Lo que se le pide al rediseño de Flujo (FASE NR): que el mes se lea como un
// estado de resultados, que la taxonomía del usuario sea ADITIVA (jamás
// destructiva sobre las llaves guardadas), y que la dona y el estado no puedan
// contar historias distintas sobre el mismo dinero.

import { computeMonthlyAnalysis, yearGroupTotals } from '../financeMonth'
import {
  resolveCategoryModel, sanitizeCategoryConfig, withCustomCategory,
  withCategoryOverride, withoutCustomCategory, canDeleteCustomCategory,
  categoryNameProblem, normalizeCategoryKey, isBuiltinCategory,
} from '../financeCategoryModel'
import { buildPnlStatement } from '../financePnl'
import { buildDonut, DONUT_CIRCUMFERENCE } from '../financeDonut'
import { FINANCE_CATEGORIES, EXPENSE_GROUPS, OTHER_GROUP } from '../financeCategories'

const tx = (date, type, amount, category, currency = 'GTQ') =>
  ({ date, type, amount, category, currency })

// Un mes YA CERRADO, para que `partialMonth` no interfiera salvo donde se
// prueba a propósito.
const CLOSED = new Date(2026, 8, 15) // 15 sep 2026, con agosto cerrado

const MONTH = [
  tx('2026-08-05', 'INCOME', 15000, 'Salario'),
  tx('2026-08-20', 'INCOME', 1000, 'Freelance'),
  // Compromisos
  tx('2026-08-01', 'EXPENSE', 4000, 'Vivienda'),
  tx('2026-08-03', 'EXPENSE', 800, 'Servicios'),
  tx('2026-08-04', 'EXPENSE', 1200, 'Seguros'),
  // Discrecional
  tx('2026-08-10', 'EXPENSE', 2000, 'Alimentación'),
  tx('2026-08-12', 'EXPENSE', 900, 'Transporte'),
  tx('2026-08-18', 'EXPENSE', 500, 'Entretenimiento'),
]

const PREV = [
  tx('2026-07-05', 'INCOME', 14000, 'Salario'),
  tx('2026-07-01', 'EXPENSE', 4000, 'Vivienda'),
  tx('2026-07-10', 'EXPENSE', 2500, 'Alimentación'),
]

const analyze = (txs = [...MONTH, ...PREV]) =>
  computeMonthlyAnalysis(txs, { month: 7, year: 2026 }, null, { now: CLOSED })

describe('el estado de resultados NO vuelve a sumar nada', () => {
  it('las dos secciones suman EXACTAMENTE el gasto del mes', () => {
    const a = analyze()
    const pnl = buildPnlStatement(a, resolveCategoryModel(null))
    // El invariante central: el módulo re-secciona, no re-calcula. Si algún día
    // sumara por su cuenta, esta igualdad se rompería al primer borde raro
    // (un reembolso, una transferencia, una moneda convertida).
    expect(pnl.fixed.total + pnl.variable.total).toBeCloseTo(a.expenses, 6)
    expect(pnl.expensesTotal).toBeCloseTo(a.expenses, 6)
  })

  it('el ingreso de la sección es el del motor, y el resultado es la resta', () => {
    const a = analyze()
    const pnl = buildPnlStatement(a, resolveCategoryModel(null))
    expect(pnl.income.total).toBeCloseTo(a.income, 6)
    expect(pnl.bottom.amount).toBeCloseTo(a.income - a.expenses, 6)
    expect(pnl.bottom.surplus).toBe(true)
  })

  it('reparte los gastos entre compromiso y discrecional con el default', () => {
    const pnl = buildPnlStatement(analyze(), resolveCategoryModel(null))
    expect(pnl.fixed.total).toBeCloseTo(4000 + 800 + 1200, 6)   // Vivienda + Servicios + Seguros
    expect(pnl.variable.total).toBeCloseTo(2000 + 900 + 500, 6) // Alimentación + Transporte + Entretenimiento
  })

  it('la columna común divide entre el INGRESO, y sin ingreso no existe', () => {
    const pnl = buildPnlStatement(analyze(), resolveCategoryModel(null))
    // 6,000 de compromisos sobre 16,000 de ingreso.
    expect(pnl.committedPct).toBeCloseTo((6000 / 16000) * 100, 4)
    const vivienda = pnl.fixed.rows.find((r) => r.key === 'Vivienda')
    expect(vivienda.pctOfIncome).toBeCloseTo((4000 / 16000) * 100, 4)

    // Un mes sin ingreso: el porcentaje es null, NUNCA 0. Un cero afirmaría
    // que esa línea no pesa nada, y lo que pasa es que no hay denominador.
    const noIncome = computeMonthlyAnalysis(
      MONTH.filter((t) => t.type === 'EXPENSE'), { month: 7, year: 2026 }, null, { now: CLOSED })
    const pnl2 = buildPnlStatement(noIncome, resolveCategoryModel(null))
    expect(pnl2.hasIncome).toBe(false)
    expect(pnl2.committedPct).toBeNull()
    expect(pnl2.fixed.rows[0].pctOfIncome).toBeNull()
  })

  it('un mes EN CURSO no dibuja variaciones por línea', () => {
    // Misma regla que el resto de la pantalla: media ventana contra una
    // completa no se compara. `momComparable` la decide en un solo lugar.
    const partial = computeMonthlyAnalysis([...MONTH, ...PREV], { month: 7, year: 2026 }, null,
      { now: new Date(2026, 7, 10) })
    const pnl = buildPnlStatement(partial, resolveCategoryModel(null))
    // El 10 de agosto la ventana SÍ cabe en julio, así que compara a mismo día.
    expect(partial.windowDays).toBe(10)
    // Y el 30 de marzo contra febrero no cabe: ahí se calla.
    const marzo = computeMonthlyAnalysis(
      [tx('2026-03-30', 'EXPENSE', 100, 'Alimentación'), tx('2026-02-10', 'EXPENSE', 90, 'Alimentación')],
      { month: 2, year: 2026 }, null, { now: new Date(2026, 2, 30) })
    expect(marzo.momComparable).toBe(false)
    const pnlMarzo = buildPnlStatement(marzo, resolveCategoryModel(null))
    expect(pnlMarzo.variable.rows.every((r) => r.comparable === false)).toBe(true)
  })

  it('la variación por línea sale de la MISMA ventana que la del grupo', () => {
    const a = analyze()
    const pnl = buildPnlStatement(a, resolveCategoryModel(null))
    const alim = pnl.variable.rows.find((r) => r.key === 'Alimentación')
    // 2,000 este mes contra 2,500 el pasado.
    expect(alim.prevAmount).toBeCloseTo(2500, 6)
    expect(alim.momPct).toBeCloseTo(((2000 - 2500) / 2500) * 100, 4)
    expect(alim.comparable).toBe(true)
    // Una línea sin base el mes pasado no se compara: "no había con qué medir"
    // no es "bajó 100%".
    const ent = pnl.variable.rows.find((r) => r.key === 'Entretenimiento')
    expect(ent.momPct).toBeNull()
    expect(ent.comparable).toBe(false)
  })

  it('un déficit se reporta como déficit', () => {
    const a = computeMonthlyAnalysis(
      [tx('2026-08-05', 'INCOME', 1000, 'Salario'), tx('2026-08-06', 'EXPENSE', 3000, 'Vivienda')],
      { month: 7, year: 2026 }, null, { now: CLOSED })
    const pnl = buildPnlStatement(a, resolveCategoryModel(null))
    expect(pnl.bottom.surplus).toBe(false)
    expect(pnl.bottom.amount).toBeCloseTo(-2000, 6)
  })
})

describe('la taxonomía del usuario es ADITIVA', () => {
  it('⛔ ninguna categoría de fábrica puede renombrar su LLAVE ni borrarse', () => {
    // La llave está guardada en cada transacción y la siguen escribiendo los
    // parsers de los bancos: renombrarla rompería todo lo ya registrado. Este
    // test existe para que nadie "mejore" el modelo agregando ese camino.
    const cfg = withCategoryOverride(null, 'Alimentación', { label: 'Comida' })
    const model = resolveCategoryModel(cfg)
    const entry = model.entry('Alimentación')
    expect(entry.key).toBe('Alimentación')   // la llave NO se movió
    expect(entry.label).toBe('Comida')       // lo que cambia es el rótulo
    expect(entry.labelEn).toBe('Comida')     // el rótulo del usuario gana en ambos idiomas

    // Y no existe forma de sacarla del modelo.
    const afterDelete = resolveCategoryModel(withoutCustomCategory(cfg, 'Alimentación'))
    expect(afterDelete.entry('Alimentación')).not.toBeNull()
    expect(canDeleteCustomCategory('Alimentación', [])).toBe(false)

    // Y el modelo siempre trae las 23 de fábrica, pase lo que pase.
    for (const k of [...FINANCE_CATEGORIES.INCOME, ...FINANCE_CATEGORIES.EXPENSE]) {
      expect(afterDelete.entry(k)).not.toBeNull()
    }
  })

  it('esconder saca del SELECTOR y jamás de los datos', () => {
    const cfg = withCategoryOverride(null, 'Side Hustle', { hidden: true })
    const model = resolveCategoryModel(cfg)
    expect(model.pickable('INCOME').some((c) => c.key === 'Side Hustle')).toBe(false)
    // La fila que ya la usa se sigue leyendo con su rótulo.
    expect(model.labelOf('Side Hustle', 'es')).toBe('Side Hustle')
    expect(model.entry('Side Hustle').hidden).toBe(true)
  })

  it('una categoría nueva se guarda con su nombre como llave y es elegible', () => {
    const cfg = withCustomCategory(null, { name: '  Mascotas  ', type: 'EXPENSE', group: 'personal' })
    const model = resolveCategoryModel(cfg)
    const entry = model.entry('Mascotas')
    expect(entry).not.toBeNull()
    expect(entry.custom).toBe(true)
    expect(entry.groupKey).toBe('personal')
    expect(model.pickable('EXPENSE').some((c) => c.key === 'Mascotas')).toBe(true)
  })

  it('una custom SÍ se puede borrar, pero solo si ninguna fila la usa', () => {
    const cfg = withCustomCategory(null, { name: 'Mascotas', type: 'EXPENSE' })
    expect(canDeleteCustomCategory('Mascotas', [])).toBe(true)
    expect(canDeleteCustomCategory('Mascotas', [tx('2026-08-01', 'EXPENSE', 10, 'Mascotas')])).toBe(false)
    const gone = resolveCategoryModel(withoutCustomCategory(cfg, 'Mascotas'))
    expect(gone.entry('Mascotas')).toBeNull()
  })

  it('un nombre repetido o el de una de fábrica se rechaza con su razón', () => {
    const model = resolveCategoryModel(withCustomCategory(null, { name: 'Mascotas', type: 'EXPENSE' }))
    expect(categoryNameProblem('', { model })).toBe('empty')
    expect(categoryNameProblem('Alimentación', { model })).toBe('builtin')
    expect(categoryNameProblem('mascotas', { model })).toBe('duplicate')
    expect(categoryNameProblem('Jardín', { model })).toBeNull()
  })

  it('la llave se normaliza y se acota', () => {
    expect(normalizeCategoryKey('  Gastos   del   perro ')).toBe('Gastos del perro')
    expect(normalizeCategoryKey('a/b\\c')).toBe('a b c')
    expect(normalizeCategoryKey('x'.repeat(80)).length).toBe(32)
    expect(isBuiltinCategory('Alimentación')).toBe(true)
    expect(isBuiltinCategory('Mascotas')).toBe(false)
  })

  it('⛔ la config se persiste como ARREGLOS, nunca como mapas', () => {
    // Firestore fusiona un mapa anidado CAMPO POR CAMPO, así que quitar una
    // llave de un mapa no se guardaría nunca: el override borrado volvería
    // solo en la siguiente carga. Con arreglos, el campo se reemplaza entero.
    const cfg = withCategoryOverride(
      withCustomCategory(null, { name: 'Mascotas', type: 'EXPENSE' }),
      'Vivienda', { fixed: false })
    expect(Array.isArray(cfg.custom)).toBe(true)
    expect(Array.isArray(cfg.overrides)).toBe(true)
    // Y quitar el override lo saca del arreglo de verdad.
    const cleared = withCategoryOverride(cfg, 'Vivienda', { fixed: undefined })
    expect(cleared.overrides.some((o) => o.key === 'Vivienda')).toBe(false)
  })

  it('una config corrupta no puede tumbar la pantalla', () => {
    const cfg = sanitizeCategoryConfig({
      custom: [null, { key: '' }, { key: 'Alimentación' }, { name: 'Ok', type: 'raro' }, 7],
      overrides: 'no soy un arreglo',
    })
    expect(cfg.custom).toEqual([{ key: 'Ok', type: 'EXPENSE', group: null, fixed: false }])
    expect(cfg.overrides).toEqual([])
    expect(() => resolveCategoryModel({ custom: 1, overrides: {} })).not.toThrow()
  })

  it('fijo/variable se puede cambiar y mueve la línea de sección', () => {
    const before = buildPnlStatement(analyze(), resolveCategoryModel(null))
    expect(before.fixed.rows.some((r) => r.key === 'Vivienda')).toBe(true)

    const cfg = withCategoryOverride(null, 'Vivienda', { fixed: false })
    const after = buildPnlStatement(analyze(), resolveCategoryModel(cfg))
    expect(after.fixed.rows.some((r) => r.key === 'Vivienda')).toBe(false)
    expect(after.variable.rows.some((r) => r.key === 'Vivienda')).toBe(true)
    // Y el total del mes NO se movió: solo cambió de qué lado se cuenta.
    expect(after.expensesTotal).toBeCloseTo(before.expensesTotal, 6)
  })
})

describe('la dona', () => {
  const groups = [...EXPENSE_GROUPS, OTHER_GROUP]
  const monthCats = { 'Vivienda': 4000, 'Alimentación': 2000, 'Transporte': 900 }

  it('las rebanadas suman el total y el círculo completo', () => {
    const d = buildDonut(monthCats, groups, { model: resolveCategoryModel(null) })
    expect(d.total).toBeCloseTo(6900, 6)
    expect(d.slices.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(6900, 6)
    expect(d.slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 4)
    // El largo dibujado es el porcentaje sobre la circunferencia, y la última
    // rebanada cierra el círculo exactamente.
    const drawn = d.slices.reduce((s, x) => s + parseFloat(x.dashArray.split(' ')[0]), 0)
    expect(drawn).toBeCloseTo(DONUT_CIRCUMFERENCE, 4)
  })

  it('⛔ una rebanada NEGATIVA no se dibuja, se declara', () => {
    // Un grupo puede cerrar en negativo cuando los reembolsos superan lo
    // gastado. Usar su magnitud lo pintaría como gasto (falso) y omitirlo en
    // silencio rompería la suma.
    const d = buildDonut({ ...monthCats, 'Compras': -300 }, groups, { model: resolveCategoryModel(null) })
    expect(d.slices.some((s) => s.amount < 0)).toBe(false)
    expect(d.negativeTotal).toBeCloseTo(-300, 6)
    expect(d.negatives).toHaveLength(1)
    // Y el total sigue siendo el de las rebanadas positivas, así que los
    // porcentajes siguen sumando 100.
    expect(d.slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 4)
  })

  it('agrupa con la taxonomía del USUARIO, no con la de fábrica', () => {
    // Sin esto, mover una categoría de grupo dejaría la dona y el estado del
    // mes contando la misma categoría de dos lados distintos.
    const model = resolveCategoryModel(withCategoryOverride(null, 'Alimentación', { group: 'personal' }))
    const d = buildDonut(monthCats, groups, { model })
    const personal = d.slices.find((s) => s.key === 'personal')
    expect(personal.amount).toBeCloseTo(2000, 6)
    expect(d.slices.some((s) => s.key === 'alimentacion')).toBe(false)
  })

  it('sin gasto no hay rebanadas y no explota', () => {
    const d = buildDonut({}, groups, { model: resolveCategoryModel(null) })
    expect(d.slices).toEqual([])
    expect(d.total).toBe(0)
  })
})

describe('los totales del año', () => {
  const YEAR_TXS = [
    tx('2026-01-10', 'EXPENSE', 1000, 'Vivienda'),
    tx('2026-05-10', 'EXPENSE', 500, 'Alimentación'),
    tx('2026-08-10', 'EXPENSE', 2000, 'Alimentación'),
    tx('2026-08-05', 'INCOME', 9000, 'Salario'),
    // Otro año: no puede colarse.
    tx('2025-08-10', 'EXPENSE', 7777, 'Alimentación'),
  ]

  it('suman los doce meses del año pedido y nada más', () => {
    const y = yearGroupTotals(YEAR_TXS, 2026, null)
    expect(y.expenses).toBeCloseTo(3500, 6)
    expect(y.income).toBeCloseTo(9000, 6)
    expect(y.byCategory['Alimentación']).toBeCloseTo(2500, 6)
    expect(y.byCategory['Vivienda']).toBeCloseTo(1000, 6)
  })

  it('el detalle por categoría suma exactamente el total por grupo', () => {
    // Es lo que hace imposible que la dona del año y las doce columnas del año
    // discrepen: los dos salen del MISMO recorrido.
    const y = yearGroupTotals(YEAR_TXS, 2026, null)
    const fromCats = Object.values(y.byCategory).reduce((s, v) => s + v, 0)
    const fromGroups = Object.values(y.byGroup).reduce((s, v) => s + v, 0)
    expect(fromCats).toBeCloseTo(fromGroups, 6)
    expect(fromCats).toBeCloseTo(y.expenses, 6)
  })

  it('una transferencia no entra por ningún lado', () => {
    const y = yearGroupTotals(
      [...YEAR_TXS, tx('2026-03-01', 'EXPENSE', 5000, 'Transferencia Enviada')], 2026, null)
    expect(y.expenses).toBeCloseTo(3500, 6)
    expect(y.byCategory['Transferencia Enviada']).toBeUndefined()
  })
})

describe('`prevCategories` es una ADICIÓN, no un cambio', () => {
  it('no mueve ninguna cifra que el motor ya devolvía', () => {
    const a = analyze()
    expect(a.income).toBeCloseTo(16000, 6)
    expect(a.expenses).toBeCloseTo(9400, 6)
    expect(a.savings).toBeCloseTo(6600, 6)
    // Y el campo nuevo trae la ventana de comparación, la misma que los grupos.
    expect(a.prevCategories['Vivienda']).toBeCloseTo(4000, 6)
    expect(a.prevCategories['Alimentación']).toBeCloseTo(2500, 6)
    expect(a.prevIncomeCategories['Salario']).toBeCloseTo(14000, 6)
  })

  it('sin mes anterior es null, no un objeto vacío', () => {
    // "No hay con qué comparar" y "comparé y dio cero" son conclusiones
    // opuestas; un `{}` las haría ver iguales río abajo.
    const a = computeMonthlyAnalysis(MONTH, { month: 7, year: 2026 }, null, { now: CLOSED })
    expect(a.prevCategories).toBeNull()
    expect(a.prevIncomeCategories).toBeNull()
    const pnl = buildPnlStatement(a, resolveCategoryModel(null))
    expect(pnl.fixed.rows.every((r) => r.prevAmount === null)).toBe(true)
  })
})
