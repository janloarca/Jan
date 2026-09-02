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
const { indexBalanceEvents, getHistoricalItemValues } = require('../historicalValues')

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

// FASE KZ3 (extension de la logica congelada F, OK explicito del usuario el 26
// ago 2026): el pago de una DEUDA rebobina tambien el pasado del prestamo. El
// id viaja en `_debtItemId` y NO en `_linkedItemId` a proposito (una deuda se
// guarda en POSITIVO, asi que el +monto del destino normal seria al reves); el
// evento correcto es -aplicado, y el rebobinado lo SUMA hacia atras.
describe('indexBalanceEvents: pago de deuda (_debtItemId)', () => {
  const debtItems = [
    { id: 'cash', name: 'Banco', type: 'Bank', currency: 'USD', quantity: 1, purchasePrice: 5000, currentPrice: 5000, acquisitionDate: '2024-01-01' },
    { id: 'loan', name: 'Hipoteca', type: 'Deuda', isDebt: true, currency: 'USD', quantity: 1, purchasePrice: 39000, currentPrice: 39000, acquisitionDate: '2024-01-01' },
  ]
  const payment = (over = {}) => ({
    type: 'TRANSFER', symbol: 'TRANSFER', date: '2026-07-15', totalAmount: 1000, currency: 'USD',
    _toAmount: 1000, _toCurrency: 'USD',
    _originItemId: 'cash', _debtItemId: 'loan', _source: 'manual_debt_payment',
  ...over,
  })
  const pts = Date.UTC(2026, 6, 15)

  test('el pago empuja -aplicado a la DEUDA ademas del -monto al efectivo', () => {
    const ev = indexBalanceEvents([payment()], debtItems, null, 'USD').balanceEventsById
    expect(ev.cash).toEqual([{ ts: pts, amount: -1000 }])
    // NEGATIVO a proposito: el pago BAJO la magnitud de la deuda ese dia, asi
    // que rebobinar hacia atras (val -= amount) la sube a lo que se debia.
    expect(ev.loan).toEqual([{ ts: pts, amount: -1000 }])
  })

  test('entre monedas, la deuda usa el monto APLICADO (_toAmount) en SU moneda', () => {
    const conv = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const cross = payment({ totalAmount: 7700, currency: 'GTQ', _toAmount: 1000, _toCurrency: 'USD' })
    const ev = indexBalanceEvents([cross], debtItems, conv, 'USD').balanceEventsById
    expect(ev.cash[0].amount).toBeCloseTo(-1000, 9)   // 7700 GTQ a base
    expect(ev.loan[0].amount).toBeCloseTo(-1000, 9)   // lo aplicado, ya en USD
  })

  test('una deuda borrada no recibe nada, igual que cualquier id muerto', () => {
    const ev = indexBalanceEvents([payment({ _debtItemId: 'gone' })], debtItems, null, 'USD').balanceEventsById
    expect(ev.gone).toBeUndefined()
    expect(ev.cash).toHaveLength(1)
  })

  test('la reconstruccion completa: el mes ANTERIOR al pago debe MAS, no lo mismo', async () => {
    // El defecto que esto cierra: la hipoteca quedaba plana en su saldo de HOY
    // en toda la serie, mientras la cuenta que pago si se rebobinaba: las dos
    // mitades del mismo pago median pasados distintos.
    const months = ['2026-06', '2026-07', '2026-08']
    const r = await getHistoricalItemValues(debtItems, months, null, 'USD', [], [payment()], [])
    expect(r['2026-06'].loan.value).toBe(40000)  // antes del pago se debia mas
    expect(r['2026-07'].loan.value).toBe(39000)  // el pago cae en julio
    expect(r['2026-08'].loan.value).toBe(39000)
    // Y la cuenta que pago se rebobina en espejo: tenia 1000 mas antes de pagar.
    expect(r['2026-06'].cash.value).toBe(6000)
    expect(r['2026-07'].cash.value).toBe(5000)
  })

  test('las dos mitades se cancelan: el TOTAL neto del mes no cambia por el pago', async () => {
    const months = ['2026-06', '2026-08']
    const r = await getHistoricalItemValues(debtItems, months, null, 'USD', [], [payment()], [])
    // El total neto (activos - deuda, como lo lee el spreadsheet) es identico
    // antes y despues: pagar deuda mueve dinero de un bolsillo al otro.
    const net = (mk) => r[mk].cash.value - r[mk].loan.value
    expect(net('2026-06')).toBeCloseTo(net('2026-08'), 9)
  })
})

