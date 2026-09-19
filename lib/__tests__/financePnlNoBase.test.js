import { buildPnlStatement } from '../financePnl'
import { computeMonthlyAnalysis } from '../financeMonth'
import { resolveCategoryModel } from '../financeCategoryModel'

// FASE OP. El mes que el usuario fotografió: el ÚNICO ingreso es un rebate de
// tarjeta de Q125.97 contra Q1,958.65 de gasto, así que el estado imprimía
// "Discrecional 1527%", "Comida 668%" y un déficit de "-1455%".
//
// Son aritméticamente correctos y no informan nada. Peor: la pantalla se
// contradecía a sí misma, porque el aviso ámbar de arriba (`incomeLooksUnlogged`,
// el MISMO predicado) ya decía que el estado "mide gastos contra casi nada".
//
// La regla es la de `isComparable`: una cifra que no se puede sostener no se
// muestra apagada, no se muestra.
const MONTH = '2026-09'

function txs() {
  return [
    { id: 'i1', type: 'INCOME', date: `${MONTH}-09`, amount: 125.97, currency: 'GTQ', category: 'Promoción de tarjeta' },
    { id: 'e1', type: 'EXPENSE', date: `${MONTH}-15`, amount: 841.50, currency: 'GTQ', category: 'Alimentación' },
    { id: 'e2', type: 'EXPENSE', date: `${MONTH}-15`, amount: 555.90, currency: 'GTQ', category: 'Transporte' },
    { id: 'e3', type: 'EXPENSE', date: `${MONTH}-08`, amount: 35.00, currency: 'GTQ', category: 'Servicios' },
  ]
}

const build = (transactions) => {
  const analysis = computeMonthlyAnalysis(transactions, { month: 8, year: 2026 }, null, { now: new Date(2026, 8, 16) })
  return { analysis, pnl: buildPnlStatement(analysis, resolveCategoryModel(null)) }
}

describe('FASE OP: sin base creíble no hay columna común', () => {
  it('el mes del reporte se detecta como ingreso sin registrar', () => {
    const { analysis } = build(txs())
    expect(analysis.incomeLooksUnlogged).toBe(true)
  })

  it('ninguna línea imprime un porcentaje de cuatro dígitos', () => {
    const { pnl } = build(txs())
    const pcts = [
      pnl.income.pctOfIncome, pnl.fixed.pctOfIncome, pnl.variable.pctOfIncome,
      pnl.bottom.pctOfIncome, pnl.expensesPctOfIncome, pnl.committedPct,
      ...pnl.variable.rows.map((r) => r.pctOfIncome),
      ...pnl.fixed.rows.map((r) => r.pctOfIncome),
    ]
    // Regresión NEGATIVA: con el comportamiento viejo esta lista traía 1527,
    // 668, 441, -1455 y 28.
    expect(pcts.every((p) => p == null)).toBe(true)
  })

  it('el rótulo "% del ingreso" desaparece junto con la columna que nombra', () => {
    const { pnl } = build(txs())
    expect(pnl.hasIncome).toBe(false)
  })

  it('⛔ los MONTOS no se tocan: el déficit sigue siendo el real', () => {
    const { analysis, pnl } = build(txs())
    // 125.97 - (841.50 + 555.90 + 35.00)
    expect(pnl.bottom.amount).toBeCloseTo(-1306.43, 2)
    expect(pnl.bottom.surplus).toBe(false)
    expect(pnl.income.total).toBeCloseTo(125.97, 2)
    expect(pnl.expensesTotal).toBeCloseTo(analysis.expenses, 2)
    // Y las dos secciones siguen sumando el gasto del mes por construcción.
    expect(pnl.fixed.total + pnl.variable.total).toBeCloseTo(analysis.expenses, 2)
  })

  it('con un sueldo de verdad la columna vuelve entera', () => {
    const withSalary = [
      ...txs(),
      { id: 'i2', type: 'INCOME', date: `${MONTH}-01`, amount: 15000, currency: 'GTQ', category: 'Salario' },
    ]
    const { analysis, pnl } = build(withSalary)
    expect(analysis.incomeLooksUnlogged).toBe(false)
    expect(pnl.hasIncome).toBe(true)
    // Control POSITIVO: sin él, "no imprime porcentajes" podría significar que
    // la columna dejó de existir SIEMPRE, que es otro bug.
    expect(pnl.bottom.pctOfIncome).not.toBeNull()
    expect(pnl.committedPct).toBeCloseTo((35 / 15125.97) * 100, 2)
    expect(pnl.variable.rows.every((r) => r.pctOfIncome != null)).toBe(true)
  })

  it('un mes sin ningún ingreso sigue sin columna, como siempre', () => {
    const noIncome = txs().filter((t) => t.type !== 'INCOME')
    const { pnl } = build(noIncome)
    expect(pnl.hasIncome).toBe(false)
    expect(pnl.bottom.pctOfIncome).toBeNull()
  })
})
