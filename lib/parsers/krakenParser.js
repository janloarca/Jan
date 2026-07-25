import { parseAmount } from '@/lib/numberParse'
const KRAKEN_ASSETS = {
  XXBT: 'BTC', XETH: 'ETH', XXRP: 'XRP', XLTC: 'LTC', XXDG: 'DOGE',
  XXLM: 'XLM', XXMR: 'XMR', XZEC: 'ZEC', XREP: 'REP', XETC: 'ETC',
}

const CRYPTO_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ADA: 'Cardano',
  DOT: 'Polkadot', DOGE: 'Dogecoin', XRP: 'Ripple', AVAX: 'Avalanche',
  MATIC: 'Polygon', LINK: 'Chainlink', UNI: 'Uniswap', ATOM: 'Cosmos',
  LTC: 'Litecoin', XMR: 'Monero', ZEC: 'Zcash', XLM: 'Stellar',
  USDC: 'USD Coin', USDT: 'Tether',
}

const FIATS = ['ZUSD', 'ZEUR', 'ZGBP', 'ZJPY', 'ZCAD', 'ZAUD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']

function normalizeAsset(pair) {
  let base = pair
  for (const f of FIATS) {
    if (pair.endsWith(f)) { base = pair.slice(0, -f.length); break }
  }
  return KRAKEN_ASSETS[base] || base
}

function findCol(headers, ...patterns) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  for (const p of patterns) {
    const idx = lower.findIndex(h => h === p)
    if (idx !== -1) return idx
  }
  return -1
}

export function detectKraken(headers) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  const hasTxId = lower.includes('txid')
  const hasPair = lower.includes('pair')
  const hasVol = lower.includes('vol')
  const hasOrderTxId = lower.includes('ordertxid')
  return hasTxId && hasPair && hasVol && hasOrderTxId
}

export function detectKrakenLedger(headers) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  return lower.includes('txid') && lower.includes('refid') && lower.includes('aclass') && lower.includes('asset') && lower.includes('balance')
}

export function parseKraken(rows, headers) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())

  if (lower.includes('pair') && lower.includes('vol')) {
    return parseTrades(rows, headers)
  }
  if (lower.includes('aclass') && lower.includes('balance')) {
    return parseLedger(rows, headers)
  }
  return []
}

function parseTrades(rows, headers) {
  const pairIdx = findCol(headers, 'pair')
  const typeIdx = findCol(headers, 'type')
  const volIdx = findCol(headers, 'vol')
  const priceIdx = findCol(headers, 'price')
  const costIdx = findCol(headers, 'cost')
  const timeIdx = findCol(headers, 'time')

  const assets = new Map()

  for (const row of rows) {
    const pair = (pairIdx >= 0 ? (row[pairIdx] || '') : '').toString().trim()
    const type = (typeIdx >= 0 ? (row[typeIdx] || '') : '').toString().trim().toLowerCase()
    if (!pair || !type) continue

    const symbol = normalizeAsset(pair)
    if (FIATS.some(f => symbol === f || symbol === f.replace('Z', ''))) continue

    const vol = parseNum(volIdx >= 0 ? row[volIdx] : 0)
    const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
    const cost = parseNum(costIdx >= 0 ? row[costIdx] : 0)
    const time = timeIdx >= 0 ? (row[timeIdx] || '').toString().trim() : ''

    if (!assets.has(symbol)) {
      assets.set(symbol, { qty: 0, totalCost: 0, totalBought: 0, latestPrice: 0, earliest: '' })
    }
    const a = assets.get(symbol)
    if (price > 0) a.latestPrice = price

    if (type === 'buy') {
      a.qty += vol
      a.totalCost += cost > 0 ? cost : vol * price
      a.totalBought += vol
      if (!a.earliest || time < a.earliest) a.earliest = time
    } else if (type === 'sell') {
      a.qty -= vol
    }
  }

  const items = []
  for (const [symbol, a] of assets) {
    if (a.qty <= 0.00000001) continue
    const avgCost = a.totalBought > 0 ? a.totalCost / a.totalBought : 0
    let acqDate = ''
    if (a.earliest) {
      const d = new Date(a.earliest)
      if (!isNaN(d.getTime())) acqDate = d.toISOString().split('T')[0]
    }
    items.push({
      symbol,
      name: CRYPTO_NAMES[symbol] || symbol,
      type: 'Crypto',
      quantity: a.qty,
      purchasePrice: avgCost,
      currentPrice: a.latestPrice > 0 ? a.latestPrice : avgCost,
      institution: 'Kraken',
      currency: 'USD',
      acquisitionDate: acqDate,
    })
  }
  return items
}

function parseLedger(rows, headers) {
  const assetIdx = findCol(headers, 'asset')
  const balanceIdx = findCol(headers, 'balance')
  const timeIdx = findCol(headers, 'time')

  const assets = new Map()

  for (const row of rows) {
    const rawAsset = (assetIdx >= 0 ? (row[assetIdx] || '') : '').toString().trim()
    if (!rawAsset) continue
    const symbol = KRAKEN_ASSETS[rawAsset] || rawAsset
    if (FIATS.some(f => rawAsset === f || symbol === f.replace('Z', ''))) continue

    const balance = parseNum(balanceIdx >= 0 ? row[balanceIdx] : 0)
    const time = timeIdx >= 0 ? (row[timeIdx] || '').toString().trim() : ''

    assets.set(symbol, { qty: balance, time })
  }

  const items = []
  for (const [symbol, a] of assets) {
    if (a.qty <= 0.00000001) continue
    let acqDate = ''
    if (a.time) {
      const d = new Date(a.time)
      if (!isNaN(d.getTime())) acqDate = d.toISOString().split('T')[0]
    }
    items.push({
      symbol,
      name: CRYPTO_NAMES[symbol] || symbol,
      type: 'Crypto',
      quantity: a.qty,
      purchasePrice: 0,
      currentPrice: 0,
      institution: 'Kraken',
      currency: 'USD',
      acquisitionDate: acqDate,
    })
  }
  return items
}

// Shared LatAm-aware parser: these exchanges serve localized CSVs where
// "1.234,56" is 1234.56, and the old bare parseFloat read it as 1.23456.
function parseNum(val) {
  return parseAmount(val)
}
