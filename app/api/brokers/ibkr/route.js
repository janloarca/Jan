import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { getAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

const FLEX_REQUEST_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest'
const FLEX_FETCH_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement'
const MAX_POLL_ATTEMPTS = 10
const POLL_DELAY_MS = 3000

function parseFlexPositions(xml) {
  const positions = []
  const posRegex = /<OpenPosition[^>]*\/>/g
  let match
  while ((match = posRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const symbol = attr('symbol')
    const qty = parseFloat(attr('position')) || 0
    if (!symbol || qty === 0) continue
    positions.push({
      symbol: symbol.toUpperCase(),
      name: attr('description') || symbol,
      quantity: Math.abs(qty),
      purchasePrice: parseFloat(attr('costBasisPrice')) || 0,
      currentPrice: parseFloat(attr('markPrice')) || parseFloat(attr('closePrice')) || 0,
      currency: attr('currency') || 'USD',
      type: mapAssetCategory(attr('assetCategory'), attr('putCall')),
      institution: 'Interactive Brokers',
      acquisitionDate: formatDate(attr('openDateTime') || attr('reportDate')),
      isDebt: qty < 0,
      _ibkrAccountId: attr('accountId'),
      _ibkrConId: attr('conid'),
    })
  }
  return positions
}

function parseTrades(xml) {
  const trades = []
  const tradeRegex = /<Trade[^>]*\/>/g
  let match
  while ((match = tradeRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const symbol = attr('symbol')
    if (!symbol) continue
    trades.push({
      symbol: symbol.toUpperCase(),
      description: attr('description') || symbol,
      buySell: attr('buySell'),
      quantity: parseFloat(attr('quantity')) || 0,
      tradePrice: parseFloat(attr('tradePrice')) || 0,
      proceeds: parseFloat(attr('proceeds')) || 0,
      commission: parseFloat(attr('ibCommission') || attr('commission')) || 0,
      currency: attr('currency') || 'USD',
      tradeDate: attr('tradeDate') || attr('dateTime'),
      accountId: attr('accountId'),
      assetCategory: attr('assetCategory'),
      costBasis: parseFloat(attr('cost')) || 0,
      realizedPL: parseFloat(attr('fifoPnlRealized') || attr('realizedPL')) || 0,
    })
  }
  return trades
}

function parseCashPositions(xml) {
  const positions = []
  const cashRegex = /<CashReport[^>]*\/>/g
  let match
  while ((match = cashRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return m ? m[1] : ''
    }
    const currency = attr('currency')
    const balance = parseFloat(attr('endingCash')) || parseFloat(attr('endingSettledCash')) || 0
    if (!currency || currency === 'BASE_SUMMARY' || balance === 0) continue
    positions.push({
      symbol: `CASH-${currency}`,
      name: `Cash (${currency})`,
      quantity: 1,
      purchasePrice: Math.abs(balance),
      currentPrice: Math.abs(balance),
      currency,
      type: 'Bank',
      institution: 'Interactive Brokers',
      isDebt: balance < 0,
    })
  }
  return positions
}

function mapAssetCategory(cat, putCall) {
  const c = (cat || '').toUpperCase()
  if (c === 'STK' || c === 'STOCK') return 'Stock'
  if (c === 'BOND' || c === 'BILL') return 'Bond'
  if (c === 'FUND' || c === 'ETF') return 'ETF'
  if (c === 'CASH') return 'Bank'
  if (c === 'OPT' || c === 'FOP') return putCall ? `Option (${putCall})` : 'Option'
  if (c === 'FUT') return 'Futures'
  if (c === 'CRYPTO') return 'Crypto'
  if (c === 'WAR') return 'Warrant'
  return c || 'Stock'
}

function formatDate(dt) {
  if (!dt) return undefined
  const clean = dt.replace(/[;,]/g, '').trim()
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return undefined
}

async function fetchFlexReport(token, queryId) {
  const requestUrl = `${FLEX_REQUEST_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`

  let referenceCode = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000))
    const requestRes = await fetch(requestUrl)
    const requestXml = await requestRes.text()
    const refMatch = requestXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/)
    if (refMatch) {
      referenceCode = refMatch[1]
      break
    }
    const errMatch = requestXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    const errMsg = errMatch ? errMatch[1] : ''
    if (errMsg.toLowerCase().includes('try again') || errMsg.toLowerCase().includes('could not be generated')) {
      if (attempt === 2) throw new Error(errMsg)
      continue
    }
    if (errMsg) throw new Error(errMsg)
    throw new Error('Failed to request Flex statement')
  }

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS))
    const fetchUrl = `${FLEX_FETCH_URL}?q=${referenceCode}&t=${encodeURIComponent(token)}&v=3`
    const fetchRes = await fetch(fetchUrl)
    const fetchXml = await fetchRes.text()
    if (fetchXml.includes('<FlexStatement') || fetchXml.includes('<OpenPosition')) {
      return fetchXml
    }
    if (fetchXml.includes('Statement generation in progress')) continue
    if (fetchXml.toLowerCase().includes('try again')) continue
    const errMatch = fetchXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    if (errMatch) throw new Error(errMatch[1])
  }
  throw new Error('Flex statement generation timed out')
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action } = body

  if (!action || !['sync', 'save-credentials', 'get-credentials'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (action === 'sync') {
    let { token, queryId } = body
    if (!queryId) {
      return NextResponse.json({ error: 'Query ID is required' }, { status: 400 })
    }

    if (!token || token === '__stored__') {
      const db = getAdminDb()
      if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
      const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
      if (!doc.exists || !doc.data().flexToken) {
        return NextResponse.json({ error: 'No stored token found. Enter your Flex Token.' }, { status: 400 })
      }
      token = doc.data().flexToken
      if (!queryId) queryId = doc.data().flexQueryId
    }

    if (typeof token !== 'string' || typeof queryId !== 'string' || token.length > 200 || queryId.length > 50) {
      return NextResponse.json({ error: 'Invalid credentials format' }, { status: 400 })
    }

    if (!/^[a-zA-Z0-9]+$/.test(queryId)) {
      return NextResponse.json({ error: 'Invalid query ID format' }, { status: 400 })
    }

    try {
      const xml = await fetchFlexReport(token, queryId)
      const positions = parseFlexPositions(xml)
      const cash = parseCashPositions(xml)
      const trades = parseTrades(xml)
      const all = [...positions, ...cash]

      return NextResponse.json({
        positions: all,
        trades,
        count: all.length,
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
  }

  if (action === 'save-credentials') {
    const { token, queryId } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (token && queryId) {
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').set({
          flexToken: token,
          flexQueryId: queryId,
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/ibkr] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        flexQueryId: data.flexQueryId,
        hasToken: !!data.flexToken,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/ibkr] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
