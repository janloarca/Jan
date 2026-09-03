// lib/historicalValues.js arrastra authFetch → firebase, que no arranca bajo
// jsdom. Mismo mock que spreadsheetIntegration/transferBalanceEvents.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))

const { buildHistoryItemsPayload, buildHistoryRequestBody } = require('../historyPayload')

// El caso real que motivó FASE JU: una cuenta que compone su propio rendimiento
// (ClubCashIn, y los fondos líquidos de IDC desde FASE HV). El pago se escribe
// como DIVIDEND reinvertido contra el MISMO ítem, así que indexBalanceEvents lo
// manda a reinvestBySym/ById y NUNCA a balanceEventsById: no aparece en
// `cashFlows` de ningún ítem. El único canal que lo lleva al server es `income`.
const fund = {
  id: 'fund-1', name: 'ClubCashIn', symbol: 'CLUBCASH',
  type: 'Cuenta bancaria', quantity: 1, currency: 'USD',
  purchasePrice: 700, currentPrice: 700,
  acquisitionDate: '2024-06-01', dividendAction: 'reinvest',
}
const yieldTx = [
  { id: 'y1', type: 'DIVIDEND', date: '2025-11-30', totalAmount: 5.89, currency: 'USD', _linkedItemId: 'fund-1', _reinvested: true, _source: 'inferred_yield' },
  { id: 'y2', type: 'DIVIDEND', date: '2025-12-31', totalAmount: 5.89, currency: 'USD', _linkedItemId: 'fund-1', _reinvested: true, _source: 'inferred_yield' },
]
const opening = { id: 'd1', type: 'DEPOSIT', date: '2024-06-01', totalAmount: 600, currency: 'USD', _linkedItemId: 'fund-1', _source: 'manual_new_account' }

describe('buildHistoryItemsPayload', () => {
  it('deja el rendimiento REINVERTIDO fuera de cashFlows (por eso hace falta income)', () => {
    const [row] = buildHistoryItemsPayload({
      items: [fund], transactions: [opening, ...yieldTx], lots: [], convert: null,
    })
    expect(row.id).toBe('fund-1')
    // El depósito de apertura sí mueve el saldo y sí viaja acá.
    expect(row.cashFlows).toHaveLength(1)
    expect(row.cashFlows[0].amount).toBeCloseTo(600, 2)
    expect(row._flowClampZero).toBe(true)
    // Los dos pagos reinvertidos NO están: si el caller no manda `income`, el
    // server no tiene forma de saber que existieron y reconstruye la cuenta
    // plana en su valor de HOY.
    const amounts = row.cashFlows.map((f) => Math.abs(f.amount))
    expect(amounts.some((a) => Math.abs(a - 5.89) < 0.01)).toBe(false)
  })

  it('convierte precios a USD y marca las fechas no confiables', () => {
    const gtq = { id: 'g1', name: 'Fondo Q', type: 'Cuenta bancaria', quantity: 1, currency: 'GTQ', purchasePrice: 770, currentPrice: 770, acquisitionDate: '2025-01-02' }
    const convert = (amt, from, to) => (from === 'GTQ' && to === 'USD') ? amt / 7.7 : amt
    const [row] = buildHistoryItemsPayload({ items: [gtq], transactions: [], lots: [], convert })
    expect(row.currency).toBe('USD')
    expect(row.currentPrice).toBeCloseTo(100, 6)
    expect(row._dateUnreliable).toBe(false)
  })
})

