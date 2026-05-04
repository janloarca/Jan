import { NextResponse } from 'next/server'
import { getAdminAuth } from './firebase-admin'

export async function verifyAuth(request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const token = authHeader.slice(7)
  const adminAuth = getAdminAuth()

  if (!adminAuth) {
    console.error('Firebase Admin not configured — skipping auth verification')
    return { uid: 'unverified' }
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return { uid: decoded.uid }
  } catch (err) {
    console.error('Token verification failed:', err.code)
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}
