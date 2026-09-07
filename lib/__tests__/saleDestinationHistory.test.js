// FASE OK. Vender un ítem estático (bono, alternativo) con destino "Queda en
// el portafolio" (`_destinationItemId`) no crea ninguna WITHDRAWAL para el
// ítem VENDIDO — solo la crea el destino "Sale del portafolio". Sin ese
// evento, `applyStaticHistory` reconstruye desde `curVal` (0, porque vender
// pone currentPrice/purchasePrice en cero) sin nada que deshacer: TODA la
// historia del activo, incluidos los meses en que valía dinero real, colapsa
// a $0.00 en la Hoja. Reproducido con el hook real antes de tocar nada.
//
// indexBalanceEvents es la única función que decide esto (⛔ superficie F),
// usada por las tres reconstrucciones (spreadsheet, baseline del YTD, gráfica).
// historicalValues pulla en authFetch (y por ende firebase), que no inicializa
// bajo jest. Mismo stub que usan las suites hermanas.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))
const { indexBalanceEvents, getHistoricalItemValues } = require('../historicalValues')

const convert = (v) => v

const bondItem = (overrides = {}) => ({
  id: 'bond1', name: 'VITALI', type: 'Bond', symbol: 'VITALI-BOND',
  quantity: 1, currentPrice: 6000, purchasePrice: 6000, currency: 'USD',
  acquisitionDate: '2026-01-06', ...overrides,
})
const soldBondItem = (overrides = {}) => ({
  id: 'bond1', name: 'VITALI', type: 'Bond', symbol: 'VITALI-BOND',
  quantity: 0, currentPrice: 0, purchasePrice: 0, currency: 'USD',
  acquisitionDate: '2026-01-06', soldFully: true, saleDate: '2026-04-15', salePrice: 6100,
  ...overrides,
})
const bankDest = (overrides = {}) => ({
  id: 'bank1', name: 'Fondo Liquido', type: 'Bank', currency: 'USD',
  quantity: 1, currentPrice: 6100, purchasePrice: 0, ...overrides,
})
const sellTx = (overrides = {}) => ({
  type: 'SELL', symbol: 'VITALI-BOND', date: '2026-04-15', totalAmount: 6100,
  quantity: 1, pricePerUnit: 6100, currency: 'USD', _linkedItemId: 'bond1',
  ...overrides,
})
const openingDeposit = {
  type: 'DEPOSIT', totalAmount: 6098, date: '2026-01-06', _linkedItemId: 'bond1',
  _source: 'manual_new_account', currency: 'USD',
}
const withdrawalCompanion = (overrides = {}) => ({
  type: 'WITHDRAWAL', date: '2026-04-15', totalAmount: 6100, currency: 'USD',
  _linkedItemId: 'bond1', _origin: 'external', ...overrides,
})

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']

describe('indexBalanceEvents: SELL con destino declarado ("queda en el portafolio")', () => {
  test('empuja un evento -monto para el ítem VENDIDO, no solo para el destino', () => {
    const items = [soldBondItem(), bankDest()]
    const ev = indexBalanceEvents(
      [openingDeposit, sellTx({ _destinationItemId: 'bank1' })], items, convert, 'USD'
    ).balanceEventsById
    const ts = Date.UTC(2026, 3, 15)
    expect(ev.bond1).toContainEqual({ ts, amount: -6100 })
    expect(ev.bank1).toContainEqual({ ts, amount: 6100 })
  })

  test('sin destino resuelto (cuenta borrada) no empuja nada para el vendido', () => {
    const items = [soldBondItem()] // no bank1 in items
    const ev = indexBalanceEvents(
      [sellTx({ _destinationItemId: 'bank1' })], items, convert, 'USD'
    ).balanceEventsById
    expect(ev.bond1 || []).toHaveLength(0)
  })
})

describe('getHistoricalItemValues: la historia sobrevive a una venta "queda en el portafolio"', () => {
  test('REGRESIÓN NEGATIVA: sin ningún evento de balance propio, la venta borra toda la historia previa a $0', async () => {
    // Reproduce el comportamiento VIEJO directamente (sin pasar por el fix):
    // un ítem vendido cuyas transacciones no incluyen NINGÚN evento de
    // balance propio (el estado antes de esta fase, cuando el SELL con
    // _destinationItemId nunca tocaba al ítem vendido) siempre reconstruye
    // curVal=0 sin nada que deshacer.
    const noOwnEventTransactions = [openingDeposit] // el SELL nunca llega a tocar bond1
    const result = await getHistoricalItemValues([soldBondItem()], months, convert, 'USD', [], noOwnEventTransactions, [])
    expect(result['2026-02'].bond1?.value ?? 0).toBe(0)
    expect(result['2026-03'].bond1?.value ?? 0).toBe(0)
  })

  test('con el fix: los meses genuinamente sostenidos NO se ven en $0.00', async () => {
    const items = [soldBondItem(), bankDest()]
    const txs = [openingDeposit, sellTx({ _destinationItemId: 'bank1' })]
    const result = await getHistoricalItemValues(items, months, convert, 'USD', [], txs, [])
    // Enero-marzo: el bono todavía estaba sano (antes de la venta del 15 abr).
    expect(result['2026-01'].bond1.value).toBeCloseTo(6100, 2)
    expect(result['2026-02'].bond1.value).toBeCloseTo(6100, 2)
    expect(result['2026-03'].bond1.value).toBeCloseTo(6100, 2)
    // Abril (mes de la venta) en adelante: ya no queda nada que mostrar.
    expect(result['2026-04'].bond1?.value ?? 0).toBe(0)
    expect(result['2026-05'].bond1?.value ?? 0).toBe(0)
  })

  test('mismo resultado que destino "Sale del portafolio" (WITHDRAWAL), por simetría', async () => {
    // Antes de esta fase, "Sale del portafolio" ya reconstruía bien (por
    // accidente, vía la WITHDRAWAL compañera). El fix hace que "Queda en el
    // portafolio" cuente la MISMA historia, no una historia distinta.
    const exitItems = [soldBondItem()]
    const exitTxs = [openingDeposit, sellTx(), withdrawalCompanion()]
    const exitResult = await getHistoricalItemValues(exitItems, months, convert, 'USD', [], exitTxs, [])

    const stayItems = [soldBondItem(), bankDest()]
    const stayTxs = [openingDeposit, sellTx({ _destinationItemId: 'bank1' })]
    const stayResult = await getHistoricalItemValues(stayItems, months, convert, 'USD', [], stayTxs, [])

    for (const mk of months) {
      expect(stayResult[mk].bond1?.value ?? 0).toBeCloseTo(exitResult[mk].bond1?.value ?? 0, 2)
    }
  })

  test('destino con "Sale del portafolio" no cambia: la WITHDRAWAL sigue siendo la única fuente y no se duplica', async () => {
    // Ojo con el guard: NO debe duplicarse el evento cuando además hay
    // _destinationItemId (no debería ocurrir por construcción, pero si un
    // caller lo pusiera igual, no puede sumar DOS eventos -monto para bond1).
    const items = [soldBondItem(), bankDest()]
    const txs = [openingDeposit, sellTx(), withdrawalCompanion()] // sin _destinationItemId: el caso real de "Sale del portafolio"
    const result = await getHistoricalItemValues(items, months, convert, 'USD', [], txs, [])
    expect(result['2026-02'].bond1.value).toBeCloseTo(6100, 2) // no 12200
  })
})
