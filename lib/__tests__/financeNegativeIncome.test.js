import fs from 'fs'
import path from 'path'
import { computeMonthlyAnalysis } from '@/lib/financeMonth'
import { learnablesFrom } from '@/lib/importLearning'

// ⛔ FASE MK. Las partes tienen que sumar el todo, también del lado del ingreso.
//
// Un ingreso puede quedar NEGATIVO en neto: `CORRECCION A PAGO` (FASE KQ)
// revierte una entrada de dinero, así que un mes cuyas correcciones superan a
// los pagos de ese grupo cierra abajo de cero. Es el caso real del estado de BI,
// con −Q1,731.26 corrigiendo un pago del ciclo anterior.
//
// FASE JW arregló exactamente esto en el lado del GASTO (`!== 0`, con su
// comentario explicando por qué) y dejó el del ingreso en `> 0`: la asimetría
// no era una decisión, era la mitad que faltaba.
describe('un grupo de ingreso en negativo no puede desaparecer', () => {
  const conv = (a) => a
  const now = new Date('2026-09-05T12:00:00Z') // mes cerrado
  const run = (txs) => computeMonthlyAnalysis(txs, { month: 7, year: 2026 }, conv, { now })

  const conCorreccion = [
    { id: '1', type: 'INCOME', category: 'Salario', amount: 500, currency: 'GTQ', date: '2026-08-05' },
    { id: '2', type: 'INCOME', category: 'Salario', amount: -1731.26, currency: 'GTQ', date: '2026-08-10' },
    { id: '3', type: 'EXPENSE', category: 'Alimentación', amount: 200, currency: 'GTQ', date: '2026-08-06' },
  ]

  it('las filas suman EXACTAMENTE el ingreso del encabezado', () => {
    const r = run(conCorreccion)
    const suma = r.incomeGroups.reduce((s, g) => s + g.amount, 0)
    expect(r.income).toBeCloseTo(-1231.26, 6)
    expect(suma).toBeCloseTo(r.income, 6)
  })

  it('el grupo negativo se MUESTRA, con su monto', () => {
    const r = run(conCorreccion)
    const fijos = r.incomeGroups.find((g) => g.key === 'fijos')
    expect(fijos).toBeDefined()
    expect(fijos.amount).toBeCloseTo(-1231.26, 6)
  })

  // Regresión NEGATIVA explícita: con `> 0` no quedaba NINGUNA fila y el
  // desglose sumaba 0 contra un encabezado de −1,231.26.
  it('regresión: con `> 0` el desglose quedaba vacío', () => {
    const r = run(conCorreccion)
    const comoAntes = r.incomeGroups.filter((g) => g.amount > 0 || (g.prevAmount || 0) > 0)
    expect(comoAntes).toHaveLength(0)
  })

  // Control POSITIVO: un grupo que de verdad no tiene nada sigue sin aparecer,
  // o si no "se muestra el negativo" pasaría por mostrarlo TODO siempre.
  it('control: un grupo sin movimiento sigue sin listarse', () => {
    const r = run(conCorreccion)
    expect(r.incomeGroups.map((g) => g.key)).toEqual(['fijos'])
  })

  it('un mes normal se comporta igual que siempre', () => {
    const r = run([
      { id: '1', type: 'INCOME', category: 'Salario', amount: 8000, currency: 'GTQ', date: '2026-08-05' },
      { id: '2', type: 'EXPENSE', category: 'Alimentación', amount: 200, currency: 'GTQ', date: '2026-08-06' },
    ])
    const suma = r.incomeGroups.reduce((s, g) => s + g.amount, 0)
    expect(suma).toBeCloseTo(r.income, 6)
    expect(r.incomeGroups.map((g) => g.key)).toEqual(['fijos'])
  })
})

// ⛔ FASE MK. Corregir una categoría en la vista previa de un estado de BANCO
// tiene que enseñar igual que en uno de tarjeta: el desplegable existe en las
// dos (opera sobre `biMatch.newTxs`, que las dos rutas tienen) y corregir esa
// MISMA fila desde la lista de Flujo ya enseñaba desde FASE LB. El conocimiento
// no puede depender de por qué puerta pasó el usuario.
describe('el import de banco también enseña lo que el usuario corrige', () => {
  it('solo se aprende lo que el usuario TOCÓ a mano', () => {
    const filas = [
      { description: 'FRIDAS LA ESTACION', category: 'Alimentación', _categorySetByUser: true },
      { description: 'FERRETERIA XYZ', category: 'Otros Gastos' }, // la máquina, no el usuario
    ]
    const out = learnablesFrom(filas)
    expect(out).toHaveLength(1)
    expect(out[0].category).toBe('Alimentación')
  })

  // La razón por la que quitar el gate no puede ensuciar la tabla de reglas.
  it('un pago corregido a mano tampoco se aprende (no nombra un comercio)', () => {
    expect(learnablesFrom([
      { description: 'GRACIAS POR SU PAGO', category: 'Salario', kind: 'payment', _categorySetByUser: true },
    ])).toEqual([])
  })

  // Guardián de FUENTE: el gate vive en JSX que jest no puede montar sin el
  // modal entero con un archivo real (precedente `moneyInputs.test.js`).
  it('guardián: el aprendizaje del import no se gatea por tipo de estado', () => {
    const SRC = fs.readFileSync(path.join(process.cwd(), 'components/FileImportModal.jsx'), 'utf8')
    expect(SRC).toMatch(/if \(onLearnCategories\) \{/)
    expect(SRC).not.toMatch(/if \(isCard && onLearnCategories\)/)
  })
})
