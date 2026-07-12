import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

async function fetchBTCBalance(address) {
  const res = await retryRequest(() => fetch(`https://blockchain.info/q/addressbalance/${address}?confirmations=1`, { signal: AbortSignal.timeout(15000) }))
  if (!res.ok) throw new Error(`BTC balance fetch failed for ${address}`)
  const satoshis = parseInt(await res.text())
  if (isNaN(satoshis)) throw new Error(`Invalid BTC balance for ${address}`)
  return satoshis / 1e8
}

async function fetchETHBalance(address) {
  const res = await retryRequest(() => fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`, { signal: AbortSignal.timeout(15000) }))
  if (!res.ok) throw new Error(`ETH balance fetch failed for ${address}`)
  const data = await res.json()
  if (data.status !== '1' && data.message !== 'OK') {
    if (data.result === '0') return 0
    throw new Error(`ETH API error: ${data.message || 'Unknown'}`)
  }
  const wei = BigInt(data.result || '0')
  return Number(wei) / 1e18
}

async function fetchSOLBalance(address) {
  const res = await retryRequest(() => fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getBalance',
      params: [address],
    }),
    signal: AbortSignal.timeout(15000),
  }))
  if (!res.ok) throw new Error(`SOL balance fetch failed for ${address}`)
  const data = await res.json()
  if (data.error) throw new Error(`SOL RPC error: ${data.error.message}`)
  return (data.result?.value || 0) / 1e9
}

async function fetchEVMBalance(rpcUrl, address, decimals = 18) {
  const res = await retryRequest(() => fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
    signal: AbortSignal.timeout(15000),
  }))
  if (!res.ok) throw new Error(`EVM balance fetch failed for ${address}`)
  const data = await res.json()
  if (data.error) throw new Error(`RPC error: ${data.error.message}`)
  const wei = BigInt(data.result || '0')
  return Number(wei) / 10 ** decimals
}

const CHAIN_FETCHERS = {
  BTC: fetchBTCBalance,
  ETH: fetchETHBalance,
  SOL: fetchSOLBalance,
  MATIC: (addr) => fetchEVMBalance('https://polygon-rpc.com', addr),
  AVAX: (addr) => fetchEVMBalance('https://api.avax.network/ext/bc/C/rpc', addr),
  ARB: (addr) => fetchEVMBalance('https://arb1.arbitrum.io/rpc', addr),
  BASE: (addr) => fetchEVMBalance('https://mainnet.base.org', addr),
  OP: (addr) => fetchEVMBalance('https://mainnet.optimism.io', addr),
}

const ADDRESS_PATTERNS = {
  BTC: /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/,
  ETH: /^0x[a-fA-F0-9]{40}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  MATIC: /^0x[a-fA-F0-9]{40}$/,
  AVAX: /^0x[a-fA-F0-9]{40}$/,
  ARB: /^0x[a-fA-F0-9]{40}$/,
  BASE: /^0x[a-fA-F0-9]{40}$/,
  OP: /^0x[a-fA-F0-9]{40}$/,
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 20 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { addresses } = body
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return NextResponse.json({ error: 'Addresses array required' }, { status: 400 })
  }

  if (addresses.length > 20) {
    return NextResponse.json({ error: 'Maximum 20 addresses per request' }, { status: 400 })
  }

  const results = []
  const errors = []

  for (const entry of addresses) {
    const { address, chain, label } = entry
    if (!address || !chain) {
      errors.push({ address, error: 'Missing address or chain' })
      continue
    }

    const chainUpper = chain.toUpperCase()
    const fetcher = CHAIN_FETCHERS[chainUpper]
    if (!fetcher) {
      errors.push({ address, error: `Unsupported chain: ${chain}` })
      continue
    }

    const pattern = ADDRESS_PATTERNS[chainUpper]
    if (pattern && !pattern.test(address.trim())) {
      errors.push({ address, error: `Invalid ${chainUpper} address format` })
      continue
    }

    try {
      const balance = await fetcher(address.trim())
      results.push({
        address: address.trim(),
        chain: chainUpper,
        balance,
        label: label || `${chainUpper} (Ledger)`,
      })
    } catch (err) {
      errors.push({ address, chain: chainUpper, error: err.message })
    }
  }

  return NextResponse.json({
    results,
    errors,
    syncedAt: new Date().toISOString(),
  })
}
