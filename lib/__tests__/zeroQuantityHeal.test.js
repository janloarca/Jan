import { zeroQuantityBalanceFixes } from '../zeroQuantityHeal'
import { getItemValue } from '@/components/dashboard/utils'

// El caso REAL del usuario (28 ago 2026): su fondo líquido en quetzales quedó en
// cantidad 0 al vaciarlo, después le entró el cupón de XOCHI (+GTQ 600), y la
// Hoja siguió marcando 0.00 aunque el movimiento estaba archivado y visible en
// el historial de esa cuenta.
//
// El arreglo del camino del cupón (lib/autoDividends.js) impide que vuelva a
// pasar; esto sana lo que YA quedó escrito así, que si no es irreparable desde
// la UI: el editor de cuenta muestra el saldo bien (su pie cae a cantidad 1)
// pero al guardar reescribe la cantidad tal cual, así que abrir y guardar no
// arregla nada.
const cuentaVaciadaConCupon = {
  id: 'fondoQ',
  name: 'FONDO LÍQUIDO Q',
  type: 'Cuenta bancaria',
  currency: 'GTQ',
  quantity: 0,
  purchasePrice: 600,
  currentPrice: 600,
}

describe('zeroQuantityBalanceFixes', () => {
  it('marca la cuenta de saldo cuya cantidad quedó en cero con saldo vivo', () => {
    expect(zeroQuantityBalanceFixes([cuentaVaciadaConCupon])).toEqual(['fondoQ'])
  })

  it('el síntoma que sana: hoy vale CERO, con la cantidad en 1 vale su saldo', () => {
    // Esto es lo que veía el usuario, medido con la MISMA función que usan el
    // patrimonio, la Hoja y los reportes.
    expect(getItemValue(cuentaVaciadaConCupon)).toBe(0)
    expect(getItemValue({ ...cuentaVaciadaConCupon, quantity: 1 })).toBeCloseTo(600, 2)
  })

  it('una cuenta sana no se toca', () => {
    const sana = { ...cuentaVaciadaConCupon, quantity: 1 }
    expect(zeroQuantityBalanceFixes([sana])).toEqual([])
  })

  it('una cuenta de VERDAD vacía no se toca: sin saldo no hay nada que sanar', () => {
    // Vaciar un ítem de banco pone cantidad Y precio en cero (transferFields),
    // así que este es el estado normal de una cuenta vaciada y sanarla
    // resucitaría un saldo que no existe.
    const vacia = { ...cuentaVaciadaConCupon, quantity: 0, purchasePrice: 0, currentPrice: 0 }
    expect(zeroQuantityBalanceFixes([vacia])).toEqual([])
  })

  // ⛔ El alcance `isBankLike` es lo que hace segura la regla, no una precaución
  // de más: en un ítem que NO es de banco, vaciar deja el precio VIVO, así que
  // "cantidad 0 con precio > 0" describe una posición legítimamente vacía.
  it('un activo de MERCADO en cero es una posición vendida, jamás se sana', () => {
    const vendida = { id: 'aapl', symbol: 'AAPL', type: 'Stock', quantity: 0, currentPrice: 232.5 }
    expect(zeroQuantityBalanceFixes([vendida])).toEqual([])
  })

  it('un bono en cero tampoco: su precio sobrevive al vaciarse', () => {
    const bono = { id: 'b1', name: 'RV4', type: 'Bono', quantity: 0, currentPrice: 6000 }
    expect(zeroQuantityBalanceFixes([bono])).toEqual([])
  })

  it('una cuenta marcada como vendida se respeta aunque cumpla la forma', () => {
    expect(zeroQuantityBalanceFixes([{ ...cuentaVaciadaConCupon, soldFully: true }])).toEqual([])
    expect(zeroQuantityBalanceFixes([{ ...cuentaVaciadaConCupon, saleDate: '2026-08-01' }])).toEqual([])
  })

  it('una cantidad ausente cuenta igual que cero (FASE JD3: esas cuentas existen)', () => {
    const sinCantidad = { ...cuentaVaciadaConCupon }
    delete sinCantidad.quantity
    expect(zeroQuantityBalanceFixes([sinCantidad])).toEqual(['fondoQ'])
  })

  it('tolera basura sin reventar y no inventa ids', () => {
    expect(zeroQuantityBalanceFixes(null)).toEqual([])
    expect(zeroQuantityBalanceFixes([null, undefined, {}, { quantity: 0, currentPrice: 5 }])).toEqual([])
  })

  it('devuelve cada cuenta afectada una sola vez, en orden', () => {
    const otra = { ...cuentaVaciadaConCupon, id: 'fondoUSD', name: 'Cuenta Monetaria', currency: 'USD' }
    expect(zeroQuantityBalanceFixes([cuentaVaciadaConCupon, otra])).toEqual(['fondoQ', 'fondoUSD'])
  })
})
