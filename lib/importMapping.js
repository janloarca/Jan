// Column detection for the generic file import. Extracted from FileImportModal so it
// can be unit-tested: the alias-collision bug (currentPrice stealing the purchase
// price column) shipped precisely because nothing tested this.

// BROKER_PRESETS below call these; the extraction moved the presets out of
// FileImportModal but left the detectors behind, so every CSV upload threw
// "Can't find variable: detectCoinbase" and crashed the page.
import { detectCoinbase } from '@/lib/parsers/coinbaseParser'
import { detectKraken } from '@/lib/parsers/krakenParser'

export const FIELD_MAP = {
  symbol: ['symbol', 'ticker', 'simbolo', 'código', 'codigo', 'sym', 'coin'],
  name: ['name', 'nombre', 'description', 'descripcion', 'instrument', 'instrumento', 'asset', 'financial instrument', 'asset name'],
  type: ['type', 'tipo', 'category', 'categoria', 'asset_type', 'asset type', 'asset class'],
  subtype: ['subtype', 'subtipo', 'sub_type', 'sub type'],
  quantity: ['quantity', 'cantidad', 'qty', 'shares', 'acciones', 'units', 'unidades', 'position', 'total', 'balance', 'amount'],
  purchasePrice: ['precio de compra', 'purchase_price', 'purchaseprice', 'cost', 'costo', 'unit_price', 'avg_price', 'average price', 'precio promedio', 'precio compra', 'cost basis', 'cost price', 'avg cost'],
  currentPrice: ['precio actual', 'current_price', 'currentprice', 'market_price', 'valor actual', 'price', 'precio', 'close price', 'mark price', 'last price', 'market value'],
  institution: ['institution', 'institucion', 'broker', 'exchange', 'platform', 'plataforma', 'cuenta', 'account'],
  currency: ['currency', 'moneda', 'ccy'],
  acquisitionDate: ['fecha', 'fecha de compra', 'date', 'acquisition_date', 'purchase_date', 'fecha compra', 'fecha adquisicion', 'open date'],
  maturityDate: ['maturity', 'vencimiento', 'maturity_date', 'fecha vencimiento', 'expiry', 'expiration'],
  incomeRate: ['rate', 'tasa', 'yield', 'rendimiento', 'income_rate', 'interest_rate', 'tasa anual', 'annual_rate', 'apy', 'apr'],
  taxJurisdiction: ['jurisdiction', 'jurisdiccion', 'tax_jurisdiction', 'pais', 'country'],
  notes: ['notes', 'notas', 'comments', 'comentarios', 'memo'],
}

