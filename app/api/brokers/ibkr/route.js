import { NextResponse } from 'next/server'

const FLEX_SEND_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const FLEX_GET_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'

async function parseXML(text) {
  const get = (xml, tag) => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
    return match ? match[1].trim() : null
  }

  const getAttr = (tag, attr) => {
    const match = tag.match(new RegExp(`${attr}="([^"]*)"`, 'i'))
    return match ? match[1] : null
  }

  const getAllTags = (xml, tagName) => {
    const regex = new RegExp(`<${tagName}\\s+([^>]*?)\\s*/>|<${tagName}\\s+([^>]*?)>.*?</${tagName}>`, 'gis')
    const results = []
    let m
    while ((m = regex.exec(xml)) !== null) {
      results.push(m[1] || m[2])
    }
    return results
  }

  const status = get(text, 'Status')
  const referenceCode = get(text, 'ReferenceCode')
  const errorMessage = get(text, 'ErrorMessage')

  if (status && referenceCode) {
    return { type: 'reference', referenceCode, status }
  }

  if (errorMessage) {
    return { type: 'error', error: errorMessage }
  }

  if (status === 'Warn' || status === 'Fail') {
    return { type: 'error', error: get(text, 'ErrorMessage') || status }
  }

  const positions = getAllTags(text, 'OpenPosition').map(attrs => ({
    symbol: getAttr(attrs, 'symbol') || '',
    quantity: parseFloat(getAttr(attrs, 'position') || getAttr(attrs, 'quantity') || '0'),
    markPrice: parseFloat(getAttr(attrs, 'markPrice') || '0'),
    costBasisPrice: parseFloat(getAttr(attrs, 'costBasisPrice') || '0'),
    costBasis: parseFloat(getAttr(attrs, 'costBasis') || '0'),
    unrealizedPL: parseFloat(getAttr(attrs, 'fifoPnlUnrealized') || getAttr(attrs, 'unrealizedPL') || '0'),
    currency: getAttr(attrs, 'currency') || 'USD',
    assetCategory: getAttr(attrs, 'assetCategory') || '',
    description: getAttr(attrs, 'description') || '',
    conid: getAttr(attrs, 'conid') || '',
    marketValue: parseFloat(getAttr(attrs, 'marketValue') || getAttr(attrs, 'positionValue') || '0'),
    listingExchange: getAttr(attrs, 'listingExchange') || '',
  }))

  const trades = getAllTags(text, 'Trade').map(attrs => ({
    symbol: getAttr(attrs, 'symbol') || '',
    tradeDate: getAttr(attrs, 'tradeDate') || getAttr(attrs, 'dateTime') || '',
    quantity: parseFloat(getAttr(attrs, 'quantity') || '0'),
    tradePrice: parseFloat(getAttr(attrs, 'tradePrice') || '0'),
    proceeds: parseFloat(getAttr(attrs, 'proceeds') || '0'),
    commission: parseFloat(getAttr(attrs, 'ibCommission') || getAttr(attrs, 'commission') || '0'),
    buySell: getAttr(attrs, 'buySell') || '',
    currency: getAttr(attrs, 'currency') || 'USD',
    description: getAttr(attrs, 'description') || '',
    assetCategory: getAttr(attrs, 'assetCategory') || '',
    costBasis: parseFloat(getAttr(attrs, 'cost') || getAttr(attrs, 'costBasis') || '0'),
    realizedPL: parseFloat(getAttr(attrs, 'fifoPnlRealized') || getAttr(attrs, 'realizedPL') || '0'),
  }))

  return { type: 'statement', positions, trades }
}

async function fetchWithRetry(url, retries = 3, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url)
    const text = await res.text()
    const parsed = await parseXML(text)

    if (parsed.type === 'error' && parsed.error?.includes('is being generated')) {
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay))
        continue
      }
    }
    return parsed
  }
  return { type: 'error', error: 'Report generation timed out' }
}

export async function POST(request) {
  try {
    const { token, queryId, action } = await request.json()

    if (!token || !queryId) {
      return NextResponse.json({ error: 'Missing token or queryId' }, { status: 400 })
    }

    if (token.length > 200 || queryId.length > 50) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
    }

    const safeToken = encodeURIComponent(token)
    const safeQueryId = encodeURIComponent(queryId)

    const sendUrl = `${FLEX_SEND_URL}?t=${safeToken}&q=${safeQueryId}&v=3`
    const sendRes = await fetch(sendUrl)
    const sendText = await sendRes.text()
    const sendParsed = await parseXML(sendText)

    if (sendParsed.type === 'error') {
      return NextResponse.json({ error: sendParsed.error || 'Failed to request report' }, { status: 400 })
    }

    if (sendParsed.type !== 'reference' || !sendParsed.referenceCode) {
      return NextResponse.json({ error: 'Unexpected response from IBKR' }, { status: 500 })
    }

    await new Promise(r => setTimeout(r, 5000))

    const getUrl = `${FLEX_GET_URL}?t=${safeToken}&q=${sendParsed.referenceCode}&v=3`
    const result = await fetchWithRetry(getUrl, 4, 5000)

    if (result.type === 'error') {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      positions: result.positions || [],
      trades: result.trades || [],
      syncedAt: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
