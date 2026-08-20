import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { sweepInbox } from '@/lib/emailIngest'

export const dynamic = 'force-dynamic'
// IMAP + parsing a batch of messages needs more than the default budget.
export const maxDuration = 60

// Sweep of the forwarding mailbox (ingest path C), on demand.
//
// NOT in vercel.json any more. The Hobby tier allows two cron jobs and this was
// the third declared, so it was never actually scheduled — and because the email
// path had never been switched on, nothing revealed that. The daily sweep now
// rides along in /api/cron/notifications, which already runs every day.
//
// This route stays because it is the way to run the sweep deliberately: from a
// terminal with CRON_SECRET, or by adding it back as a cron on a plan with room.
// "Sincronizar ahora" in Settings runs the same sweep as the signed-in user.
//
// Daily is a plan constraint, not a design choice. The split is deliberate
// anyway — the Shortcut (path A) captures Apple Pay charges instantly, and this
// sweep is the net that catches everything else (physical swipes, online
// charges, any card not in Wallet).
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
