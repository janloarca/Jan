// FASE OB. Cuatro defectos del motor de dividendos y del borrado con reversa,
// reproducidos por la auditoria de 8 usuarios y fijados aca con el hook REAL
// (arnes de FASE JB2, nunca una copia de la logica).
//
// Ojo del arnes: el `addTransaction` falso NO alimenta `transactions`, asi que
// el dedupe por mes del motor no ve lo que acaba de escribir y un re-run puede
// escribir dos veces la misma fecha. Por eso las aserciones de "que escribio"
// miran FECHAS UNICAS, y las de "no escribio" cuentan cero.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData
let fakeFirestore, fakePrices, fakeRates

function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return {
    items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null,
    loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: jest.fn(async () => {}), deleteItem: noop,
    deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop,
    deleteDemoData: noop,
    addTransaction: jest.fn(async () => {}), updateTransaction: jest.fn(async () => {}),
    deleteTransaction: jest.fn(async () => {}), deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop,
    lots: [], addLot: jest.fn(async () => {}), closeLotsFIFO: noop, transferFunds: noop,
    reverseTransfer: jest.fn(async () => {}),
    executeSaleAtomic: noop, executeContribution: noop, bulkImport: noop,
    bulkWriting: false, bulkWritingRef: { current: false }, deletionEpoch: 0,
    portfolios: [], addPortfolio: noop, deletePortfolio: noop,
    financeTransactions: [], addFinanceTransaction: noop, updateFinanceTransaction: noop,
    deleteFinanceTransaction: noop, deleteAllFinanceTransactions: noop,
    deleteFinanceTransactionsByIds: noop,
    saveGoals: noop, saveSettings: jest.fn(async () => {}), saveProfile: noop,
    incomePlan: null, saveIncomePlan: noop,
    saveItemSnapshots: noop, loadItemSnapshots: jest.fn(async () => ({})),
    ...over,
  }
}

const TODAY = '2026-09-05'
// MSFT tal como la GUARDA AddAccountModal con dividendo detectado: monto por
// accion, meses de Yahoo, sin `incomeMonthsExplicit`, sin `incomePayDay`.
const msft = (o = {}) => ({
  id: 'msft', name: 'Microsoft', symbol: 'MSFT', type: 'Stock',
  quantity: 100, purchasePrice: 380, currentPrice: 500, _originalPrice: 500,
  currency: 'USD', _originalCurrency: 'USD',
  acquisitionDate: '2024-01-15', createdAt: '2024-01-15',
  incomeAmount: 0.83, incomeMonths: [2, 5, 8, 11], incomeFrequency: 'quarterly',
  dividendYield: 0.66, dividendAction: 'cash', incomeDestination: 'bank1',
  ...o,
})
const bank = (o = {}) => ({
  id: 'bank1', name: 'Cuenta USD', symbol: 'BANCO-USD', type: 'Bank',
  quantity: 1, purchasePrice: 10000, currentPrice: 10000, _originalPrice: 10000,
  currency: 'USD', _originalCurrency: 'USD', acquisitionDate: '2024-01-01',
  createdAt: '2024-01-01', balanceAsOf: '2024-01-01', ...o,
})
const autoDiv = (id, date, extra = {}) => ({
  id, date, type: 'DIVIDEND', symbol: 'MSFT', totalAmount: 83, currency: 'USD',
  _source: 'auto', _linkedItemId: 'msft', description: 'Dividend from Microsoft', ...extra,
})

function setup(items, transactions = []) {
  fakeFirestore = makeFirestore({ items, transactions })
  fakePrices = { enrichedItems: items, prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null, refresh: jest.fn() }
  fakeRates = { rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0, loading: false, error: null, lastUpdate: null, refresh: jest.fn() }
  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({
    useBenchmark: () => ({ benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500', loading: false, error: null, refetch: jest.fn() }),
  }))
  jest.doMock('../useTabCoordination', () => ({
    useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }),
  }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async () => jsonResponse({})),
    safeJson: jest.fn(async () => ({})),
  }))
  ;({ useDashboardData } = require('../useDashboardData'))
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__' }
  return renderHook(() => useDashboardData(opts))
}

const settle = async () => { for (let i = 0; i < 25; i++) await act(async () => { await Promise.resolve() }) }
const writtenDates = () => [...new Set(fakeFirestore.addTransaction.mock.calls
  .map(([tx]) => tx).filter((tx) => tx.type === 'DIVIDEND').map((tx) => tx.date))].sort()
const deleted = () => fakeFirestore.deleteTransaction.mock.calls.map(([id]) => id)
const bankWrites = () => fakeFirestore.updateItem.mock.calls.filter(([id]) => id === 'bank1').map(([, patch]) => patch)