// FASE MX (extension de la logica congelada F, OK explicito del usuario el 2 sep
// 2026): un GASTO sobre un activo pagado desde una cuenta registrada baja el
// saldo de esa cuenta, pero la fila se archiva contra el ACTIVO, asi que la
// cuenta que pago se reconstruia PLANA en su saldo de hoy hacia atras: el pasado
// decia que ese dinero nunca estuvo ahi. El id del otro extremo viaja en
// `_paidFromItemId`, campo propio, igual que `_debtItemId` arriba.
describe('indexBalanceEvents: gasto pagado desde una cuenta (_paidFromItemId)', () => {
  const feeItems = [
    { id: 'cash', name: 'Cuenta Monetaria', type: 'Bank', currency: 'USD', quantity: 1, purchasePrice: 8000, currentPrice: 8000, acquisitionDate: '2024-01-01' },
    { id: 'casa', name: 'Casa Zona 14', type: 'RealEstate', currency: 'USD', quantity: 1, purchasePrice: 200000, currentPrice: 200000, acquisitionDate: '2024-01-01' },
  ]
  const fee = (over = {}) => ({
    type: 'FEE', symbol: 'CASA', date: '2026-07-15', totalAmount: 4500, amount: 4500, currency: 'USD',
    description: 'Reparacion del techo',
    _linkedItemId: 'casa', _paidFromItemId: 'cash', _origin: 'expense', _source: 'manual_cashflow',
    ...over,
  })
  const fts = Date.UTC(2026, 6, 15)

  test('el gasto empuja -monto a la cuenta que pago', () => {
    const ev = indexBalanceEvents([fee()], feeItems, null, 'USD').balanceEventsById
    expect(ev.cash).toEqual([{ ts: fts, amount: -4500 }])
  })

  // ⛔ La asimetria es la decision de FASE KW y no un olvido: reparar el techo
  // no sube el precio de la casa. Si el activo recibiera evento, su serie
  // historica se moveria por un gasto que nunca cambio su valor.
  test('el ACTIVO sobre el que se gasto no recibe ningun evento', () => {
    const ev = indexBalanceEvents([fee()], feeItems, null, 'USD').balanceEventsById
    expect(ev.casa).toBeUndefined()
  })

  // Regresion NEGATIVA: es la poblacion que NO puede moverse. Toda comision de
  // broker y todo costo importado llega sin `_paidFromItemId`.
  test('un FEE sin _paidFromItemId no produce NINGUN evento', () => {
    const ev = indexBalanceEvents([fee({ _paidFromItemId: undefined })], feeItems, null, 'USD').balanceEventsById
    expect(ev.cash).toBeUndefined()
    expect(ev.casa).toBeUndefined()
  })

  test('una cuenta borrada no recibe nada, igual que cualquier id muerto', () => {
    const ev = indexBalanceEvents([fee({ _paidFromItemId: 'gone' })], feeItems, null, 'USD').balanceEventsById
    expect(ev.gone).toBeUndefined()
    expect(ev.cash).toBeUndefined()
  })

  test('el monto se toma en MAGNITUD y convertido a base', () => {
    const conv = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const cross = fee({ totalAmount: -7700, amount: -7700, currency: 'GTQ' })
    const ev = indexBalanceEvents([cross], feeItems, conv, 'USD').balanceEventsById
    expect(ev.cash[0].amount).toBeCloseTo(-1000, 9)
  })

  test('la reconstruccion completa: el mes ANTERIOR al gasto tiene MAS dinero', async () => {
    const months = ['2026-06', '2026-07', '2026-08']
    const r = await getHistoricalItemValues(feeItems, months, null, 'USD', [], [fee()], [])
    expect(r['2026-06'].cash.value).toBe(12500)  // antes de pagar tenia 4,500 mas
    expect(r['2026-07'].cash.value).toBe(8000)   // el gasto cae en julio
    expect(r['2026-08'].cash.value).toBe(8000)
    // Y el inmueble no se mueve: el gasto no lo revaluo.
    expect(r['2026-06'].casa.value).toBe(200000)
    expect(r['2026-08'].casa.value).toBe(200000)
  })
})
