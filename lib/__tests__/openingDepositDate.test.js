import { openingDepositForItem, openingDepositDateFix } from '../originDeposits'

// El deposito de apertura se fecha AL CREAR con la fecha de adquisicion, y
// editar despues esa fecha actualizaba solo el item. El rebobinado del
// Spreadsheet usa la fecha del DEPOSITO, asi que los meses anteriores quedaban
// en 0.00 para siempre. ⛔ Extension de la logica congelada G: se mueve la
// FECHA, nunca el monto.
const item = { id: 'bond-1', currency: 'USD' }
const opening = {
  id: 'tx-open', type: 'DEPOSIT', _source: 'manual_new_account',
  _linkedItemId: 'bond-1', date: '2026-08-20', totalAmount: 6098,
}

describe('openingDepositForItem', () => {
  test('encuentra el unico deposito de apertura de la cuenta', () => {
    expect(openingDepositForItem([opening], item)).toBe(opening)
  })

  test('un aporte posterior no es el deposito de apertura', () => {
    const later = { id: 'tx-2', type: 'DEPOSIT', _source: 'manual_contribution', _linkedItemId: 'bond-1', date: '2026-09-01' }
    expect(openingDepositForItem([opening, later], item)).toBe(opening)
  })

  test('con DOS candidatos no se toca ninguno: cual es "el de apertura" seria adivinar', () => {
    const dup = { ...opening, id: 'tx-open-2' }
    expect(openingDepositForItem([opening, dup], item)).toBeNull()
  })

  test('el deposito de OTRA cuenta no cuenta', () => {
    const other = { ...opening, id: 'tx-x', _linkedItemId: 'bond-2' }
    expect(openingDepositForItem([other], item)).toBeNull()
  })

  test('sin transacciones, sin item o sin id devuelve null', () => {
    expect(openingDepositForItem([], item)).toBeNull()
    expect(openingDepositForItem(null, item)).toBeNull()
    expect(openingDepositForItem([opening], null)).toBeNull()
    expect(openingDepositForItem([opening], { currency: 'USD' })).toBeNull()
  })
})

describe('openingDepositDateFix', () => {
  test('el caso del reporte: la fecha corregida se lleva su deposito', () => {
    expect(openingDepositDateFix([opening], item, '2026-01-15')).toEqual({ id: 'tx-open', date: '2026-01-15' })
  })

  test('sin cambio de fecha no escribe nada', () => {
    expect(openingDepositDateFix([opening], item, '2026-08-20')).toBeNull()
  })

  test('sin fecha nueva no escribe nada', () => {
    expect(openingDepositDateFix([opening], item, '')).toBeNull()
    expect(openingDepositDateFix([opening], item, null)).toBeNull()
  })

  test('el monto NUNCA viaja en la correccion: solo id y fecha', () => {
    const fix = openingDepositDateFix([opening], item, '2026-01-15')
    expect(Object.keys(fix).sort()).toEqual(['date', 'id'])
  })
})
