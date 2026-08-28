import { balanceDiagnostic, balanceDiagnosticText } from '../balanceDiagnostic'
import { balanceQuantityPatch } from '../contributions'
import { planCellEdit } from '../spreadsheetEdit'
import { getItemValue } from '@/components/dashboard/utils'

const banco = (extra) => ({ id: 'x', name: 'FONDO LÍQUIDO $', type: 'Cuenta bancaria', institution: 'IDC', currency: 'USD', ...extra })

describe('balanceQuantityPatch', () => {
  it('normaliza una cantidad inservible para que el saldo se pueda leer', () => {
    expect(balanceQuantityPatch({ quantity: 0 }, 962)).toEqual({ quantity: 1 })
    expect(balanceQuantityPatch({}, 962)).toEqual({ quantity: 1 })
    expect(balanceQuantityPatch({ quantity: -3 }, 962)).toEqual({ quantity: 1 })
    expect(balanceQuantityPatch({ quantity: 'x' }, 962)).toEqual({ quantity: 1 })
  })

  // ⛔ Una cantidad legítima distinta de 1 se deja INTACTA: normalizarla le
  // cambiaría el valor al ítem sin que se moviera un centavo.
  it('una cantidad legitima no se toca', () => {
    expect(balanceQuantityPatch({ quantity: 1 }, 962)).toEqual({})
    expect(balanceQuantityPatch({ quantity: 2 }, 962)).toEqual({})
    expect(balanceQuantityPatch({ quantity: 0.5 }, 962)).toEqual({})
  })

  it('un saldo que queda en cero apaga la cantidad, pase lo que pase', () => {
    expect(balanceQuantityPatch({ quantity: 1 }, 0)).toEqual({ quantity: 0 })
    expect(balanceQuantityPatch({ quantity: 5 }, 0)).toEqual({ quantity: 0 })
    expect(balanceQuantityPatch({ quantity: 0 }, -5)).toEqual({ quantity: 0 })
  })
})

// El sintoma que el usuario reporto TRES veces: teclear un valor y que la celda
// siga mostrando otro. Solo la rama de FLUJO estaba arreglada; estas tres no.
describe('planCellEdit escribe la cantidad en TODAS sus ramas', () => {
  const roto = banco({ quantity: 0, currentPrice: 240, purchasePrice: 240 })

  it('el sintoma de partida: la cuenta vale 0 aunque el precio diga 240', () => {
    expect(getItemValue(roto)).toBe(0)
  })

  it('correccion ("el numero anterior estaba mal")', () => {
    const { patch } = planCellEdit({ item: roto, oldValue: 0, newValue: 962, answer: 'correction' })
    expect(getItemValue({ ...roto, ...patch })).toBeCloseTo(962, 2)
  })

  it('devengo (una cuenta liquida que subio)', () => {
    const conTasa = banco({ quantity: 0, currentPrice: 240, purchasePrice: 240, incomeRate: 5 })
    const { patch } = planCellEdit({ item: conTasa, oldValue: 240, newValue: 962, answer: 'value' })
    expect(getItemValue({ ...conTasa, ...patch })).toBeCloseTo(962, 2)
  })

  it('revaluacion (todo lo demas)', () => {
    const bono = { id: 'b', name: 'RV4', type: 'Cuenta bancaria', quantity: 0, currentPrice: 240 }
    const { patch } = planCellEdit({ item: bono, oldValue: 240, newValue: 962, answer: 'value' })
    expect(getItemValue({ ...bono, ...patch })).toBeCloseTo(962, 2)
  })

  it('flujo ("meti dinero"), que ya estaba', () => {
    const { patch } = planCellEdit({ item: roto, oldValue: 240, newValue: 540, answer: 'flow' })
    expect(getItemValue({ ...roto, ...patch })).toBeCloseTo(540, 2)
  })

  // Teclear CERO significa cero: la cantidad se apaga para que un residuo en
  // price/cost no lo resucite.
  it('teclear cero deja la cuenta en cero, sin resucitar por un residuo', () => {
    const conResiduo = banco({ quantity: 1, currentPrice: 240, purchasePrice: 240, cost: 240 })
    const { patch } = planCellEdit({ item: conResiduo, oldValue: 240, newValue: 0, answer: 'correction' })
    expect(getItemValue({ ...conResiduo, ...patch })).toBe(0)
  })

  // ⛔ Un activo por CANTIDAD no entra: ahi el precio es POR UNIDAD y la
  // cantidad es un dato real (cantidad 0 es una posicion vendida).
  it('un activo de mercado NO recibe cantidad inventada', () => {
    const accion = { id: 'a', symbol: 'AAPL', type: 'Stock', quantity: 0, currentPrice: 232 }
    const { patch } = planCellEdit({ item: accion, oldValue: 0, newValue: 1000, answer: 'value' })
    expect(patch.quantity).toBeUndefined()
  })
})

