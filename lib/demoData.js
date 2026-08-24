// Demo dataset for the interactive onboarding: a small, realistic portfolio a
// new user can explore before entering anything. Every doc carries
// _source: 'demo' so it can be removed selectively, and the ids are FIXED so
// transactions/lots/incomeDestination link within the set and cleanup is exact.
//
// Design constraints:
//  - Market symbols are real (AAPL/VOO/BTC) so live prices and the chart work.
//  - Institutions are neutral ("Broker Demo" etc.) — anything containing
//    "Interactive Brokers" would be picked up by the IBKR sync merge.
//  - The set is COMPLETE for lib/dataCompleteness (dates, currencies, months,
//    destinations, lots covering quantities, deposits explaining balances) so
//    the tour can show the "✓ Tus datos están completos" state.
//  - While demo data exists, useDashboardData gates all persistence side
//    effects (snapshots, itemSnapshots, auto dividends) — see hasDemoData().

export const DEMO_SOURCE = 'demo'

export const DEMO_ITEMS = [
  {
    id: 'demo-aapl', type: 'Stock', subtype: 'common', symbol: 'AAPL', name: 'Apple Inc',
    quantity: 10, purchasePrice: 157, currentPrice: 195, currency: 'USD',
    institution: 'Broker Demo', acquisitionDate: '2022-01-15', _source: DEMO_SOURCE,
  },
  {
    id: 'demo-voo', type: 'Fund', subtype: 'etf', symbol: 'VOO', name: 'Vanguard S&P 500 ETF',
    quantity: 5, purchasePrice: 416, currentPrice: 520, currency: 'USD',
    institution: 'Broker Demo', acquisitionDate: '2021-06-01', _source: DEMO_SOURCE,
  },
  {
    id: 'demo-btc', type: 'Crypto', subtype: 'holding', symbol: 'BTC', name: 'Bitcoin',
    quantity: 0.15, purchasePrice: 48667, currentPrice: 67000, currency: 'USD',
    institution: 'Wallet Demo', acquisitionDate: '2023-03-10', _source: DEMO_SOURCE,
  },
  {
    id: 'demo-ahorro', type: 'Bank', subtype: 'savings', symbol: 'AHORRO-DEMO', name: 'Cuenta de Ahorro',
    quantity: 1, purchasePrice: 15000, currentPrice: 15000, currency: 'GTQ',
    institution: 'Banco Demo', acquisitionDate: '2021-01-10', assetCountry: 'GT', _source: DEMO_SOURCE,
  },
  {
    id: 'demo-bono', type: 'Bond', subtype: 'corporate', symbol: 'BONO-DEMO', name: 'Bono Corporativo 8%',
    quantity: 1, purchasePrice: 10000, currentPrice: 10000, currency: 'USD',
    institution: 'Financiera Demo', acquisitionDate: '2024-01-01', maturityDate: '2034-01-01',
    incomeRate: 8, incomeMonths: [6, 12], dividendAction: 'cash', incomeDestination: 'demo-ahorro',
    assetCountry: 'GT', _source: DEMO_SOURCE,
  },
  {
    id: 'demo-fondo', type: 'Fund', subtype: 'liquid_fund', symbol: 'FONDO-DEMO', name: 'Fondo Líquido GTQ',
    quantity: 1, purchasePrice: 52000, currentPrice: 52000, currency: 'GTQ',
    institution: 'Financiera Demo', acquisitionDate: '2023-06-01',
    incomeRate: 5, incomeMonths: [1, 4, 7, 10], dividendAction: 'reinvest',
    _source: DEMO_SOURCE,
  },
  {
    id: 'demo-apto', type: 'RealEstate', subtype: 'property', symbol: 'APT-DEMO', name: 'Apartamento Centro',
    quantity: 1, purchasePrice: 95000, currentPrice: 95000, currency: 'USD',
    institution: 'Inmobiliaria Demo', acquisitionDate: '2020-08-01', assetCountry: 'US',
    // Vinculado a su hipoteca: el recorrido de ejemplo enseña de una vez cuánto
    // se lleva pagado, cuánto falta y el capital propio. ⛔ El vínculo NO cambia
    // el patrimonio del demo: la deuda ya resta por su cuenta como ítem propio.
    downPayment: 20000, linkedDebtId: 'demo-hipoteca',
    adminFeeMonthly: 120, propertyTaxAnnual: 900,
    _source: DEMO_SOURCE,
  },
  {
    id: 'demo-hipoteca', type: 'Debt', subtype: 'mortgage', symbol: 'HIPOTECA-DEMO', name: 'Hipoteca Apartamento',
    quantity: 1, purchasePrice: 55000, currentPrice: 55000, currency: 'USD', isDebt: true,
    institution: 'Banco Demo', acquisitionDate: '2020-08-01', _source: DEMO_SOURCE,
  },
]

