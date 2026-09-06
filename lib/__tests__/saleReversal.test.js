// FASE OD. Deshacer una venta al borrar su fila: el plan es puro y REHUSA
// antes que adivinar. Cada rehuse tiene su razon porque cada uno se arregla
// distinto.
const { saleReversalPlan, saleReversalLines, saleRefusalText, saleCompanionIds } = require('../saleReversal')

const aapl = (o = {}) => ({ id: 'aapl', name: 'Apple', symbol: 'AAPL', type: 'Stock', quantity: 8, currentPrice: 200, purchasePrice: 100, currency: 'USD', ...o })
const bank = (o = {}) => ({ id: 'bank', name: 'Cuenta USD', symbol: 'BANCO', type: 'Bank', quantity: 1, currentPrice: 1400, purchasePrice: 1400, currency: 'USD', ...o })
const sell = (o = {}) => ({
  id: 'sell1', type: 'SELL', symbol: 'AAPL', date: '2026-08-01', createdAt: '2026-08-01T10:00:00Z', totalAmount: 400, quantity: 2, pricePerUnit: 200, currency: 'USD',
  _linkedItemId: 'aapl', _destinationItemId: 'bank', _saleId: 'n1', _txNonce: 'n1',
  _sale: { qty: 2, soldFully: false, prevItemFields: { quantity: 10, currentPrice: 200, purchasePrice: 100 }, destId: 'bank', destKind: 'bank', destAmount: 400, destCurrency: 'USD', destAddQty: 0 },
  _lotCloses: [{ lotId: 'l1', closable: 2, whole: false, closedId: 'l1-closed-2026-08-01-1000000000' }],
  ...o,
})
const lots = () => [
  { id: 'l1', symbol: 'AAPL', quantity: 8, costBasis: 100, status: 'open' },
  { id: 'l1-closed-2026-08-01-1000000000', symbol: 'AAPL', quantity: 2, costBasis: 100, status: 'closed', closedDate: '2026-08-01' },
]