describe('balanceDiagnostic', () => {
  it('nombra la cuenta cuyo saldo escrito se lee como cero', () => {
    const rows = balanceDiagnostic([banco({ quantity: 0, currentPrice: 240, purchasePrice: 240 })])
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toBe(0)
    expect(rows[0].verdict.code).toBe('qty-cero')
  })

  it('nombra la cuenta cuyo saldo resucita por un residuo', () => {
    const rows = balanceDiagnostic([banco({ quantity: 1, currentPrice: 0, purchasePrice: 0, cost: 240 })])
    expect(rows[0].value).toBeCloseTo(240, 2)
    expect(rows[0].verdict.code).toBe('resucitado')
  })

  it('nombra la cuenta cuya cantidad no es 1 (los precios NO son el saldo)', () => {
    const rows = balanceDiagnostic([banco({ quantity: 2, currentPrice: 500, purchasePrice: 500 })])
    expect(rows[0].verdict.code).toBe('qty-no-1')
  })

  it('una cuenta sana no lleva veredicto', () => {
    const rows = balanceDiagnostic([banco({ quantity: 1, currentPrice: 240, purchasePrice: 240 })])
    expect(rows[0].verdict).toBeNull()
    expect(rows[0].value).toBeCloseTo(240, 2)
  })

  it('expone los campos de respaldo, que son los que resucitan un saldo', () => {
    const rows = balanceDiagnostic([banco({ quantity: 1, currentPrice: 0, purchasePrice: 0, price: 7, cost: 240 })])
    expect(rows[0].fields).toMatchObject({ quantity: 1, currentPrice: 0, purchasePrice: 0, price: 7, cost: 240 })
  })

  it('solo cuentas de SALDO: un activo por cantidad usa otro vocabulario', () => {
    const rows = balanceDiagnostic([{ id: 'a', symbol: 'AAPL', type: 'Stock', quantity: 5, currentPrice: 232 }])
    expect(rows).toEqual([])
  })

  it('tolera basura', () => {
    expect(balanceDiagnostic(null)).toEqual([])
    expect(balanceDiagnostic([null, {}, { type: 'Cuenta bancaria' }])).toEqual([])
  })
})

describe('balanceDiagnosticText', () => {
  const rows = balanceDiagnostic([banco({ quantity: 0, currentPrice: 240, purchasePrice: 240 })])

  it('lleva los campos, el valor leido y el build', () => {
    const txt = balanceDiagnosticText(rows, { build: 'abc123' })
    expect(txt).toContain('build: abc123')
    expect(txt).toContain('quantity=0')
    expect(txt).toContain('currentPrice=240')
    expect(txt).toContain('VALOR=0')
    expect(txt).toContain('⚠')
  })

  // El build separa "el arreglo no sirve" de "el arreglo no llego", que es la
  // ambiguedad que mas rondas costo en este repo.
  it('sin build no inventa uno', () => {
    expect(balanceDiagnosticText(rows)).not.toContain('build:')
  })
})
