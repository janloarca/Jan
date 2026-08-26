import { readGoal, clampTargetYear, GOAL_MAX_YEAR } from '../GoalTracker'
import { formatCompact } from '../utils'

// La vista de lectura de Metas sale de estos dos helpers. Los bugs que fijan:
// un goal guardado en 0 era falsy y el `||` caia al STRING del formulario
// (crash de formatCompact y "cancelar" mostrando lo tecleado), y un anio
// objetivo sin clamp alimentaba el Monte Carlo con decenas de miles de anios.

describe('readGoal', () => {
  test('un goal guardado en 0 se LEE como 0, nunca cae al default', () => {
    expect(readGoal(0, 12000)).toBe(0)
  })
  test('sin valor guardado, el default', () => {
    expect(readGoal(undefined, 12000)).toBe(12000)
    expect(readGoal(null, 12000)).toBe(12000)
    expect(readGoal('', 12000)).toBe(12000)
  })
  test('un string numerico guardado se coerciona a numero', () => {
    expect(readGoal('50000', 12000)).toBe(50000)
  })
  test('basura o negativo caen al default', () => {
    expect(readGoal('abc', 12000)).toBe(12000)
    expect(readGoal(-5, 12000)).toBe(12000)
  })

  test('regresion del crash: la cadena vieja moria en formatCompact', () => {
    // `0 || '999'` entrega el string del form; la ultima rama de formatCompact
    // hace value.toFixed(0) sobre el valor CRUDO, y un string < 1000 revienta.
    const saved = 0
    const typedInForm = '999'
    expect(() => formatCompact(saved || typedInForm)).toThrow()
    // Con readGoal el mismo caso imprime el 0 guardado, sin crash.
    expect(formatCompact(readGoal(saved, 12000))).toBe('$0')
  })
})

describe('clampTargetYear', () => {
  const y = new Date().getFullYear()
  test('un anio absurdo se acota: el Monte Carlo no puede recibir milenios', () => {
    expect(clampTargetYear(99999)).toBe(GOAL_MAX_YEAR)
    // El input declara min/max pero un type="number" no impide teclearlo.
    expect(clampTargetYear('99999')).toBe(GOAL_MAX_YEAR)
  })
  test('un anio en el pasado sube al anio en curso', () => {
    expect(clampTargetYear(1990)).toBe(y)
  })
  test('un anio valido pasa tal cual, tecleado como texto tambien', () => {
    expect(clampTargetYear(2040)).toBe(2040)
    expect(clampTargetYear('2040')).toBe(2040)
  })
  test('basura o ausencia caen al default (+5)', () => {
    expect(clampTargetYear(undefined)).toBe(y + 5)
    expect(clampTargetYear('abc')).toBe(y + 5)
  })
  test('el horizonte queda acotado por construccion', () => {
    // years x 12 meses x 500 simulaciones: la cota es lo que impide congelar
    // el navegador con un dato malo ya guardado.
    expect(GOAL_MAX_YEAR - y).toBeLessThanOrEqual(40)
  })
})

// FASE LL — la meta tiene MONEDA propia (decision del usuario, 26 ago 2026):
// cambiar la moneda base ya no re-interpreta la meta en silencio.
describe('goalInBase (FASE LL)', () => {
  const { goalInBase } = require('../GoalTracker')
  const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.7 : from === 'GTQ' && to === 'USD' ? a / 7.7 : a)

  it('una meta en USD leida con base GTQ se convierte: el significado no se mueve', () => {
    expect(goalInBase(100000, 'USD', 'GTQ', convert)).toBeCloseTo(770000, 2)
  })

  it('misma moneda: identidad exacta', () => {
    expect(goalInBase(100000, 'USD', 'USD', convert)).toBe(100000)
  })

  it('una meta VIEJA sin moneda conserva el comportamiento de siempre (se lee en la base del momento)', () => {
    expect(goalInBase(100000, null, 'GTQ', convert)).toBe(100000)
  })

  it('sin converter (tasas frias) cae al monto crudo, nunca a NaN', () => {
    expect(goalInBase(100000, 'USD', 'GTQ', null)).toBe(100000)
    expect(goalInBase('basura', 'USD', 'GTQ', convert)).toBe(0)
  })
})