describe('buildHistoryRequestBody', () => {
  // ⛔ El candado de FASE JU. "Reparar ahora" armaba su propio cuerpo y se
  // quedaba sin estos dos campos, así que archivaba un ancla de 1 de enero
  // distinta de la que el panel del YTD descompone.
  it('SIEMPRE manda income con el rendimiento reinvertido', () => {
    const body = buildHistoryRequestBody({
      items: [fund], transactions: [opening, ...yieldTx], lots: [], convert: null, period: 'YTD',
    })
    expect(body.income).toHaveLength(2)
    expect(body.income.every((e) => e.reinvested === true)).toBe(true)
    expect(body.income.map((e) => e.itemId)).toEqual(['fund-1', 'fund-1'])
    expect(body.income.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(11.78, 2)
    expect(body.period).toBe('YTD')
  })

  it('manda los lots abiertos, y omite el campo cuando no hay ninguno', () => {
    const stock = { id: 's1', symbol: 'META', type: 'Stock', quantity: 3, currency: 'USD', purchasePrice: 400, currentPrice: 500, acquisitionDate: '2025-03-01' }
    const lots = [
      { symbol: 'META', quantity: 3, acquisitionDate: '2025-03-01', closedDate: null, costBasis: 1200 },
      { symbol: 'META', quantity: 0, acquisitionDate: '2024-01-01', closedDate: null },
    ]
    const withLots = buildHistoryRequestBody({ items: [stock], transactions: [], lots, convert: null, period: 'YTD' })
    expect(withLots.lots).toHaveLength(1)
    expect(withLots.lots[0]).toEqual({ symbol: 'META', quantity: 3, acquisitionDate: '2025-03-01', closedDate: null })

    const noLots = buildHistoryRequestBody({ items: [stock], transactions: [], lots: [], convert: null, period: 'YTD' })
    expect(noLots.lots).toBeUndefined()
  })

  it('breakdown solo aparece cuando se pide', () => {
    const plain = buildHistoryRequestBody({ items: [fund], transactions: [], lots: [], convert: null, period: '1M' })
    expect(plain.breakdown).toBeUndefined()
    const asked = buildHistoryRequestBody({ items: [fund], transactions: [], lots: [], convert: null, period: 'YTD', breakdown: true })
    expect(asked.breakdown).toBe(true)
  })

  it('los items del cuerpo son exactamente los de buildHistoryItemsPayload', () => {
    const args = { items: [fund], transactions: [opening, ...yieldTx], lots: [], convert: null }
    const body = buildHistoryRequestBody({ ...args, period: 'YTD' })
    expect(body.items).toEqual(buildHistoryItemsPayload(args))
  })
})

// ⛔ FASE MZ (corrección de una regresión de FASE MY). MY hizo que un gasto con
// `_paidFromItemId` no moviera la caja del broker, porque casi siempre lo pagó
// OTRA cuenta. Pero cuando lo paga la caja DEL PROPIO broker, esa caja sí se
// movió, y saltarlo lo PIERDE: `buildHistoryItemsPayload` le da al ítem de caja
// los flujos de `buildCashFlows` EN VEZ de `balanceEventsById` (es un
// o-lo-uno-o-lo-otro), así que el evento que FASE MX sí registra del otro lado
// no lo recoge nadie.
describe('FASE MZ: un gasto pagado DESDE la caja del broker', () => {
  const items = [
    { id: 'cash', symbol: 'CASH-USD', type: 'Cash', _source: 'ibkr',
      quantity: 1, currentPrice: 2000, currency: 'USD' },
    { id: 'nvda', symbol: 'NVDA', type: 'Stock', _source: 'ibkr',
      quantity: 10, currentPrice: 100, currency: 'USD' },
  ]
  // Un DEPOSIT real es lo que hace que la caja se rebobine (hasExternalFlow).
  const deposito = { id: 'd1', type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-10',
    totalAmount: 5000, currency: 'USD', _source: 'ibkr' }
  const gasto = (paidFrom) => ({
    id: 'f1', type: 'FEE', symbol: 'NVDA', date: '2026-05-15',
    totalAmount: 300, currency: 'USD', _linkedItemId: 'nvda',
    _paidFromItemId: paidFrom, _source: 'manual_cashflow',
  })
  const cashFlowsDe = (txs) => buildHistoryItemsPayload({ items, transactions: txs, lots: [], convert: null })
    .find((p) => p.id === 'cash').cashFlows

  it('la caja del broker lo deshace: fue SU efectivo el que salió', () => {
    const flows = cashFlowsDe([deposito, gasto('cash')])
    expect(flows).toContainEqual({ ts: Date.UTC(2026, 4, 15), amount: -300 })
  })

  // Control: exactamente UNA vez. `balanceEventsById` también registra el
  // evento (FASE MX), pero para el ítem de caja se ignora a propósito; si
  // alguna vez se sumaran las dos listas, el gasto se contaría doble.
  it('control: aparece exactamente una vez, sin doble conteo', () => {
    const flows = cashFlowsDe([deposito, gasto('cash')])
    expect(flows.filter((f) => f.amount === -300)).toHaveLength(1)
  })

  // REGRESIÓN NEGATIVA (el caso que FASE MY vino a cerrar): pagado desde OTRA
  // cuenta, la caja del broker no se mueve, porque no fue su dinero.
  it('pagado desde otra cuenta, la caja del broker queda quieta', () => {
    const flows = cashFlowsDe([deposito, gasto('banco')])
    expect(flows.filter((f) => f.amount === -300)).toHaveLength(0)
    expect(flows).toContainEqual({ ts: Date.UTC(2026, 0, 10), amount: 5000 })
  })

  // ⛔ La MISMA regresión llega a la gráfica, que es el OTRO caller de
  // buildCashFlows y arma su payload con la misma forma de o-lo-uno-o-lo-otro
  // (los ítems 'ibkr' quedan fuera de perItemCashFlows por un `return`
  // explícito). Reproducido antes de arreglarlo: indexBalanceEvents registraba
  // el gasto en la caja y el payload de la gráfica salía sin él.
  //
  // Se fija LEYENDO LA FUENTE (precedente ibkrImportGate.test.js): ese bloque
  // vive dentro de un componente que jest no puede montar sin el dashboard
  // entero. Lo que importa es que la gráfica le DIGA a buildCashFlows cuál es
  // su caja; sin ese dato el guard no puede distinguir los dos casos.
  it('la gráfica también le pasa su caja a buildCashFlows', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8')
    const call = src.slice(src.indexOf('buildCashFlows(brokerTx'))
    expect(call.slice(0, 400)).toContain('cashAccountId')
  })
})
