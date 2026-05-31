import { authFetch } from '@/lib/authFetch'

export async function syncBlockchain(apiKey) {
  const res = await authFetch('/api/brokers/blockchain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync', apiKey }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = data.detail ? `${data.error}\n\n${data.detail}` : (data.error || `Blockchain.com sync failed (${res.status})`)
    throw new Error(msg)
  }

  const data = await res.json()

  const items = (data.positions || [])
    .filter(p => p.quantity > 0)
    .map(p => ({
      symbol: p.symbol,
      name: p.name || p.symbol,
      type: p.type || 'Crypto',
      quantity: p.quantity,
      purchasePrice: p.purchasePrice || 0,
      currentPrice: p.currentPrice || 0,
      institution: 'Blockchain.com',
      currency: p.currency || 'USD',
      _source: 'blockchain',
    }))

  const transactions = [
    ...(data.trades || []),
    ...(data.deposits || []),
    ...(data.withdrawals || []),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  return {
    items,
    transactions,
    syncedAt: data.syncedAt,
  }
}
