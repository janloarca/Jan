import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import crypto from 'crypto'

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

  if (!action || !['enable', 'disable', 'regenerate'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const shareRef = db.collection('users').doc(uid).collection('settings').doc('share')

    if (action === 'enable') {
      const existing = await shareRef.get()
      if (existing.exists && existing.data().token) {
        return NextResponse.json({ token: existing.data().token, enabled: true })
      }
      const token = crypto.randomBytes(16).toString('hex')
      await shareRef.set({ token, enabled: true, createdAt: new Date().toISOString(), uid })
      await db.collection('shareTokens').doc(token).set({ uid, createdAt: new Date().toISOString() })
      return NextResponse.json({ token, enabled: true })
    }

    if (action === 'disable') {
      const existing = await shareRef.get()
      if (existing.exists && existing.data().token) {
        await db.collection('shareTokens').doc(existing.data().token).delete()
      }
      await shareRef.set({ token: null, enabled: false, updatedAt: new Date().toISOString() })
      return NextResponse.json({ enabled: false })
    }

    if (action === 'regenerate') {
      const existing = await shareRef.get()
      if (existing.exists && existing.data().token) {
        await db.collection('shareTokens').doc(existing.data().token).delete()
      }
      const token = crypto.randomBytes(16).toString('hex')
      await shareRef.set({ token, enabled: true, createdAt: new Date().toISOString(), uid })
      await db.collection('shareTokens').doc(token).set({ uid, createdAt: new Date().toISOString() })
      return NextResponse.json({ token, enabled: true })
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

    const [itemsSnap, snapshotsSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('items').get(),
      db.collection('users').doc(uid).collection('snapshots').orderBy('date').get(),
    ])

    const SHARE_FIELDS = new Set([
      'name', 'symbol', 'type', 'isDebt', 'isReceivable', 'quantity', 'currentPrice',
      'purchasePrice', 'averagePrice', 'price', 'cost', 'currency', 'incomeRate',
      'dividendYield', 'rateType', 'rateMin', 'rateMax', 'maturityDate', 'incomeMonths',
      'incomeAmount', 'subtype', 'isIlliquid', 'lastManualValuation',
    ])
    const items = itemsSnap.docs.map((d) => {
      const data = d.data()
      const safe = { id: d.id }
      for (const key of SHARE_FIELDS) {
        if (data[key] !== undefined) safe[key] = data[key]
      }
      return safe
    })

    const snapshots = snapshotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

    const prefsDoc = await db.collection('users').doc(uid).collection('settings').doc('preferences').get()
    const baseCurrency = prefsDoc.exists ? prefsDoc.data().baseCurrency || 'USD' : 'USD'

    return NextResponse.json({ items, snapshots, baseCurrency })
  } catch (err) {
    console.error('[api/share] GET error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
