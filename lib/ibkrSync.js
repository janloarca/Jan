import { authFetch } from '@/lib/authFetch'

export async function syncIBKR(token, queryId) {
  const res = await authFetch('/api/brokers/ibkr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync', token, queryId }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = data.detail ? `${data.error}\n\n${data.detail}` : (data.error || `IBKR sync failed (${res.status})`)
    throw new Error(msg)
  }

  const data = await res.json()

  const accountIds = new Set()

  const items = (data.positions || [])
    .filter(p => p.quantity !== 0)
    .map(p => {
      if (p._ibkrAccountId) accountIds.add(p._ibkrAccountId)
      return {
        symbol: (p.symbol || '').toUpperCase(),
        name: p.name || p.symbol,
        type: p.type || 'Stock',
        quantity: Math.abs(p.quantity || 0),
        purchasePrice: p.purchasePrice || 0,
        currentPrice: p.currentPrice || 0,
        institution: p.institution || 'Interactive Brokers',
        currency: p.currency || 'USD',
        acquisitionDate: p.acquisitionDate,
        conid: p._ibkrConId || '',
        _ibkrAccountId: p._ibkrAccountId || '',
        _isShort: p.isDebt || false,
        _source: 'ibkr',
      }
    })

  const transactions = (data.trades || []).map(t => {
    const isBuy = (t.buySell || '').toUpperCase() === 'BUY'
    if (t.accountId) accountIds.add(t.accountId)
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: (t.symbol || '').toUpperCase(),
      description: `${t.description || t.symbol} — ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(t.quantity)} @ ${t.tradePrice}`,
      date: t.tradeDate || new Date().toISOString().split('T')[0],
      quantity: Math.abs(t.quantity || 0),
      pricePerUnit: t.tradePrice || 0,
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
