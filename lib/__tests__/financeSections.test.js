import { commitmentsHaveContent, yearInViewHasContent, nowMonthKey, nowDateKey } from '@/lib/financeSections'
import fs from 'fs'
import path from 'path'

// Un encabezado de sección sobre nada es exactamente el defecto que este módulo
// existe para impedir, así que la pregunta tiene que contestarse con los MISMOS
// selectores que usan las cards. Estos tests fijan las dos mitades: que la
// respuesta sea correcta, y que las cards no se hayan ido a otro selector.

const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000))

describe('¿la sección tiene algo debajo?', () => {
  test('sin transacciones, Compromisos no existe', () => {
    expect(commitmentsHaveContent([])).toBe(false)
    expect(commitmentsHaveContent(null)).toBe(false)
  })

  test('un gasto suelto no es un compromiso', () => {
    const txs = [
      { id: '1', type: 'EXPENSE', date: daysAgo(10), amount: 120, currency: 'GTQ', merchant: 'Cafe', category: 'Alimentación' },
    ]
    expect(commitmentsHaveContent(txs)).toBe(false)
  })

  // Una cuota activa basta: la sección existe si CUALQUIERA de sus tres cards
  // tiene contenido, porque cada una se auto-oculta.
  test('un plan de cuotas vivo enciende la sección', () => {
    const txs = [
      { id: 'a', type: 'EXPENSE', date: daysAgo(40), amount: 500, currency: 'GTQ', merchant: 'Tienda (1/6)', installment: { num: 1, of: 6 } },
      { id: 'b', type: 'EXPENSE', date: daysAgo(10), amount: 500, currency: 'GTQ', merchant: 'Tienda (2/6)', installment: { num: 2, of: 6 } },
    ]
    expect(commitmentsHaveContent(txs)).toBe(true)
  })

  test('un año sin un solo movimiento no dibuja la vista del año', () => {
    const y = new Date().getFullYear()
    expect(yearInViewHasContent([], y)).toBe(false)
    expect(yearInViewHasContent([{ id: '1', type: 'EXPENSE', date: `${y - 3}-05-04`, amount: 10, currency: 'GTQ' }], y)).toBe(false)
  })

  test('un movimiento del año SÍ la dibuja', () => {
    const y = new Date().getFullYear()
    const txs = [{ id: '1', type: 'EXPENSE', date: `${y}-03-04`, amount: 250, currency: 'GTQ', category: 'Alimentación' }]
    expect(yearInViewHasContent(txs, y)).toBe(true)
  })

  test('las derivaciones de hoy tienen la forma que esperan los selectores', () => {
    const d = new Date(2026, 1, 9, 15, 0, 0) // 9 feb 2026, hora local
    expect(nowMonthKey(d)).toBe('2026-02')
    expect(nowDateKey(d)).toBe('2026-02-09')
  })
})

// La pregunta y la respuesta tienen que salir del MISMO selector. Si una card
// cambia de motor, esta sección empezaría a decidir con otra regla y el
// encabezado volvería a colgarse (o peor, escondería contenido real).
describe('las cards siguen preguntándole al mismo selector', () => {
  const CARD = (f) => fs.readFileSync(path.join(__dirname, '../..', 'components/finance', f), 'utf8')

  test.each([
    ['InstallmentPlansCard.jsx', 'activeInstallmentPlans'],
    ['RecurringChargesCard.jsx', 'detectRecurringCharges'],
    ['DebtAgingCard.jsx', 'buildDebtAging'],
    ['YearInViewCard.jsx', 'yearTotalsByMonth'],
  ])('%s usa %s', (file, selector) => {
    expect(CARD(file)).toContain(selector)
  })

  // Y siguen auto-ocultándose: si una dejara de hacerlo, la sección podría
  // esconder una card que sí tenía algo que decir.
  test.each([
    'InstallmentPlansCard.jsx',
    'RecurringChargesCard.jsx',
    'DebtAgingCard.jsx',
    'YearInViewCard.jsx',
  ])('%s se auto-oculta sin contenido', (file) => {
    expect(CARD(file)).toMatch(/return null/)
  })
})