describe('saleReversalPlan', () => {
  it('no es una venta: null', () => {
    expect(saleReversalPlan({ type: 'DEPOSIT' }, [], [], [])).toBeNull()
  })
  it('venta parcial a un banco: devuelve la cantidad, reabre el lote (borra el cerrado) y quita el dinero del destino', () => {
    const plan = saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell()])
    expect(plan.refused).toBeNull()
    expect(plan.item).toMatchObject({ id: 'aapl', fields: { quantity: 10 }, qty: 2, soldFully: false })
    expect(plan.item.fields.currentPrice).toBeUndefined()
    expect(plan.lots).toEqual([{ id: 'l1', fields: { quantity: 10 } }])
    expect(plan.deleteLotIds).toEqual(['l1-closed-2026-08-01-1000000000'])
    expect(plan.dest).toMatchObject({ id: 'bank', fields: { currentPrice: 1000, purchasePrice: 1000 }, amount: 400, currency: 'USD' })
  })
  it('el destino se ajusta por DELTA contra el saldo de HOY, no restaurando el de la venta', () => {
    // Recibio 400 de la venta y despues un cupon de 100: debe quedar en 1100, no en 1000.
    const plan = saleReversalPlan(sell(), [aapl(), bank({ currentPrice: 1500, purchasePrice: 1500 })], lots(), [sell()])
    expect(plan.dest.fields).toEqual({ currentPrice: 1100, purchasePrice: 1100 })
  })
  it('venta TOTAL: restaura los precios que la venta puso en cero y apaga soldFully/saleDate', () => {
    const tx = sell({ _sale: { ...sell()._sale, qty: 10, soldFully: true }, _lotCloses: [{ lotId: 'l1', closable: 10, whole: true }] })
    const sold = aapl({ quantity: 0, currentPrice: 0, purchasePrice: 0, soldFully: true, saleDate: '2026-08-01', salePrice: 200 })
    const plan = saleReversalPlan(tx, [sold, bank()], [{ id: 'l1', symbol: 'AAPL', quantity: 10, status: 'closed', closedDate: '2026-08-01' }], [tx])
    expect(plan.refused).toBeNull()
    expect(plan.item.fields).toEqual({ quantity: 10, currentPrice: 200, purchasePrice: 100, saleDate: null, salePrice: null, soldFully: null })
    expect(plan.lots).toEqual([{ id: 'l1', fields: { status: 'open', closedDate: null, closedPrice: null, realizedGain: null } }])
    expect(plan.deleteLotIds).toEqual([])
  })
  it('destino de MERCADO: le resta las unidades que le sumo y borra el lote que le creo', () => {
    const btc = { id: 'btc', name: 'Bitcoin', symbol: 'BTC', type: 'Crypto', quantity: 0.104, currentPrice: 100000, currency: 'USD' }
    const tx = sell({ _sale: { ...sell()._sale, destId: 'btc', destKind: 'market', destAddQty: 0.004 }, _destLotId: 'BTC-2026-08-01-400000-10000000' })
    const plan = saleReversalPlan(tx, [aapl(), btc], [...lots(), { id: 'BTC-2026-08-01-400000-10000000', symbol: 'BTC', quantity: 0.004, status: 'open' }], [tx])
    expect(plan.dest).toMatchObject({ id: 'btc', kind: 'market', fields: { quantity: 0.1 } })
    expect(plan.deleteLotIds).toEqual(['l1-closed-2026-08-01-1000000000', 'BTC-2026-08-01-400000-10000000'])
  })
  it('una fila SIN marcas (anterior a esta version) se rehusa como "unmarked" y la confirmacion lo DICE', () => {
    const tx = sell({ _sale: undefined, _lotCloses: undefined })
    const plan = saleReversalPlan(tx, [aapl(), bank()], lots(), [tx])
    expect(plan.refused).toBe('unmarked')
    expect(saleReversalLines(plan, 'es')[0]).toMatch(/Solo quita el registro/)
    expect(saleReversalLines(plan, 'en')[0]).toMatch(/Only removes the record/)
  })
  it('un movimiento POSTERIOR del mismo activo rehusa (later-activity), y su compañero de venta no cuenta', () => {
    const later = { id: 'sell2', type: 'SELL', date: '2026-08-05', _linkedItemId: 'aapl', totalAmount: 200 }
    expect(saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell(), later]).refused).toBe('later-activity')
    // Mismo dia, creado despues: tambien cuenta.
    const sameDay = { id: 'dep', type: 'DEPOSIT', date: '2026-08-01', createdAt: '2026-08-01T12:00:00Z', _linkedItemId: 'aapl', totalAmount: 50 }
    expect(saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell(), sameDay]).refused).toBe('later-activity')
    // El retiro compañero (mismo _saleId) NO es actividad posterior.
    const companion = { id: 'w1', type: 'WITHDRAWAL', date: '2026-08-01', createdAt: '2026-08-01T10:00:00.005Z', _linkedItemId: 'aapl', _saleId: 'n1', totalAmount: 400 }
    const plan = saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell(), companion])
    expect(plan.refused).toBeNull()
    expect(plan.companions).toEqual(['w1'])
    expect(saleReversalLines(plan, 'es').some((l) => /retiro asociado/.test(l))).toBe(true)
    // Un dividendo posterior NO bloquea: no cambia la cantidad.
    const div = { id: 'd1', type: 'DIVIDEND', date: '2026-08-10', _linkedItemId: 'aapl', totalAmount: 5 }
    expect(saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell(), div]).refused).toBeNull()
  })
  it('un lote que la venta cerro y ya no existe rehusa (lot-missing)', () => {
    expect(saleReversalPlan(sell(), [aapl(), bank()], [lots()[0]], [sell()]).refused).toBe('lot-missing')
    expect(saleReversalPlan(sell(), [aapl(), bank()], [], [sell()]).refused).toBe('lot-missing')
  })
  it('el destino que ya gasto el dinero rehusa (dest-cannot): nunca se recorta a cero en silencio', () => {
    const plan = saleReversalPlan(sell(), [aapl(), bank({ currentPrice: 300, purchasePrice: 300 })], lots(), [sell()])
    expect(plan.refused).toBe('dest-cannot')
    expect(saleRefusalText('dest-cannot', 'es')).toMatch(/Ajusta su saldo/)
  })
  it('el destino borrado no bloquea: se restaura la posicion y se dice', () => {
    const plan = saleReversalPlan(sell(), [aapl()], lots(), [sell()])
    expect(plan.refused).toBeNull()
    expect(plan.dest).toBeNull()
    expect(plan.destMissing).toBe(true)
    expect(saleReversalLines(plan, 'es').some((l) => /ya no existe/.test(l))).toBe(true)
  })
  it('el activo vendido borrado: item-missing, y se borra a secas con aviso', () => {
    const plan = saleReversalPlan(sell(), [bank()], lots(), [sell()])
    expect(plan.refused).toBe('item-missing')
    expect(saleReversalLines(plan, 'es')[0]).toMatch(/Solo quita el registro/)
  })
  it('las lineas de un plan sano nombran unidades, lotes y dinero', () => {
    const lines = saleReversalLines(saleReversalPlan(sell(), [aapl(), bank()], lots(), [sell()]), 'es', (a, c) => `${c} ${a}`)
    expect(lines).toEqual(['Devuelve 2 unidades a Apple y reabre 1 lote', 'Quita USD 400 de Cuenta USD'])
  })
  it('saleCompanionIds solo empareja por _saleId', () => {
    expect(saleCompanionIds(sell(), [sell(), { id: 'w1', _saleId: 'n1' }, { id: 'x', _saleId: 'other' }])).toEqual(['w1'])
    expect(saleCompanionIds(sell({ _saleId: undefined }), [{ id: 'w1', _saleId: 'n1' }])).toEqual([])
  })
})