beforeEach(() => {
  jest.resetModules()
  pinReact()
  jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T15:00:00Z`))
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})
afterEach(() => jest.useRealTimers())

describe('FASE OB: la limpieza usa el calendario con el que el motor PAGA', () => {
  it('una accion con dividendo detectado (sin incomeMonthsExplicit) conserva sus cupones trimestrales', async () => {
    // Antes: explicitSchedule=false => "conservar solo el mas nuevo" => marzo
    // se borraba en CADA corrida y el banco se debitaba por un pago real.
    const txs = [autoDiv('t-mar', '2026-03-01', { _destinationCredited: true }),
                 autoDiv('t-jun', '2026-06-01', { _destinationCredited: true })]
    const { unmount } = setup([msft(), bank()], txs)
    await settle()
    expect(deleted()).toEqual([])
    // Y el pago del mes en curso (septiembre) sigue saliendo.
    expect(writtenDates()).toEqual(['2026-09-01'])
    unmount()
  })

  it('control: un pago automatico en un mes que el calendario NO paga sigue cayendo', async () => {
    const txs = [autoDiv('t-jul', '2026-07-01', { _destinationCredited: true })]
    const { unmount } = setup([msft(), bank()], txs)
    await settle()
    expect(deleted()).toEqual(['t-jul'])
    unmount()
  })
})

describe('FASE OB: un pago REINVERTIDO nunca se revierte del destino', () => {
  it('con el activo en reinvertir y el destino todavia puesto, la limpieza no debita el banco', async () => {
    // Un mes fuera del calendario, para que la limpieza SI tenga algo que borrar.
    const txs = [autoDiv('t-jul', '2026-07-01', { _reinvested: true })]
    const { unmount } = setup([msft({ dividendAction: 'reinvest' }), bank()], txs)
    await settle()
    expect(deleted()).toEqual(['t-jul'])
    // Antes: [{currentPrice: 9917, ...}] sobre una cuenta que nunca recibio ese dinero.
    expect(bankWrites().filter((p) => p.currentPrice < 10000)).toEqual([])
    unmount()
  })
})

describe('FASE OB: un activo vendido por completo deja de pagar', () => {
  it('sin pagos despues de saleDate', async () => {
    const sold = msft({ quantity: 0, currentPrice: 0, purchasePrice: 0, soldFully: true, saleDate: '2026-07-10', salePrice: 500, incomeMonthsExplicit: true, balanceAsOf: undefined })
    const { unmount } = setup([sold, bank()])
    await settle()
    // `balance` es 0 sobre cantidad 0, pero un monto FIJO por accion multiplica
    // por `qty || 1`: sin la compuerta se escribian cupones sobre un activo
    // que ya no existe.
    expect(writtenDates().filter((d) => d > '2026-07-10')).toEqual([])
    unmount()
  })
  it('control: el mismo activo sin venta si escribe el cupon de septiembre', async () => {
    const { unmount } = setup([msft({ incomeMonthsExplicit: true }), bank()])
    await settle()
    expect(writtenDates()).toContain('2026-09-01')
    unmount()
  })
})

describe('FASE OB: un override de mercado guardado con la forma vieja sigue pagando', () => {
  it('dividendYield + meses, sin incomeRate ni incomeAmount => el motor lo programa como tasa anual', async () => {
    const overridden = msft({ incomeAmount: 0, dividendYield: 0.7, incomeMonths: [2, 5, 8, 11] })
    delete overridden.incomeFrequency
    const { unmount } = setup([overridden, bank()])
    await settle()
    const sep = fakeFirestore.addTransaction.mock.calls.map(([tx]) => tx).find((tx) => tx.type === 'DIVIDEND' && tx.date === '2026-09-01')
    expect(sep).toBeTruthy()
    // 100 acciones x 500 = 50,000 x 0.7% / 4 pagos = 87.50
    expect(sep.totalAmount).toBeCloseTo(87.5, 2)
    unmount()
  })
})

describe('FASE OB: borrar con reversa', () => {
  const dep = { id: 'd1', type: 'DEPOSIT', date: '2026-04-01', symbol: 'BANCO-USD', totalAmount: 500, currency: 'USD', _linkedItemId: 'bank1', _source: 'manual_cashflow', _balanceMoved: true }

  it('un DEPOSIT que movio el saldo lo devuelve en el MISMO batch que borra la fila', async () => {
    const { result, unmount } = setup([bank()], [dep])
    await settle()
    await act(async () => { await result.current.deleteTransactionWithReversal('d1') })
    expect(fakeFirestore.reverseTransfer).toHaveBeenCalledTimes(1)
    const call = fakeFirestore.reverseTransfer.mock.calls[0][0]
    expect(call.fromId).toBe('bank1')
    expect(call.fromFields).toEqual({ currentPrice: 9500, purchasePrice: 9500 })
    expect(call.txId).toBe('d1')
    expect(fakeFirestore.deleteTransaction).not.toHaveBeenCalled()
    unmount()
  })

  it('regresion negativa: sin la marca se borra a secas, como antes (la fila no movio nada)', async () => {
    const { _balanceMoved, ...plain } = dep
    const { result, unmount } = setup([bank()], [plain])
    await settle()
    await act(async () => { await result.current.deleteTransactionWithReversal('d1') })
    expect(fakeFirestore.reverseTransfer).not.toHaveBeenCalled()
    expect(fakeFirestore.deleteTransaction).toHaveBeenCalledWith('d1')
    unmount()
  })

  it('una transferencia cuyo destino ya no tiene el saldo se REHUSA y lo dice', async () => {
    const empty = bank({ id: 'fondo', name: 'Fondo', symbol: 'FONDO', purchasePrice: 0, currentPrice: 0, _originalPrice: 0, quantity: 0 })
    const tr = { id: 'tr1', type: 'TRANSFER', date: '2026-03-01', symbol: 'BANCO-USD', totalAmount: 300, currency: 'USD', _originItemId: 'bank1', _linkedItemId: 'fondo', _toAmount: 300, _toCurrency: 'USD', _source: 'manual_transfer' }
    const { result, unmount } = setup([bank(), empty], [tr])
    await settle()
    let err = null
    await act(async () => { try { await result.current.deleteTransactionWithReversal('tr1') } catch (e) { err = e } })
    expect(err?.code).toBe('reversal-refused')
    expect(fakeFirestore.deleteTransaction).not.toHaveBeenCalled()
    expect(fakeFirestore.reverseTransfer).not.toHaveBeenCalled()
    unmount()
  })

  it('un pago manual que llego a la cuenta B se revierte de B, no del destino configurado A', async () => {
    const bankB = bank({ id: 'bank2', name: 'Cuenta B', symbol: 'BANCO-B' })
    const manual = { id: 'y1', date: '2026-08-20', type: 'DIVIDEND', symbol: 'MSFT', totalAmount: 83, currency: 'USD', _linkedItemId: 'msft', _origin: 'yield', _source: 'manual_cashflow', _destinationItemId: 'bank2' }
    const { result, unmount } = setup([msft(), bank(), bankB], [manual])
    await settle()
    fakeFirestore.updateItem.mockClear()
    await act(async () => { await result.current.deleteTransactionWithReversal('y1') })
    const ids = fakeFirestore.updateItem.mock.calls.map(([id]) => id)
    expect(ids).toContain('bank2')
    expect(ids).not.toContain('bank1')
    unmount()
  })
})

describe('FASE OB: corregir a mano un pago automatico lo vuelve un registro del usuario', () => {
  it('mover la fecha a otro mes estampa manual_edit y EXCLUYE el mes que dejo', async () => {
    const txs = [autoDiv('t-jun', '2026-06-01', { _destinationCredited: true })]
    const { result, unmount } = setup([msft({ incomeMonthsExplicit: true }), bank()], txs)
    await settle()
    fakeFirestore.updateItem.mockClear()
    await act(async () => { await result.current.updateTransactionWithReversal('t-jun', { date: '2026-07-05' }) })
    expect(fakeFirestore.updateTransaction).toHaveBeenCalledWith('t-jun', { date: '2026-07-05', _source: 'manual_edit' })
    const excl = fakeFirestore.updateItem.mock.calls.find(([id, p]) => id === 'msft' && p.excludedPayDates)
    expect(excl?.[1].excludedPayDates).toEqual(['2026-06-01'])
    unmount()
  })
  it('control: corregir solo el monto no excluye nada', async () => {
    const txs = [autoDiv('t-jun', '2026-06-01', { _destinationCredited: true })]
    const { result, unmount } = setup([msft({ incomeMonthsExplicit: true }), bank()], txs)
    await settle()
    fakeFirestore.updateItem.mockClear()
    await act(async () => { await result.current.updateTransactionWithReversal('t-jun', { totalAmount: 90 }) })
    expect(fakeFirestore.updateTransaction).toHaveBeenCalledWith('t-jun', { totalAmount: 90, _source: 'manual_edit' })
    expect(fakeFirestore.updateItem.mock.calls.find(([id, p]) => id === 'msft' && p.excludedPayDates)).toBeUndefined()
    unmount()
  })
})
