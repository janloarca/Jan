/**
 * FASE IX6. El ingreso REINVERTIDO se guardaba en un cajon indexado por SIMBOLO,
 * y un simbolo no identifica una cuenta: dos cuentas con el mismo nombre y sin
 * ticker propio (el caso real del usuario: DOS "ClubCashIn") caian en el mismo
 * cajon y cada una rebobinaba el rendimiento de AMBAS.
 *
 * La prueba en los datos reales: la primera cuenta subia ~$5.89 al mes y paso a
 * ~$13 exactamente el mes en que aparecio la segunda, que tambien sube ~$13. Si
 * cada una ganara lo suyo serian ~$6 y ~$7.4; $13 es justo la suma.
 *
 * Misma leccion que FASE IO: un mapa indexado por simbolo no puede guardar nada
 * que dependa del ACTIVO.
 */
// historicalValues arrastra authFetch (y con el firebase), que no inicializa
// bajo jest. Mismo stub que usan los otros tests de este modulo.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))
const { indexBalanceEvents } = require('../historicalValues')

// Dos cuentas homonimas, sin ticker propio, cada una con su rendimiento
// reinvertido. Es exactamente la forma del caso real.
const items = [
  { id: 'cci-1', name: 'ClubCashIn', symbol: '', type: 'Bond', currency: 'USD', dividendAction: 'reinvest' },
  { id: 'cci-2', name: 'ClubCashIn', symbol: '', type: 'Bond', currency: 'USD', dividendAction: 'reinvest' },
]

const tx = (id, itemId, date, amount) => ({
  id, type: 'DIVIDEND', date, totalAmount: amount, currency: 'USD',
  symbol: 'ClubCashIn', _linkedItemId: itemId, _reinvested: true, _source: 'inferred_yield',
})

describe('rendimiento reinvertido por CUENTA, no por simbolo (FASE IX6)', () => {
  const transactions = [
    tx('a1', 'cci-1', '2026-06-01', 5.94),
    tx('a2', 'cci-1', '2026-07-01', 6.00),
    tx('b1', 'cci-2', '2026-07-01', 7.40),
  ]

  it('cada cuenta recibe SOLO sus propios eventos', () => {
    const { reinvestById } = indexBalanceEvents(transactions, items, null, 'USD')
    expect(reinvestById['cci-1']).toHaveLength(2)
    expect(reinvestById['cci-2']).toHaveLength(1)
    expect(reinvestById['cci-1'].reduce((s, e) => s + e.amount, 0)).toBeCloseTo(11.94, 2)
    expect(reinvestById['cci-2'].reduce((s, e) => s + e.amount, 0)).toBeCloseTo(7.40, 2)
  })

  it('el cajon por simbolo ya no acumula lo que tiene dueno', () => {
    const { reinvestBySym } = indexBalanceEvents(transactions, items, null, 'USD')
    // Antes: CLUBCASHIN con los TRES eventos, o sea cada cuenta rebobinaba
    // $19.34 en vez de lo suyo. Fijado como regresion negativa explicita.
    expect(reinvestBySym['CLUBCASHIN']).toBeUndefined()
  })

  it('un movimiento SIN vinculo a un item sigue cayendo al cajon por simbolo', () => {
    const orphan = [{
      id: 'o1', type: 'DIVIDEND', date: '2026-06-01', totalAmount: 3, currency: 'USD',
      symbol: 'ClubCashIn', _reinvested: true,
    }]
    const { reinvestById, reinvestBySym } = indexBalanceEvents(orphan, items, null, 'USD')
    expect(Object.keys(reinvestById)).toHaveLength(0)
    expect(reinvestBySym['CLUBCASHIN']).toHaveLength(1)
  })

  it('un vinculo a un item que ya no existe no se pierde: cae al simbolo', () => {
    const dangling = [tx('d1', 'borrado', '2026-06-01', 4)]
    const { reinvestById, reinvestBySym } = indexBalanceEvents(dangling, items, null, 'USD')
    expect(Object.keys(reinvestById)).toHaveLength(0)
    expect(reinvestBySym['CLUBCASHIN']).toHaveLength(1)
  })

  it('un cupon a OTRA cuenta sigue yendo al saldo del destino, sin tocar esto', () => {
    const cash = [{
      id: 'c1', type: 'DIVIDEND', date: '2026-06-01', totalAmount: 240, currency: 'USD',
      symbol: 'VITALI', _linkedItemId: 'bond', _destinationItemId: 'cci-1',
    }]
    const withBond = [...items, { id: 'bond', name: 'VITALI', symbol: 'VITALI', type: 'Bond', currency: 'USD' }]
    const { reinvestById, balanceEventsById } = indexBalanceEvents(cash, withBond, null, 'USD')
    expect(Object.keys(reinvestById)).toHaveLength(0)
    expect(balanceEventsById['cci-1']).toHaveLength(1)
    expect(balanceEventsById['cci-1'][0].amount).toBeCloseTo(240, 2)
  })
})
