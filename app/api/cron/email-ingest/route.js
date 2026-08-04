import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { sweepInbox } from '@/lib/emailIngest'

export const dynamic = 'force-dynamic'
// IMAP + parsing a batch of messages needs more than the default budget.
export const maxDuration = 60

// Scheduled sweep of the forwarding mailbox (ingest path C).
//
// vercel.json fires this daily. Daily is a plan constraint, not a design choice:
// Vercel's Hobby tier only runs cron jobs once a day. The split is deliberate
// anyway — the Shortcut (path A) captures Apple Pay charges instantly, and this
// sweep is the once-a-day net that catches everything else (physical swipes,
// online charges, any card not in Wallet). Users who don't want to wait can hit
// "Sincronizar ahora" in Settings, which runs the same sweep.
//
// Gating: CRON_SECRET to authenticate the caller, IMAP_* to do anything at all.
// Missing IMAP config is a silent no-op, matching /api/cron/finance-reminder.

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Admin not configured' }, { status: 503 })

  try {
    const summary = await sweepInbox({ db, limit: 100 })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[cron/email-ingest] sweep failed:', err.message)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
