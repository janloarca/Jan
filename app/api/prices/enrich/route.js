import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { fetchWithRetry } from '@/lib/fetchWithRetry'

const CRYPTO_SECTORS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'DOGE', 'XRP', 'AVAX', 'MATIC', 'LINK',
  'UNI', 'ATOM', 'LTC', 'SHIB', 'ARB', 'OP', 'FIL', 'NEAR', 'APT', 'SUI',
  'USDC', 'USDT', 'AAVE', 'BNB', 'ALGO', 'XLM', 'HBAR', 'VET', 'MANA', 'SAND',
])

async function fetchProfile(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const profile = data.quoteSummary?.result?.[0]?.assetProfile
    if (!profile) return null
    return {
      sector: profile.sector || '',
      industry: profile.industry || '',
      country: profile.country || '',
    }
  } catch {
    return null
  }
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { symbols } = body
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
  }

  const batch = symbols.slice(0, 30)
  const results = {}

  const promises = batch.map(async (sym) => {
    const symbol = (sym || '').toString().trim().toUpperCase()
    if (!symbol || !/^[A-Z0-9._\-^=]{1,20}$/.test(symbol)) return

    if (CRYPTO_SECTORS.has(symbol)) {
      results[symbol] = { sector: 'Crypto', industry: 'Cryptocurrency', country: 'Global' }
      return
    }

    const profile = await fetchProfile(symbol)
    if (profile) {
      results[symbol] = profile
    }
  })

  await Promise.allSettled(promises)

  return NextResponse.json({ results })
}
