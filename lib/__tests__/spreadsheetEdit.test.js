import { planCellEdit, editNeedsAnswer, accruesInBalance, ANSWER_CORRECTION, ANSWER_RETURN } from '../spreadsheetEdit'
import { getItemPrincipalCost, getItemValue } from '@/components/dashboard/utils'

// La ganancia tal como la mide la app, con las funciones REALES: si estos tests
// usaran su propia copia de la fórmula, podrían pasar mientras el tablero
// muestra otra cosa.
const gainOf = (item, income = 0) => getItemValue(item) - getItemPrincipalCost(item) + income
const apply = (item, patch) => ({ ...item, ...patch })

const BONO = {
  id: 'b1', type: 'Bond', name: 'VITALI', quantity: 1,
  purchasePrice: 6000, currentPrice: 6200, entryFee: 98, entryFeeMode: 'separate', currency: 'USD',
}
const BANCO = {
  id: 'k1', type: 'Bank', name: 'Fondo Liquido', quantity: 1,
  purchasePrice: 1000, currentPrice: 1000, currency: 'GTQ',
}

describe('a quien se le pregunta', () => {
  test('un activo de mercado NUNCA se pregunta', () => {
    expect(editNeedsAnswer({ item: BONO, oldValue: 100, newValue: 200, isMarket: true })).toBe(false)
  })
  test('un estatico si', () => {
    expect(editNeedsAnswer({ item: BONO, oldValue: 6200, newValue: 6100, isMarket: false })).toBe(true)
  })
  test('un cambio de redondeo no molesta a nadie', () => {
    expect(editNeedsAnswer({ item: BONO, oldValue: 6200, newValue: 6200.001, isMarket: false })).toBe(false)
  })
  test('solo una cuenta liquida acredita en su propio saldo', () => {
    expect(accruesInBalance(BANCO)).toBe(true)
    // Un bono con cantidad 1 NO: se revalua, no acredita efectivo. La regla
    // ancha de lib/contributions.js diria que si, y por eso no se usa.
    expect(accruesInBalance(BONO)).toBe(false)
    expect(accruesInBalance({ type: 'Real Estate', quantity: 1 })).toBe(false)
  })
})

// ⛔ EL INVARIANTE QUE PIDIO EL USUARIO, palabra por palabra: "no se tiene que
// tomar en cuenta en pérdida o ganancia".
describe('dato incorrecto: la ganancia NO se mueve', () => {
  test('en un bono con apreciacion real, la apreciacion sobrevive', () => {
    const antes = gainOf(BONO)
    expect(antes).toBe(200)
    const { patch, income } = planCellEdit({ item: BONO, oldValue: 6200, newValue: 6100, answer: ANSWER_CORRECTION })
    expect(income).toBe(null)
    const despues = apply(BONO, patch)
    // Solo se corrigio el numero que estaba mal: los 200 de apreciacion siguen.
    expect(gainOf(despues)).toBeCloseTo(200, 6)
    expect(getItemValue(despues)).toBeCloseTo(6100, 6)
  })

  test('sobreescribir el costo (lo que NO se hace) borraria esa apreciacion', () => {
    // Regresion negativa explicita: fija por que el costo se DESPLAZA en vez de
    // sobreescribirse. Con sobreescritura la ganancia caeria de 200 a 0.
    const sobreescrito = apply(BONO, { currentPrice: 6100, purchasePrice: 6100 })
    expect(gainOf(sobreescrito)).toBe(0)
  })

  test('en una cuenta de banco tampoco se mueve', () => {
    const { patch, income } = planCellEdit({ item: BANCO, oldValue: 1000, newValue: 1200, answer: ANSWER_CORRECTION })
    expect(income).toBe(null)
    expect(gainOf(apply(BANCO, patch))).toBeCloseTo(0, 6)
  })

  test('corregir hacia abajo tampoco produce una perdida', () => {
    const { patch } = planCellEdit({ item: BANCO, oldValue: 1000, newValue: 800, answer: ANSWER_CORRECTION })
    expect(gainOf(apply(BANCO, patch))).toBeCloseTo(0, 6)
  })

  test('con cantidad distinta de 1 el desplazamiento es por unidad', () => {
    const it = { id: 'x', type: 'Alternative', quantity: 4, purchasePrice: 100, currentPrice: 120 }
    expect(gainOf(it)).toBe(80)
    const { patch } = planCellEdit({ item: it, oldValue: 480, newValue: 400, answer: ANSWER_CORRECTION })
    expect(patch.currentPrice).toBeCloseTo(100, 6)
    expect(patch.purchasePrice).toBeCloseTo(80, 6)
    expect(gainOf(apply(it, patch))).toBeCloseTo(80, 6)
  })

  test('el costo nunca cae por debajo de cero', () => {
    const it = { id: 'x', type: 'Bond', quantity: 1, purchasePrice: 100, currentPrice: 100 }
    const { patch } = planCellEdit({ item: it, oldValue: 100, newValue: 0, answer: ANSWER_CORRECTION })
    expect(patch.purchasePrice).toBe(0)
  })

  test('la comision de entrada no se toca', () => {
    const { patch } = planCellEdit({ item: BONO, oldValue: 6200, newValue: 6100, answer: ANSWER_CORRECTION })
    expect(patch).not.toHaveProperty('entryFee')
    expect(patch).not.toHaveProperty('entryFeeMode')
  })
})

describe('cambio de valor real', () => {
  test('un bono que sube: el costo se queda y la diferencia ES la ganancia', () => {
    const { patch, income } = planCellEdit({ item: BONO, oldValue: 6200, newValue: 6400, answer: ANSWER_RETURN })
    expect(income).toBe(null)
    expect(patch).not.toHaveProperty('purchasePrice')
    expect(gainOf(apply(BONO, patch))).toBeCloseTo(400, 6)
  })

  test('una cuenta liquida que sube registra un ingreso REAL', () => {
    const { patch, income } = planCellEdit({ item: BANCO, oldValue: 1000, newValue: 1050, answer: ANSWER_RETURN })
    expect(income).toEqual({ type: 'DIVIDEND', amount: 50, currency: 'GTQ', source: 'manual_yield', reinvested: true })
    // Y el costo SIGUE al saldo: sin eso los 50 se contarian dos veces, una
    // como ganancia no realizada y otra como ingreso.
    expect(gainOf(apply(BANCO, patch), income.amount)).toBeCloseTo(50, 6)
  })

  test('sin que el costo siga al saldo, ese ingreso se contaria dos veces', () => {
    // Regresion negativa: fija por que la rama de cuenta liquida escribe los DOS
    // campos en vez de solo el valor.
    const soloValor = apply(BANCO, { currentPrice: 1050 })
    expect(gainOf(soloValor, 50)).toBe(100)
  })

  test('una cuenta liquida que BAJA no inventa un ingreso negativo', () => {
    const { patch, income } = planCellEdit({ item: BANCO, oldValue: 1000, newValue: 900, answer: ANSWER_RETURN })
    expect(income).toBe(null)
    expect(patch).not.toHaveProperty('purchasePrice')
    expect(gainOf(apply(BANCO, patch))).toBeCloseTo(-100, 6)
  })
})
