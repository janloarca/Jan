// FASE GU. A transfer between two of the user's own accounts must move BOTH
// balances in the historical reconstruction. indexBalanceEvents is what the
// Spreadsheet's monthly rebuild AND the chart's per-item rewind both read, so
// this one index is the whole fix.
// historicalValues pulls in authFetch (and through it firebase), which cannot
// initialize under jest. Same stub the spreadsheet integration test uses.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))
const { indexBalanceEvents } = require('../historicalValues')

const items = [
  { id: 'src', name: 'Fondo Líquido', symbol: 'FLIQ', currency: 'USD' },
  { id: 'dst', name: 'Banco Industrial', symbol: 'BI', currency: 'USD' },
]
const transfer = (over = {}) => ({
  type: 'TRANSFER', symbol: 'FLIQ', date: '2026-04-01', totalAmount: 500, currency: 'USD',
  _originItemId: 'src', _linkedItemId: 'dst', _source: 'manual_transfer', ...over,
})
const ts = Date.UTC(2026, 3, 1)
const run = (txs, convert) => indexBalanceEvents(txs, items, convert, 'USD').balanceEventsById

describe('indexBalanceEvents: TRANSFER', () => {
  test('moves both balances, out of one and into the other', () => {
    // Without this, the receiving account is rebuilt flat at today's HIGHER
    // balance all the way back (as if the money had always been there) and the
    // sending one at today's LOWER balance (as if it never had it).
    const ev = run([transfer()])
    expect(ev.src).toEqual([{ ts, amount: -500 }])
    expect(ev.dst).toEqual([{ ts, amount: 500 }])
  })

  test('the two sides are equal and opposite, so the portfolio total is unmoved', () => {
    const ev = run([transfer()])
    expect(ev.src[0].amount + ev.dst[0].amount).toBe(0)
  })

  test('each end is recorded on its own, so a half-named row still fixes its half', () => {
    // A row naming only the destination is still true about the destination:
    // money did arrive there. Dropping it for lack of the other end would leave
    // that account rebuilt wrong over a fact we do have.
    const onlyTo = run([transfer({ _originItemId: null })])
    expect(onlyTo.dst).toEqual([{ ts, amount: 500 }])
    expect(onlyTo.src).toBeUndefined()

    const onlyFrom = run([transfer({ _linkedItemId: null })])
    expect(onlyFrom.src).toEqual([{ ts, amount: -500 }])
    expect(onlyFrom.dst).toBeUndefined()
  })

  test('rows written before the shared builder existed are skipped, as before', () => {
    // TransferModal used to stamp neither id (FASE GT). Those rows carry no way
    // to know which accounts moved, so they change nothing, exactly as they did
    // before this branch existed.
    expect(run([transfer({ _originItemId: null, _linkedItemId: null })])).toEqual({})
  })

  test('an id pointing at an account that no longer exists moves nothing', () => {
    const ev = run([transfer({ _linkedItemId: 'deleted' })])
    expect(ev.src).toEqual([{ ts, amount: -500 }])
    expect(ev.deleted).toBeUndefined()
  })

  test('a transfer into itself is a no-op', () => {
    expect(run([transfer({ _linkedItemId: 'src' })])).toEqual({})
  })

  test('converted once, so both ends move by the same amount in base currency', () => {
    // The amount is denominated in the SENDING account's currency. Q500 leaving
    // a quetzal account arrives as the same base-currency figure, whatever the
    // receiving account is denominated in.
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD' ? amt / 7.7 : amt)
    const ev = run([transfer({ currency: 'GTQ' })], convert)
    expect(ev.src[0].amount).toBeCloseTo(-500 / 7.7, 10)
    expect(ev.dst[0].amount).toBeCloseTo(500 / 7.7, 10)
    expect(ev.src[0].amount + ev.dst[0].amount).toBeCloseTo(0, 10)
  })

  test('a row with no usable amount or date is ignored, never guessed at', () => {
    expect(run([transfer({ totalAmount: 0 })])).toEqual({})
    expect(run([transfer({ totalAmount: -5 })])).toEqual({})
    expect(run([transfer({ date: null })])).toEqual({})
  })

  test('deposits and dividends keep behaving exactly as they did', () => {
    // The branch is additive: nothing else routes through it.
    const ev = run([
      { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 100, currency: 'USD', _linkedItemId: 'src' },
      { type: 'WITHDRAWAL', date: '2026-03-01', totalAmount: 40, currency: 'USD', _linkedItemId: 'src' },
    ])
    expect(ev.src).toEqual([
      { ts: Date.UTC(2026, 1, 1), amount: 100 },
      { ts: Date.UTC(2026, 2, 1), amount: -40 },
    ])
  })
})

