// FASE OD. Las filas de una venta salen de UN constructor: con nonce (dos
// ventas iguales el mismo dia no colapsan en un doc) y con las marcas que
// permiten deshacerla al borrarla.
const { buildSaleTransactions } = require('../saleTx')

const item = { id: 'aapl', name: 'Apple', symbol: 'AAPL', quantity: 10 }
const base = { item, qtySell: 2, price: 200, proceeds: 400, saleDate: '2026-08-01', currency: 'USD',
  soldFully: false, prevItemFields: { quantity: 10, currentPrice: 200, purchasePrice: 100 } }

describe('buildSaleTransactions', () => {
  it('dos ventas iguales llevan nonces DISTINTOS, asi que no comparten id de documento', () => {
    const a = buildSaleTransactions(base).transactions[0]
    const b = buildSaleTransactions(base).transactions[0]
    expect(a._txNonce).toBeTruthy()
    expect(a._txNonce).not.toBe(b._txNonce)
    // La regla de txDocId (hooks/useFirestoreItems.js): con nonce el id lo lleva.
    const docId = (t) => `${t.date}-${t.symbol}-${t.type}-${Math.round(t.totalAmount * 100)}${t._txNonce ? `-${t._txNonce}` : ''}`
    expect(docId(a)).not.toBe(docId(b))
  })
  it('la venta y su retiro compañero comparten _saleId (solo con __exit__)', () => {
    const exit = buildSaleTransactions({ ...base, destination: '__exit__' }).transactions
    expect(exit.map((t) => t.type)).toEqual(['SELL', 'WITHDRAWAL'])
    expect(exit[1]._saleId).toBe(exit[0]._saleId)
    expect(exit[1]._txNonce).toBe(exit[0]._txNonce)
    const stay = buildSaleTransactions({ ...base, destination: '__stay__', dest: { id: 'bank', currency: 'USD' }, destAmount: 400, destKind: 'bank' }).transactions
    expect(stay.map((t) => t.type)).toEqual(['SELL'])
    expect(stay[0]._destinationItemId).toBe('bank')
  })
  it('las marcas guardan lo que hace falta para revertir EXACTO', () => {
    const [sell] = buildSaleTransactions({ ...base, soldFully: true, destination: '__stay__',
      dest: { id: 'gtq', currency: 'GTQ' }, destAmount: 3080, destKind: 'bank' }).transactions
    expect(sell._sale).toEqual({
      qty: 2, soldFully: true,
      prevItemFields: { quantity: 10, currentPrice: 200, purchasePrice: 100 },
      destId: 'gtq', destKind: 'bank', destAmount: 3080, destCurrency: 'GTQ', destAddQty: 0,
    })
    expect(sell.quantity).toBe(2)
    expect(sell.pricePerUnit).toBe(200)
    expect(sell._linkedItemId).toBe('aapl')
  })
  it('un destino de mercado guarda las unidades que se le sumaron', () => {
    const [sell] = buildSaleTransactions({ ...base, destination: '__stay__', dest: { id: 'btc', currency: 'USD' }, destAmount: 400, destKind: 'market', destAddQty: 0.004 }).transactions
    expect(sell._sale.destKind).toBe('market')
    expect(sell._sale.destAddQty).toBe(0.004)
  })
})
