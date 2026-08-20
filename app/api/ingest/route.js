import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { readIngestDoc, createIngestToken, revokeIngestToken, listIngestTokensWithUsage } from '@/lib/ingestTokens'
import { sweepInbox, imapConfigured } from '@/lib/emailIngest'
import { ruleFromCorrection } from '@/lib/expenseCategorize'
import { FINANCE_CATEGORIES } from '@/lib/financeCategories'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Management API for auto-captured expenses, called from the browser with a
// Firebase ID token (unlike /api/ingest/expense, which the Shortcut calls with an
// opaque token). Handles token lifecycle, the learned category rules, and the
// on-demand mailbox sweep.
//
// The ingest tokens live in a top-level collection the browser cannot reach, so
// every read and write of them has to come through here.

const MAX_RULES = 200

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 503 })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body?.action

  try {
    if (action === 'list') {
      // Con historial de uso: es lo que contesta "¿el atajo llegó siquiera?",
      // que sin este dato hay que deducir de los síntomas.
      const { tokens, rules } = await listIngestTokensWithUsage(db, uid)
      return NextResponse.json({
        tokens,
        rules,
        emailIngest: {
          configured: imapConfigured(),
          address: process.env.NEXT_PUBLIC_INGEST_EMAIL || null,
        },
      })
    }

    if (action === 'create') {
      const { entry, error: createError } = await createIngestToken(db, uid, body.label)
      if (createError) return NextResponse.json({ error: createError }, { status: 400 })
      return NextResponse.json({ token: entry })
    }

    if (action === 'revoke') {
      const { ok, error: revokeError } = await revokeIngestToken(db, uid, body.token)
      if (revokeError) return NextResponse.json({ error: revokeError }, { status: 400 })
      return NextResponse.json({ ok })
    }

    // Teaches the classifier from a manual correction: next time this merchant
    // shows up it lands in the category the user picked.
    if (action === 'learn') {
      const category = String(body.category || '')
      const known = [...FINANCE_CATEGORIES.EXPENSE, ...FINANCE_CATEGORIES.INCOME]
      if (!known.includes(category)) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })
      const rule = ruleFromCorrection(body.merchant, category, body.label)
      if (!rule) return NextResponse.json({ error: 'Invalid rule' }, { status: 400 })

      const { tokens, rules } = await readIngestDoc(db, uid)
      // One rule per merchant: a correction replaces whatever we learned before.
      const next = [...rules.filter((r) => r.match !== rule.match), rule].slice(-MAX_RULES)
      await db.doc(`users/${uid}/settings/ingest`).set(
        { tokens, rules: next, uid, updatedAt: new Date().toISOString() },
        { merge: true }
      )
      return NextResponse.json({ ok: true, rule, rules: next })
    }

    if (action === 'forget') {
      const match = String(body.match || '')
      const { tokens, rules } = await readIngestDoc(db, uid)
      const next = rules.filter((r) => r.match !== match)
      await db.doc(`users/${uid}/settings/ingest`).set(
        { tokens, rules: next, uid, updatedAt: new Date().toISOString() },
        { merge: true }
      )
      return NextResponse.json({ ok: true, rules: next })
    }

    // On-demand version of the daily cron, so nobody has to wait for it. The
    // sweep covers the whole shared mailbox, but every message is routed by the
    // plus-address token, so this can only ever write into the account the token
    // belongs to — never into the caller's.
    if (action === 'sync-email') {
      if (!imapConfigured()) {
        return NextResponse.json({ error: 'Email ingest not configured' }, { status: 503 })
      }
      const summary = await sweepInbox({ db, limit: 50 })
      return NextResponse.json({ ok: true, ...summary })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    // err.code (Firestore/gRPC status) alongside the message: the message
    // alone ("Internal server error") is a generic client-facing string, and
    // without the code a Firestore permission/path failure is indistinguishable
    // from anything else in the Vercel function logs.
    console.error('[api/ingest] POST error:', action, err.code || '', err.message, err.stack)
    // `detail` is deliberately sent to the client, not just logged: this route
    // is authenticated (verifyAuth already ran), the caller is the account
    // owner acting on their own request, and neither of us can otherwise see
    // Vercel's function logs from here. A code+message on screen turns the
    // next screenshot into a real diagnosis instead of another guess.
    const detail = [err.code, err.message].filter((v) => v !== undefined && v !== null && v !== '').join(': ')
    return NextResponse.json({ error: 'Internal server error', detail: detail || undefined }, { status: 500 })
  }
}
