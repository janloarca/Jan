import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { getItemValue } from '@/components/dashboard/utils'
import crypto from 'crypto'

// Scoped share links: each link carries what it exposes — the whole portfolio,
// one entity, or a set of institutions (e.g. "just my IBKR"). Multiple links
// can coexist; revoking one never touches the others.
//
// settings/share doc: { links: [{ token, label, scope, createdAt }] }
// shareTokens/{token}: { uid, createdAt, scope, label } — GET resolves from here.
// scope: { type: 'all' } | { type: 'entity', entityId, entityName }
//        | { type: 'institutions', institutions: string[] }
// Legacy single-token docs ({ token, enabled }) are migrated on first 'list'.

const MAX_LINKS = 10

function sanitizeScope(raw) {
  if (!raw || typeof raw !== 'object') return { type: 'all' }
  if (raw.type === 'entity') {
    const entityId = String(raw.entityId || '').slice(0, 60)
    if (!entityId) return null
    return { type: 'entity', entityId, entityName: String(raw.entityName || '').slice(0, 60) }
  }
  if (raw.type === 'institutions') {
    const institutions = Array.isArray(raw.institutions)
      ? raw.institutions.map((i) => String(i).slice(0, 60)).filter(Boolean).slice(0, 20)
      : []
    if (institutions.length === 0) return null
    return { type: 'institutions', institutions }
  }
  if (raw.type === 'all') return { type: 'all' }
  return null
}

// What the visitor sees: both numbers, only amounts, or only percentages.
// 'percent' is a real privacy mode — GET masks absolute amounts server-side.
function sanitizeDisplay(raw) {
  return ['both', 'amounts', 'percent'].includes(raw) ? raw : 'both'
}

// Percent-only links must not leak amounts through the JSON (network tab).
// Scaling quantity AND every price-ish field by √k multiplies each item's value
// by k while leaving every ratio intact: gain% (price ratio), allocation %,
// % of total. Scaling only one side would leak — real qty × public market price
// reveals the value, and bank items carry the balance in the price field.
const PRICE_FIELDS = ['currentPrice', 'purchasePrice', 'price', 'cost', 'averagePrice', 'lastManualValuation']
function maskAmounts(items, snapshots) {
  const totalAssets = items.reduce((s, it) => {
    const v = getItemValue(it)
    return v > 0 ? s + v : s
  }, 0)
  if (!(totalAssets > 0)) return { items, snapshots }
  const k = 10000 / totalAssets
  const sqrtK = Math.sqrt(k)
  const maskedItems = items.map((it) => {
    const m = { ...it }
    if (isFinite(m.quantity)) m.quantity = m.quantity * sqrtK
    for (const f of PRICE_FIELDS) {
      if (isFinite(m[f])) m[f] = m[f] * sqrtK
    }
    if (isFinite(m.incomeAmount)) m.incomeAmount = m.incomeAmount * k
    return m
  })
  const maskedSnapshots = snapshots.map((s) => {
    const m = { ...s }
    if (isFinite(m.netWorthUSD)) m.netWorthUSD = m.netWorthUSD * k
    if (isFinite(m.totalActivosUSD)) m.totalActivosUSD = m.totalActivosUSD * k
    return m
  })
  return { items: maskedItems, snapshots: maskedSnapshots }
}

async function readLinks(shareRef, db, uid) {
  const doc = await shareRef.get()
  const data = doc.exists ? doc.data() : {}
  if (Array.isArray(data.links)) return data.links
  // Migrate the legacy single token into the links list (scope: everything).
  if (data.token) {
    const links = [{ token: data.token, label: 'Portafolio completo', scope: { type: 'all' }, createdAt: data.createdAt || new Date().toISOString() }]
    await shareRef.set({ links, uid, updatedAt: new Date().toISOString() })
    return links
  }
  return []
}

