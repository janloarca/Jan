const { isScopedView, transactionsForItems } = require('../portfolioScope')

describe('isScopedView', () => {
  test('todo + todo no es vista escopada', () => {
    expect(isScopedView({ activePortfolio: '__all__', activeEntity: '__all__' })).toBe(false)
    expect(isScopedView({})).toBe(false)
  })
  test('un portafolio o una entidad seleccionados sí', () => {
    expect(isScopedView({ activePortfolio: 'pA', activeEntity: '__all__' })).toBe(true)
    expect(isScopedView({ activePortfolio: '__all__', activeEntity: 'e1' })).toBe(true)
  })
})

describe('transactionsForItems', () => {
  const a = { id: 'a1', symbol: 'BANKA', portfolioId: 'pA' }
  const b = { id: 'b1', symbol: 'BANKB', portfolioId: 'pB' }
  const ibkr = { id: 'i1', symbol: 'AAPL', _source: 'ibkr', portfolioId: 'pA' }
  const all = [a, b, ibkr]

  test('un vínculo vivo decide solo, en las dos direcciones', () => {
    const txs = [
      { id: 't1', type: 'DEPOSIT', _linkedItemId: 'a1', symbol: 'BANKA' },
      { id: 't2', type: 'DEPOSIT', _linkedItemId: 'b1', symbol: 'BANKA' }, // símbolo miente, vínculo manda
    ]
    expect(transactionsForItems(txs, [a], all).map((t) => t.id)).toEqual(['t1'])
  })

  test('una transferencia entra al scope de CUALQUIERA de sus dos extremos', () => {
    const tr = { id: 'tr', type: 'TRANSFER', _originItemId: 'a1', _linkedItemId: 'b1' }
    expect(transactionsForItems([tr], [a], all)).toHaveLength(1)
    expect(transactionsForItems([tr], [b], all)).toHaveLength(1)
  })

  test('un vínculo MUERTO cae al símbolo', () => {
    const tx = { id: 't', type: 'DEPOSIT', _linkedItemId: 'gone', symbol: 'BANKA' }
    expect(transactionsForItems([tx], [a], all)).toHaveLength(1)
    expect(transactionsForItems([tx], [b], all)).toHaveLength(0)
  })

  test('los flujos de cuenta del broker viajan con los ítems de IBKR y con nadie más', () => {
    const flow = { id: 'f', type: 'DEPOSIT', _source: 'ibkr', symbol: 'CASH' }
    expect(transactionsForItems([flow], [ibkr], all)).toHaveLength(1)
    expect(transactionsForItems([flow], [a], all)).toHaveLength(0)
    const inferred = { id: 'g', type: 'DEPOSIT', _source: 'inferred_flow', symbol: 'CASH' }
    expect(transactionsForItems([inferred], [ibkr], all)).toHaveLength(1)
  })

  test('sin vínculo manda el símbolo', () => {
    const tx = { id: 't', type: 'DIVIDEND', symbol: 'bankb' }
    expect(transactionsForItems([tx], [b], all)).toHaveLength(1)
    expect(transactionsForItems([tx], [a], all)).toHaveLength(0)
  })

  test('con todos los ítems en el scope no se pierde nada vinculado', () => {
    const txs = [
      { id: 't1', _linkedItemId: 'a1' }, { id: 't2', _linkedItemId: 'b1' },
      { id: 't3', _source: 'ibkr', symbol: 'CASH' }, { id: 't4', symbol: 'AAPL' },
    ]
    expect(transactionsForItems(txs, all, all)).toHaveLength(4)
  })
})
