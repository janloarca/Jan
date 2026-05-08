import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import crypto from 'crypto'

export async function POST(request) {
  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  const body = await request.json()
  const { action } = body

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

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  const tokenDoc = await db.collection('shareTokens').doc(token).get()
  if (!tokenDoc.exists) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  const { uid } = tokenDoc.data()

  const [itemsSnap, snapshotsSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('items').get(),
    db.collection('users').doc(uid).collection('snapshots').orderBy('date').get(),
  ])

  const items = itemsSnap.docs.map((d) => {
    const data = d.data()
    return { id: d.id, ...data, institution: undefined }
  })

  const snapshots = snapshotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  const prefsDoc = await db.collection('users').doc(uid).collection('settings').doc('preferences').get()
  const baseCurrency = prefsDoc.exists ? prefsDoc.data().baseCurrency || 'USD' : 'USD'

  return NextResponse.json({ items, snapshots, baseCurrency })
}
