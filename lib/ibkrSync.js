import { authFetch } from '@/lib/authFetch'

function mapAssetCategory(ibkrCategory) {
  const cat = (ibkrCategory || '').toUpperCase()
  if (cat === 'STK' || cat === 'STOCK') return 'Stock'
  if (cat === 'OPT' || cat === 'FOP') return 'Alternative'
  if (cat === 'FUT') return 'Alternative'
  if (cat === 'BOND' || cat === 'BILL') return 'Bond'
  if (cat === 'FUND' || cat === 'ETF') return 'Fund'
  if (cat === 'CASH' || cat === 'FOREX') return 'Bank'
  if (cat === 'CRYPTO') return 'Crypto'
  if (cat === 'WAR') return 'Alternative'
  return 'Stock'
}

function formatDate(ibkrDate) {
  if (!ibkrDate) return new Date().toISOString().split('T')[0]
  const str = ibkrDate.toString().replace(/[^0-9]/g, '')
  if (str.length >= 8) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
  }
  return ibkrDate
}

export async function syncIBKR(token, queryId) {
  const res = await authFetch('/api/brokers/ibkr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, queryId }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `IBKR sync failed (${res.status})`)
  }

  const data = await res.json()

  const accountIds = new Set()

  const items = (data.positions || [])
    .filter(p => p.quantity !== 0)
    .map(p => {
      if (p.accountId) accountIds.add(p.accountId)
      return {
        symbol: p.symbol.toUpperCase(),
        name: p.description || p.symbol,
        type: mapAssetCategory(p.assetCategory),
        quantity: Math.abs(p.quantity),
        purchasePrice: p.costBasisPrice || (p.costBasis && p.quantity ? Math.abs(p.costBasis / p.quantity) : 0),
        currentPrice: p.markPrice || 0,
        institution: 'Interactive Brokers',
        currency: p.currency || 'USD',
        exchange: p.listingExchange || '',
        conid: p.conid,
        _ibkrAccountId: p.accountId || '',
        _ibkrMarketValue: p.marketValue,
        _ibkrUnrealizedPL: p.unrealizedPL,
        _isShort: p.quantity < 0,
        _source: 'ibkr',
      }
    })

  const transactions = (data.trades || []).map(t => {
    const isBuy = (t.buySell || '').toUpperCase() === 'BUY'
    if (t.accountId) accountIds.add(t.accountId)
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: t.symbol.toUpperCase(),
      description: `${t.description || t.symbol} — ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(t.quantity)} @ ${t.tradePrice}`,
      date: formatDate(t.tradeDate),
      quantity: Math.abs(t.quantity),
      pricePerUnit: t.tradePrice,
      totalAmount: Math.abs(t.proceeds || 0),
      commission: Math.abs(t.commission || 0),
      currency: t.currency || 'USD',
      _ibkrAccountId: t.accountId || '',
      _ibkrCostBasis: t.costBasis,
      _ibkrRealizedPL: t.realizedPL,
      _source: 'ibkr',
    }
  })

  return {
    items,
    transactions,
    accounts: [...accountIds],
    syncedAt: data.syncedAt,
  }
}