// Dated purchases covering each market quantity exactly (Σ lots = item.quantity)
// so history steps at real dates and 'uncovered-shares' never fires.
export const DEMO_LOTS = [
  { symbol: 'AAPL', quantity: 6, costBasis: 145, currency: 'USD', acquisitionDate: '2022-01-15', institution: 'Broker Demo', _source: DEMO_SOURCE },
  { symbol: 'AAPL', quantity: 4, costBasis: 175, currency: 'USD', acquisitionDate: '2023-09-01', institution: 'Broker Demo', _source: DEMO_SOURCE },
  { symbol: 'VOO', quantity: 3, costBasis: 380, currency: 'USD', acquisitionDate: '2021-06-01', institution: 'Broker Demo', _source: DEMO_SOURCE },
  { symbol: 'VOO', quantity: 2, costBasis: 470, currency: 'USD', acquisitionDate: '2024-02-01', institution: 'Broker Demo', _source: DEMO_SOURCE },
  { symbol: 'BTC', quantity: 0.1, costBasis: 28000, currency: 'USD', acquisitionDate: '2023-03-10', institution: 'Wallet Demo', _source: DEMO_SOURCE },
  { symbol: 'BTC', quantity: 0.05, costBasis: 90000, currency: 'USD', acquisitionDate: '2024-11-20', institution: 'Wallet Demo', _source: DEMO_SOURCE },
]

// Linked flows that EXPLAIN each static balance (completeness engine) and make
// Movimientos / history look alive: deposits at real dates + one yield with a
// destination so the "Rendimiento de X → Y" trace shows.
export const DEMO_TRANSACTIONS = [
  { type: 'DEPOSIT', date: '2021-01-10', symbol: 'AHORRO-DEMO', description: 'Aporte inicial', totalAmount: 10000, currency: 'GTQ', _linkedItemId: 'demo-ahorro', _origin: 'external', _source: DEMO_SOURCE },
  { type: 'DEPOSIT', date: '2023-05-15', symbol: 'AHORRO-DEMO', description: 'Aporte', totalAmount: 4000, currency: 'GTQ', _linkedItemId: 'demo-ahorro', _origin: 'external', _source: DEMO_SOURCE },
  { type: 'DEPOSIT', date: '2024-01-01', symbol: 'BONO-DEMO', description: 'Compra del bono', totalAmount: 10000, currency: 'USD', _linkedItemId: 'demo-bono', _origin: 'external', _source: DEMO_SOURCE },
  { type: 'DEPOSIT', date: '2023-06-01', symbol: 'FONDO-DEMO', description: 'Inversión inicial', totalAmount: 50000, currency: 'GTQ', _linkedItemId: 'demo-fondo', _origin: 'external', _source: DEMO_SOURCE },
  { type: 'DEPOSIT', date: '2020-08-01', symbol: 'APT-DEMO', description: 'Compra del apartamento', totalAmount: 85000, currency: 'USD', _linkedItemId: 'demo-apto', _origin: 'external', _source: DEMO_SOURCE },
  { type: 'DIVIDEND', date: '2025-10-15', symbol: 'FONDO-DEMO', description: 'Rendimiento trimestral', totalAmount: 640, currency: 'GTQ', _linkedItemId: 'demo-fondo', _reinvested: true, _origin: 'yield', _source: DEMO_SOURCE },
  { type: 'DIVIDEND', date: '2025-12-15', symbol: 'BONO-DEMO', description: 'Cupón semestral', totalAmount: 400, currency: 'USD', _linkedItemId: 'demo-bono', _destinationItemId: 'demo-ahorro', _origin: 'yield', _source: DEMO_SOURCE },
]

export function isDemoItem(it) {
  return it?._source === DEMO_SOURCE
}

export function hasDemoData(items) {
  return Array.isArray(items) && items.some(isDemoItem)
}