export async function POST(request) {
  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action } = body

  if (!action || !['list', 'create', 'revoke'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const shareRef = db.collection('users').doc(uid).collection('settings').doc('share')

    if (action === 'list') {
      const links = await readLinks(shareRef, db, uid)
      return NextResponse.json({ links })
    }

    if (action === 'create') {
      const scope = sanitizeScope(body.scope)
      if (!scope) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
      const links = await readLinks(shareRef, db, uid)
      if (links.length >= MAX_LINKS) {
        return NextResponse.json({ error: `Max ${MAX_LINKS} links` }, { status: 400 })
      }
      const label = String(body.label || '').slice(0, 40).trim() || 'Portafolio'
      const display = sanitizeDisplay(body.display)
      const token = crypto.randomBytes(16).toString('hex')
      const link = { token, label, scope, display, createdAt: new Date().toISOString() }
      await db.collection('shareTokens').doc(token).set({ uid, createdAt: link.createdAt, scope, label, display })
      await shareRef.set({ links: [...links, link], uid, updatedAt: new Date().toISOString() })
      return NextResponse.json({ link })
    }

    if (action === 'revoke') {
      const token = String(body.token || '')
      if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
      const links = await readLinks(shareRef, db, uid)
      if (!links.some((l) => l.token === token)) return NextResponse.json({ error: 'Unknown link' }, { status: 404 })
      await db.collection('shareTokens').doc(token).delete()
      await shareRef.set({ links: links.filter((l) => l.token !== token), uid, updatedAt: new Date().toISOString() })
      return NextResponse.json({ ok: true })
    }
  } catch (err) {
    console.error('[api/share] POST error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  try {
    const tokenDoc = await db.collection('shareTokens').doc(token).get()
    if (!tokenDoc.exists) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

    const tokenData = tokenDoc.data()
    if (tokenData.createdAt) {
      const created = new Date(tokenData.createdAt)
      const daysSince = (Date.now() - created.getTime()) / 86400000
      if (daysSince > 90) return NextResponse.json({ error: 'Link expired' }, { status: 410 })
    }

    const { uid } = tokenData
    if (!uid) return NextResponse.json({ error: 'Invalid token data' }, { status: 404 })

    // Legacy tokens carry no scope — they always meant "everything".
    const scope = sanitizeScope(tokenData.scope) || { type: 'all' }
    const display = sanitizeDisplay(tokenData.display)

    const [itemsSnap, snapshotsSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('items').get(),
      // Snapshots are GLOBAL net worth; on a scoped link they'd expose (and
      // mislabel) the whole portfolio's history, so only 'all' includes them.
      scope.type === 'all'
        ? db.collection('users').doc(uid).collection('snapshots').orderBy('date').get()
        : Promise.resolve({ docs: [] }),
    ])

    const SHARE_FIELDS = new Set([
      'name', 'symbol', 'type', 'isDebt', 'isReceivable', 'quantity', 'currentPrice',
      'purchasePrice', 'averagePrice', 'price', 'cost', 'currency', 'incomeRate',
      'dividendYield', 'rateType', 'rateMin', 'rateMax', 'maturityDate', 'incomeMonths',
      'incomeAmount', 'subtype', 'isIlliquid', 'lastManualValuation',
    ])
    const inScope = (data) => {
      if (scope.type === 'entity') return (data.entityId || 'default') === scope.entityId
      if (scope.type === 'institutions') return scope.institutions.includes((data.institution || '').trim())
      return true
    }
    let items = itemsSnap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => inScope(data))
      .map(({ id, data }) => {
        const safe = { id }
        for (const key of SHARE_FIELDS) {
          if (data[key] !== undefined) safe[key] = data[key]
        }
        return safe
      })

    let snapshots = snapshotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

    if (display === 'percent') {
      ;({ items, snapshots } = maskAmounts(items, snapshots))
    }

    const prefsDoc = await db.collection('users').doc(uid).collection('settings').doc('preferences').get()
    const baseCurrency = prefsDoc.exists ? prefsDoc.data().baseCurrency || 'USD' : 'USD'

    return NextResponse.json({ items, snapshots, baseCurrency, label: tokenData.label || null, display })
  } catch (err) {
    console.error('[api/share] GET error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
