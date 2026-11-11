import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { ACTIONS, OrgError } from '@/lib/institutional/store'
import { makeMailer, AUTO_HEADERS } from '@/lib/weeklyBriefBuilder'

// Modo institucional (Fase 1). Única puerta de escritura para organizaciones,
// vínculos asesor-cliente, grants, mensajes, notas y auditoría. Todo vive en
// colecciones que firestore.rules niega al navegador, así que cada operación
// pasa por aquí con el uid verificado. Nada de esto mueve dinero, guarda
// credenciales de terceros ni escribe en los datos financieros de un cliente.

export const maxDuration = 30

async function sendEmail(to, mail) {
  const nodemailer = (await import('nodemailer')).default
  const mailer = makeMailer(nodemailer)
  if (!mailer) return false
  await mailer.transport.sendMail({
    from: mailer.from, to, subject: mail.subject, html: mail.html, text: mail.text,
    ...(mailer.replyTo ? { replyTo: mailer.replyTo } : {}), headers: AUTO_HEADERS,
  })
  return true
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  const auth = await verifyAuth(request)
  if (auth.error) return auth.error
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'SERVER_NOT_CONFIGURED' }, { status: 503 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 }) }
  const { action, ...payload } = body || {}
  const fn = typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null
  if (!fn) return NextResponse.json({ error: 'UNKNOWN_ACTION' }, { status: 400 })

  let email = ''
  let name = ''
  try {
    const u = await getAdminAuth().getUser(auth.uid)
    email = (u.email || '').toLowerCase()
    name = u.displayName || ''
  } catch { /* sin correo: las acciones que lo exigen lo rechazan */ }
  if (!name) {
    try { name = (await db.doc(`users/${auth.uid}/settings/profile`).get()).data()?.name || '' } catch { /* opcional */ }
  }

  const ctx = {
    db, uid: auth.uid, email, name: name || (email ? email.split('@')[0] : ''),
    now: () => Date.now(),
    token: () => crypto.randomBytes(32).toString('hex'),
    hash: (t) => crypto.createHash('sha256').update(String(t)).digest('hex'),
    rand: () => crypto.randomBytes(8).toString('hex'),
    sendEmail,
  }
  try {
    const result = await fn(ctx, payload)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof OrgError) return NextResponse.json({ error: err.code }, { status: err.status })
    console.error('[org]', action, err?.code || '', err?.message)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