export const BROKER_PRESETS = {
  ibkr: {
    detect: (h) => h.some((c) => /financial instrument/i.test(c)) || h.some((c) => /mark.?to.?market/i.test(c)),
    institution: 'Interactive Brokers',
    instructions: { es: 'IBKR → Performance & Reports → Flex Queries → Exportar CSV', en: 'IBKR → Performance & Reports → Flex Queries → Export CSV' },
  },
  degiro: {
    detect: (h) => h.some((c) => /product/i.test(c)) && h.some((c) => /isin/i.test(c)) && h.some((c) => /local value/i.test(c)),
    institution: 'DEGIRO',
    instructions: { es: 'DEGIRO → Actividad → Portafolio → Exportar', en: 'DEGIRO → Activity → Portfolio → Export' },
  },
  trading212: {
    detect: (h) => h.some((c) => /ticker.*isin/i.test(c)) || (h.some((c) => /^action$/i.test(c)) && h.some((c) => /price.*share/i.test(c))),
    institution: 'Trading 212',
    instructions: { es: 'Trading 212 → Menú → Historial → Exportar CSV', en: 'Trading 212 → Menu → History → Export CSV' },
  },
  tradeRepublic: {
    detect: (h) => h.some((c) => /isin/i.test(c)) && h.some((c) => /^shares$/i.test(c)) && h.length <= 10,
    institution: 'Trade Republic',
    instructions: { es: 'Trade Republic → Perfil → Actividad → Exportar', en: 'Trade Republic → Profile → Activity → Export' },
  },
  lightyear: {
    detect: (h) => h.some((c) => /ticker/i.test(c)) && h.some((c) => /average.*price/i.test(c)),
    institution: 'Lightyear',
    instructions: { es: 'Lightyear → Portfolio → Exportar posiciones', en: 'Lightyear → Portfolio → Export positions' },
  },
  saxoBank: {
    detect: (h) => h.some((c) => /instrument/i.test(c)) && h.some((c) => /exposure/i.test(c)),
    institution: 'Saxo Bank',
    instructions: { es: 'Saxo → Account → Reports → Portfolio → Export', en: 'Saxo → Account → Reports → Portfolio → Export' },
  },
  schwab: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /market value/i.test(c)) && h.some((c) => /security type/i.test(c)),
    institution: 'Charles Schwab',
    instructions: { es: 'Schwab → Positions → Export', en: 'Schwab → Positions → Export' },
  },
  fidelity: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /last price/i.test(c)) && h.some((c) => /current value/i.test(c)),
    institution: 'Fidelity',
    instructions: { es: 'Fidelity → Positions → Download', en: 'Fidelity → Positions → Download' },
  },
  vanguard: {
    detect: (h) => h.some((c) => /investment.*name/i.test(c)) && h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^shares$/i.test(c)),
    institution: 'Vanguard',
    instructions: { es: 'Vanguard → My Accounts → Download holdings', en: 'Vanguard → My Accounts → Download holdings' },
  },
  etoro: {
    detect: (h) => h.some((c) => /position.*id/i.test(c)) || (h.some((c) => /open.*rate/i.test(c)) && h.some((c) => /close.*rate/i.test(c))),
    institution: 'eToro',
    instructions: { es: 'eToro → Portfolio → Configuración → Descargar datos', en: 'eToro → Portfolio → Settings → Download data' },
  },
  webull: {
    detect: (h) => h.some((c) => /ticker/i.test(c)) && h.some((c) => /avg.*cost/i.test(c)) && h.some((c) => /market.*value/i.test(c)),
    institution: 'Webull',
    instructions: { es: 'Webull → Positions → Export CSV', en: 'Webull → Positions → Export CSV' },
  },
  tradeStation: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^last$/i.test(c)) && h.some((c) => /^qty$/i.test(c)),
    institution: 'TradeStation',
    instructions: { es: 'TradeStation → Portfolio → Exportar posiciones', en: 'TradeStation → Portfolio → Export positions' },
  },
  tastytrade: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /instrument.*type/i.test(c)) && h.some((c) => /trade.*price/i.test(c)),
    institution: 'Tastytrade',
    instructions: { es: 'Tastytrade → Positions → Export', en: 'Tastytrade → Positions → Export' },
  },
  ig: {
    detect: (h) => h.some((c) => /^market$/i.test(c)) && h.some((c) => /^direction$/i.test(c)) && h.some((c) => /^size$/i.test(c)),
    institution: 'IG',
    instructions: { es: 'IG → My IG → Reports → Download', en: 'IG → My IG → Reports → Download' },
  },
  dukascopy: {
    detect: (h) => h.some((c) => /dukascopy/i.test(c)) || (h.some((c) => /^instrument$/i.test(c)) && h.some((c) => /^p.?l$/i.test(c))),
    institution: 'Dukascopy',
    instructions: { es: 'Dukascopy → Reports → Statement → Export', en: 'Dukascopy → Reports → Statement → Export' },
  },
  alpaca: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /avg.*entry.*price/i.test(c)),
    institution: 'Alpaca Markets',
    instructions: { es: 'Alpaca → Dashboard → Portfolio → Export', en: 'Alpaca → Dashboard → Portfolio → Export' },
  },
  ppiGlobal: {
    detect: (h) => h.some((c) => /especie/i.test(c)) || h.some((c) => /^ppi$/i.test(c)),
    institution: 'PPI Global',
    instructions: { es: 'PPI → Mi Portafolio → Exportar', en: 'PPI → My Portfolio → Export' },
  },
  tdAmeritrade: {
    detect: (h) => h.some((c) => /account.*number/i.test(c)) && h.some((c) => /^security$/i.test(c)) && h.some((c) => /^description$/i.test(c)),
    institution: 'TD Ameritrade',
    instructions: { es: 'thinkorswim → Monitor → Activity → Export', en: 'thinkorswim → Monitor → Activity → Export' },
  },
  m1Finance: {
    detect: (h) => h.some((c) => /^m1$/i.test(c)) || (h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /target.*allocation/i.test(c))),
    institution: 'M1 Finance',
    instructions: { es: 'M1 → Research → Holdings → Export', en: 'M1 → Research → Holdings → Export' },
  },
  revolut: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^quantity$/i.test(c)) && h.some((c) => /price.*per.*share/i.test(c)),
    institution: 'Revolut Investments',
    instructions: { es: 'Revolut → Inversiones → Exportar estado de cuenta', en: 'Revolut → Investments → Export statement' },
  },
  myInvestor: {
    detect: (h) => h.some((c) => /isin/i.test(c)) && h.some((c) => /participaciones/i.test(c)),
    institution: 'MyInvestor',
    instructions: { es: 'MyInvestor → Mi Cartera → Descargar posiciones', en: 'MyInvestor → My Portfolio → Download positions' },
  },
  coinbase: {
    detect: (h) => detectCoinbase(h.map(c => (c || '').toString().trim())),
    institution: 'Coinbase',
    typeOverride: 'Crypto',
    instructions: { es: 'Coinbase → Configuración → Reportes → Generar reporte', en: 'Coinbase → Settings → Reports → Generate report' },
  },
  kraken: {
    detect: (h) => detectKraken(h.map(c => (c || '').toString().trim())),
    institution: 'Kraken',
    typeOverride: 'Crypto',
    instructions: { es: 'Kraken → History → Export', en: 'Kraken → History → Export' },
  },
  binance: {
    detect: (h) => h.some((c) => /^coin$/i.test(c)) && h.some((c) => /^total$/i.test(c)),
    institution: 'Binance',
    typeOverride: 'Crypto',
    instructions: { es: 'Binance → Wallet → Spot → Export', en: 'Binance → Wallet → Spot → Export' },
  },
}

