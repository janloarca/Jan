import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

// Watch-only crypto lookups: the user pastes a PUBLIC address and we read it
// from open, key-less explorers. A public address is exactly what any block
// explorer shows to anyone; nothing sensitive is shared by providing one.
//
// Providers (researched 2026-08, must stay key-less + reliable):
//   BTC: Esplora API, mempool.space primary and blockstream.info fallback
//        (identical REST shape, both open source, no key).
//   ETH: Routescan's Etherscan-compatible endpoint (no key, rate limited).
//        The old plain api.etherscan.io call silently broke when Etherscan
//        started requiring an API key on every request.
//   SOL + minor EVM: public RPC endpoints (balance only, no history).

const ESPLORA_HOSTS = ['https://mempool.space/api', 'https://blockstream.info/api']
const ROUTESCAN_ETH = 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api'

// History scan caps so one huge address cannot turn a single sync into
// hundreds of upstream requests (Vercel function time is finite).
const BTC_TX_PAGE_CAP = 6      // 6 pages x 50 txs = 300 txs scanned
const MAX_INFLOWS_RETURNED = 100
const ETH_TX_SCAN = 100        // first 100 txs (asc) feed first-seen + inflows

async function esploraGet(path) {
  let lastErr = null
  for (const host of ESPLORA_HOSTS) {
    try {
      const res = await retryRequest(() => fetch(`${host}${path}`, { signal: AbortSignal.timeout(15000) }))
      if (res.ok) return await res.json()
      lastErr = new Error(`Esplora HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Esplora unavailable')
}

// Balance + confirmed history for a BTC address. /txs returns the 50 most
// recent; /txs/chain/{lastTxid} pages backwards until tx_count is covered.
async function fetchBTCData(address) {
  const stats = await esploraGet(`/address/${address}`)
  const chain = stats?.chain_stats || {}
  const balance = ((chain.funded_txo_sum || 0) - (chain.spent_txo_sum || 0)) / 1e8
  const txCount = chain.tx_count || 0
  if (txCount === 0) return { balance, firstSeen: null, inflows: [] }

  const txs = []
  let lastTxid = null
  for (let page = 0; page < BTC_TX_PAGE_CAP && txs.length < txCount; page++) {
    const batch = await esploraGet(`/address/${address}/txs${lastTxid ? `/chain/${lastTxid}` : ''}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    txs.push(...batch)
    lastTxid = batch[batch.length - 1].txid
    if (batch.length < 25) break
  }

  // Net BTC per tx from THIS address's perspective: outputs paying the
  // address minus inputs spending from it. Positive = an inflow ("addition").
  const addr = address.toLowerCase()
  const nets = []
  for (const tx of txs) {
    if (!tx?.status?.confirmed || !tx.status.block_time) continue
    const received = (tx.vout || []).reduce((sum, o) =>
      sum + ((o.scriptpubkey_address || '').toLowerCase() === addr ? (o.value || 0) : 0), 0)
    const spent = (tx.vin || []).reduce((sum, i) =>
      sum + ((i.prevout?.scriptpubkey_address || '').toLowerCase() === addr ? (i.prevout?.value || 0) : 0), 0)
    const net = received - spent
    if (net !== 0) nets.push({ ts: tx.status.block_time, net: net / 1e8 })
  }
  nets.sort((a, b) => a.ts - b.ts)
  const toDate = (ts) => new Date(ts * 1000).toISOString().split('T')[0]
  // firstSeen is only claimed when the scan covered EVERY tx: pages walk
  // backwards from the newest, so a truncated scan's oldest tx is not the
  // address's real first activity and must not become the purchase date.
  const complete = txs.length >= txCount
  const firstSeen = complete && nets.length > 0 ? toDate(nets[0].ts) : null
  const inflows = nets
    .filter((n) => n.net > 0)
    .map((n) => ({ date: toDate(n.ts), amount: n.net }))
    .slice(0, MAX_INFLOWS_RETURNED)
  return { balance, firstSeen, inflows, historyTruncated: !complete }
}

async function routescanGet(query) {
  const res = await retryRequest(() => fetch(`${ROUTESCAN_ETH}?${query}`, { signal: AbortSignal.timeout(15000) }))
  if (!res.ok) throw new Error(`ETH API HTTP ${res.status}`)
  return res.json()
}

// Balance + early history for an ETH address. History is best-effort: if the
// tx list call fails we still return the balance.
async function fetchETHData(address) {
  const bal = await routescanGet(`module=account&action=balance&address=${address}&tag=latest`)
  if (bal.status !== '1' && bal.message !== 'OK') {
    if (bal.result === '0') return { balance: 0, firstSeen: null, inflows: [] }
    throw new Error(`ETH API error: ${bal.message || 'Unknown'}`)
  }
  const balance = Number(BigInt(bal.result || '0')) / 1e18

  let firstSeen = null
  let inflows = []
  let historyTruncated = false
  try {
    const addr = address.toLowerCase()
    const list = await routescanGet(
      `module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${ETH_TX_SCAN}&sort=asc`
    )
    if (Array.isArray(list.result) && list.result.length > 0) {
      const toDate = (ts) => new Date(Number(ts) * 1000).toISOString().split('T')[0]
      // sort=asc makes element 0 the address's real first tx, so firstSeen is
      // exact even when the inflow scan only covers the earliest window.
      if (list.result[0]?.timeStamp) firstSeen = toDate(list.result[0].timeStamp)
      historyTruncated = list.result.length >= ETH_TX_SCAN
      inflows = list.result
        .filter((tx) => (tx.to || '').toLowerCase() === addr
          && (tx.from || '').toLowerCase() !== addr
          && tx.value && tx.value !== '0'
          && tx.isError === '0')
        .map((tx) => ({ date: toDate(tx.timeStamp), amount: Number(BigInt(tx.value)) / 1e18 }))
        .slice(0, MAX_INFLOWS_RETURNED)
    }
  } catch { /* history is best-effort; the balance is already secured */ }
  return { balance, firstSeen, inflows, historyTruncated }
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

const balanceOnly = async (fetcher, address) => ({ balance: await fetcher(address), firstSeen: null, inflows: [], historyTruncated: false })

const CHAIN_FETCHERS = {
  BTC: fetchBTCData,
  ETH: fetchETHData,
  SOL: (addr) => balanceOnly(fetchSOLBalance, addr),
  MATIC: (addr) => balanceOnly((a) => fetchEVMBalance('https://polygon-rpc.com', a), addr),
  AVAX: (addr) => balanceOnly((a) => fetchEVMBalance('https://api.avax.network/ext/bc/C/rpc', a), addr),
  ARB: (addr) => balanceOnly((a) => fetchEVMBalance('https://arb1.arbitrum.io/rpc', a), addr),
  BASE: (addr) => balanceOnly((a) => fetchEVMBalance('https://mainnet.base.org', a), addr),
  OP: (addr) => balanceOnly((a) => fetchEVMBalance('https://mainnet.optimism.io', a), addr),
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
      const { balance, firstSeen, inflows, historyTruncated } = await fetcher(address.trim())
      results.push({
        address: address.trim(),
        chain: chainUpper,
        balance,
        label: label || `${chainUpper} (Ledger)`,
        firstSeen: firstSeen || null,
        inflows: Array.isArray(inflows) ? inflows : [],
        historyTruncated: !!historyTruncated,
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