// ⛔ EXTENSIÓN de la lógica congelada F (24 ago 2026, aprobada explícitamente
// por el usuario) sobre el bug que él reportó con una transferencia REAL.
//
// La rama asumía que "el monto viene en la moneda de la cuenta que ENVÍA" y
// empujaba el MISMO monto a los dos lados. Eso vale con una sola moneda y es
// falso en cuanto hay dos: mover Q2,500 a una cuenta en dólares no le suma
// 2,500 dólares a nadie.
describe('un TRANSFER entre monedas mueve montos DISTINTOS en cada lado', () => {
  const items = [
    { id: 'fliq-q', name: 'Fondo Líquido Q', currency: 'GTQ' },
    { id: 'bi', name: 'Banco Industrial', currency: 'USD' },
  ]
  // La base es USD; el quetzal entra a 7.7 salvo que se diga otra cosa.
  const convert = (v, from, to) => {
    if (from === to) return v
    if (from === 'GTQ' && to === 'USD') return v / 7.7
    if (from === 'USD' && to === 'GTQ') return v * 7.7
    return v
  }

  it('cada cuenta recibe el monto de SU moneda, convertido por separado', () => {
    // El banco acreditó 324.50 por Q2,500: una tasa de 7.7042, no la del
    // mercado. Lo que manda es lo que el banco hizo.
    const { balanceEventsById } = indexBalanceEvents([{
      type: 'TRANSFER', date: '2026-08-24',
      totalAmount: 2500, currency: 'GTQ',
      _toAmount: 324.5, _toCurrency: 'USD',
      _originItemId: 'fliq-q', _linkedItemId: 'bi',
    }], items, convert, 'USD')

    // Origen: Q2,500 convertidos a base con la tasa de la app.
    expect(balanceEventsById['fliq-q'][0].amount).toBeCloseTo(-2500 / 7.7, 9)
    // Destino: los 324.50 que de VERDAD llegaron, ya en base.
    expect(balanceEventsById['bi'][0].amount).toBeCloseTo(324.5, 9)
  })

  it('el comportamiento VIEJO queda fijado como regresion: acreditaba el monto del origen', () => {
    // Sin el arreglo, el destino recibia el mismo 2500/7.7 = 324.675 que salio,
    // o sea la tasa del mercado en vez de la del banco. Con montos mas
    // separados el error es enorme: eso es lo que puso su cuenta en 8,092.
    const { balanceEventsById } = indexBalanceEvents([{
      type: 'TRANSFER', date: '2026-08-24',
      totalAmount: 2500, currency: 'GTQ',
      _toAmount: 324.5, _toCurrency: 'USD',
      _originItemId: 'fliq-q', _linkedItemId: 'bi',
    }], items, convert, 'USD')
    expect(balanceEventsById['bi'][0].amount).not.toBeCloseTo(2500 / 7.7, 4)
  })

  it('una fila VIEJA (sin _toAmount) se comporta byte-identico a antes', () => {
    const { balanceEventsById } = indexBalanceEvents([{
      type: 'TRANSFER', date: '2026-08-24',
      totalAmount: 250, currency: 'USD',
      _originItemId: 'fliq-q', _linkedItemId: 'bi',
    }], items, convert, 'USD')
    expect(balanceEventsById['fliq-q'][0].amount).toBeCloseTo(-250, 9)
    expect(balanceEventsById['bi'][0].amount).toBeCloseTo(250, 9)
  })

  it('con la MISMA moneda los dos lados siguen siendo iguales y opuestos', () => {
    const usdItems = [{ id: 'a', currency: 'USD' }, { id: 'b', currency: 'USD' }]
    const { balanceEventsById } = indexBalanceEvents([{
      type: 'TRANSFER', date: '2026-08-24',
      totalAmount: 100, currency: 'USD', _toAmount: 100, _toCurrency: 'USD',
      _originItemId: 'a', _linkedItemId: 'b',
    }], usdItems, convert, 'USD')
    expect(balanceEventsById['a'][0].amount).toBeCloseTo(-100, 9)
    expect(balanceEventsById['b'][0].amount).toBeCloseTo(100, 9)
  })
})