// Greedy best-match assignment instead of "first field to find a substring wins".
// The old loop gave "Precio de Compra (USD)" to currentPrice (its alias 'precio' is a
// substring) BEFORE purchasePrice could claim it, so our own template imported with
// currentPrice === purchasePrice and every position showed a 0.00% gain.
// Now every (field, column) candidate is scored by how specific the match is, and the
// strongest pairs are assigned first; a column is never claimed twice.
export function guessMapping(headers) {
  const lowerHeaders = headers.map((h) => (h || '').toString().toLowerCase().trim())
  const candidates = []

  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    lowerHeaders.forEach((h, idx) => {
      if (!h) return
      let best = 0
      for (const a of aliases) {
        if (h === a) best = Math.max(best, 1000 + a.length)          // exact header
        else if (h.replace(/\s*\(.*\)\s*$/, '').trim() === a) best = Math.max(best, 900 + a.length) // "Precio Actual (USD)"
        else if (h.includes(a)) best = Math.max(best, a.length)      // substring: longer alias wins
      }
      if (best > 0) candidates.push({ field, idx, score: best })
    })
  }

  candidates.sort((a, b) => b.score - a.score)
  const mapping = {}
  const usedCols = new Set()
  for (const c of candidates) {
    if (mapping[c.field] != null || usedCols.has(c.idx)) continue
    mapping[c.field] = c.idx
    usedCols.add(c.idx)
  }
  return mapping
}

