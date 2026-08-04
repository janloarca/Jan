import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { resolveIngestToken, readUserRules } from '@/lib/ingestTokens'
import { normalizeExpenseInput, ingestExpense } from '@/lib/expenseIngest'

export const dynamic = 'force-dynamic'

// Ingest path A: the iPhone Shortcut.
//
// Wired to the Shortcuts "Transaction" personal automation, which fires on every
// Apple Pay charge and hands the shortcut the merchant and the amount. The
// shortcut adds the current location and POSTs here:
//
//   POST /api/ingest/expense
//   Authorization: Bearer <ingest token>
//   { "amount": 17, "currency": "GTQ", "merchant": "Rally Padel Guatemala",
//     "date": "2026-08-03", "lat": 14.57, "lon": -90.48, "clientId": "..." }
//
// Auth is the opaque ingest token, not a Firebase ID token: Shortcuts can only
// attach a static header. See lib/ingestTokens.js for the trust model.
//
// The response tells the shortcut what happened so it can show a notification
// ("Gasto agregado: Entretenimiento") without a second round trip.

function bearer(request) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

export async function POST(request) {
  // Tighter than the browser APIs: a runaway automation loop should hit a wall
  // long before it fills someone's month with junk.
  const { limited } = await rateLimit(request, { maxRequests: 20 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const token = bearer(request)
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 })

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 503 })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const resolved = await resolveIngestToken(db, token)
    if (!resolved) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const input = normalizeExpenseInput({ ...body, source: 'shortcut' })
    if (input.error) return NextResponse.json({ error: input.error }, { status: 400 })

    const rules = await readUserRules(db, resolved.uid)
    const result = await ingestExpense({ db, uid: resolved.uid, input, rules })

    return NextResponse.json({
      ok: true,
      status: result.status, // 'created' | 'duplicate'
      id: result.id,
      category: result.transaction?.category || result.duplicateOf?.category || null,
      amount: input.amount,
      currency: input.currency,
      merchant: input.merchant || null,
      needsReview: result.transaction?._needsReview || false,
    })
  } catch (err) {
    console.error('[api/ingest/expense] error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
