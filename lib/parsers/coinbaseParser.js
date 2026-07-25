import { parseAmount } from '@/lib/numberParse'
const CRYPTO_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ADA: 'Cardano',
  DOT: 'Polkadot', DOGE: 'Dogecoin', XRP: 'Ripple', AVAX: 'Avalanche',
  MATIC: 'Polygon', LINK: 'Chainlink', UNI: 'Uniswap', ATOM: 'Cosmos',
  LTC: 'Litecoin', SHIB: 'Shiba Inu', ARB: 'Arbitrum', OP: 'Optimism',
  FIL: 'Filecoin', NEAR: 'NEAR Protocol', APT: 'Aptos', SUI: 'Sui',
  USDC: 'USD Coin', USDT: 'Tether',
}

function findCol(headers, ...patterns) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  for (const p of patterns) {
    const idx = lower.findIndex(h => h.includes(p))
    if (idx !== -1) return idx
  }
  return -1
}

export function detectCoinbase(headers) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  const hasTxType = lower.some(h => h.includes('transaction type'))
  const hasAsset = lower.some(h => h === 'asset' || h.includes('asset'))
  const hasQty = lower.some(h => h.includes('quantity'))
  const hasSpot = lower.some(h => h.includes('spot price'))
  return hasTxType && hasAsset && hasQty && hasSpot
}

export function parseCoinbase(rows, headers) {
  const txTypeIdx = findCol(headers, 'transaction type')
  const assetIdx = findCol(headers, 'asset')
  const qtyIdx = findCol(headers, 'quantity transacted', 'quantity')
  const spotIdx = findCol(headers, 'spot price at transaction', 'spot price')
  const totalIdx = findCol(headers, 'total (inclusive', 'total')
  const subtotalIdx = findCol(headers, 'subtotal')
  const tsIdx = findCol(headers, 'timestamp', 'date', 'time')
  const currIdx = findCol(headers, 'spot price currency', 'currency')
  const notesIdx = findCol(headers, 'notes')

  const assets = new Map()

  for (const row of rows) {
    const txType = (txTypeIdx >= 0 ? (row[txTypeIdx] || '') : '').toString().trim().toLowerCase()
    const symbol = (assetIdx >= 0 ? (row[assetIdx] || '') : '').toString().trim().toUpperCase()
    if (!symbol || !txType) continue

    const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
    const spot = parseNum(spotIdx >= 0 ? row[spotIdx] : 0)
    const total = parseNum(totalIdx >= 0 ? row[totalIdx] : 0)
    const subtotal = parseNum(subtotalIdx >= 0 ? row[subtotalIdx] : 0)
    const cost = subtotal > 0 ? subtotal : total > 0 ? total : qty * spot
    const ts = tsIdx >= 0 ? (row[tsIdx] || '').toString().trim() : ''
    const currency = currIdx >= 0 ? (row[currIdx] || 'USD').toString().trim().toUpperCase() : 'USD'

    if (!assets.has(symbol)) {
      assets.set(symbol, { qty: 0, totalCost: 0, totalBought: 0, latestSpot: 0, earliest: '', currency })
    }
    const a = assets.get(symbol)
    if (spot > 0) a.latestSpot = spot

    if (['buy', 'receive', 'rewards income', 'learning reward', 'staking income'].includes(txType)) {
      a.qty += qty
      a.totalCost += cost
      a.totalBought += qty
      if (!a.earliest || ts < a.earliest) a.earliest = ts
    } else if (['sell', 'send'].includes(txType)) {
      a.qty -= qty
    } else if (txType === 'convert') {
      a.qty -= qty
      if (notesIdx >= 0) {
        const note = (row[notesIdx] || '').toString()
        const match = note.match(/to\s+([\d.]+)\s+(\w+)/i)
        if (match) {
          const targetSym = match[2].toUpperCase()
          const targetQty = parseFloat(match[1]) || 0
          if (!assets.has(targetSym)) {
            assets.set(targetSym, { qty: 0, totalCost: 0, totalBought: 0, latestSpot: 0, earliest: '', currency })
          }
          const t = assets.get(targetSym)
          t.qty += targetQty
          t.totalCost += cost
          t.totalBought += targetQty
          if (!t.earliest || ts < t.earliest) t.earliest = ts
        }
      }
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
      currentPrice: a.latestSpot > 0 ? a.latestSpot : avgCost,
      institution: 'Coinbase',
      currency: a.currency || 'USD',
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
