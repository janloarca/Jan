import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAdminDb } from '@/lib/firebase-admin'
import { buildFinanceReminderEmail } from '@/lib/financeReminderEmail'

export const dynamic = 'force-dynamic'

// Month-end reminder: users who opted in ("Recordarme por correo si no he
// llenado el mes") get ONE email when the month is about to close and their
// financeTransactions for the current month are still empty.
//
// Scheduling: vercel.json fires this daily at 15:00 UTC on days 25-31; the
// route itself only acts within the last 2 days of the month, and stamps
// _lastFinanceReminder = 'YYYY-MM' on the user's preferences so a user is
// never emailed twice for the same month.
//
// Sending: plain SMTP against the mailbox of our own domain (e.g. a free Zoho
// Mail account hosting recordatorios@chispu.xyz) — no third-party sending
// service. Any SMTP host works; nothing here is provider-specific.
//
// Gating (repo convention: silent no-op when unconfigured):
//   CRON_SECRET — Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
//   SMTP_HOST / SMTP_USER / SMTP_PASS — mailbox credentials (app password)
//   SMTP_PORT — optional, defaults to 465 (implicit TLS)
//   SMTP_FROM — optional, defaults to 'Chispudo <SMTP_USER>'. Para mandar
//     desde un no-reply, apuntarla a una dirección que EXISTA en el buzón
//     (alias del mismo usuario): casi todo host SMTP rechaza o reescribe un
//     From que la cuenta autenticada no posee.
//   SMTP_REPLY_TO — optional. Sin ella no se manda cabecera Reply-To, que es
//     justo lo correcto para un correo automático: el cliente responde al
//     From, que ya es el no-reply y lo dice en el cuerpo.

function lastDayOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized', errorCode: 'BAD_REQUEST' }, { status: 401 })
  }

  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({ ok: true, skipped: 'SMTP not configured' })
  }
  const db = getAdminDb()
  if (!db) {
    return NextResponse.json({ error: 'Admin not configured', errorCode: 'INTERNAL' }, { status: 503 })
  }

  const now = new Date()
  const day = now.getUTCDate()
  const last = lastDayOfMonth(now)
  // Only act in the closing window (D-1 and D) — the cron fires daily on 25-31.
  if (day < last - 1) {
    return NextResponse.json({ ok: true, skipped: `day ${day}/${last}, not in closing window` })
  }

  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const from = process.env.SMTP_FROM || `Chispudo <${SMTP_USER}>`
  const replyTo = process.env.SMTP_REPLY_TO || null
  const port = Number(process.env.SMTP_PORT) || 465
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS is negotiated on 587
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15000,
    socketTimeout: 15000,
  })

  // All opted-in users: settings docs live at users/{uid}/settings/preferences.
  const snap = await db.collectionGroup('settings').where('financeReminder', '==', true).get()

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const doc of snap.docs) {
    try {
      if (doc.id !== 'preferences') { skipped++; continue }
      const prefs = doc.data()
      const uid = doc.ref.parent.parent?.id
      const email = (prefs.financeReminderEmail || '').trim()
      if (!uid || !email || !email.includes('@')) { skipped++; continue }
      if (prefs._lastFinanceReminder === monthKey) { skipped++; continue }

      // Did they already fill the month? Any finance transaction dated this month counts.
      const txs = await db.collection(`users/${uid}/financeTransactions`)
        .where('date', '>=', `${monthKey}-01`)
        .where('date', '<=', `${monthKey}-31`)
        .limit(1)
        .get()
      if (!txs.empty) { skipped++; continue }

      const lang = prefs.financeReminderLang === 'en' ? 'en' : 'es'
      const monthLabel = `${(lang === 'en' ? MONTHS_EN : MONTHS_ES)[now.getUTCMonth()]} ${now.getUTCFullYear()}`
      const { subject, html, text } = buildFinanceReminderEmail(lang, monthLabel)

      // Cabeceras de correo AUTOMÁTICO (RFC 3834 + la variante de Outlook):
      // le dicen a los auto-respondedores ("estoy de vacaciones") que NO
      // contesten. Sin esto, cada respuesta automática rebota contra un buzón
      // que nadie lee. Es la mitad de protocolo de un no-reply; la otra mitad
      // es que el cuerpo lo diga, y eso vive en el template.
      await transport.sendMail({
        from,
        to: email,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        },
      })
      await doc.ref.set({ _lastFinanceReminder: monthKey }, { merge: true })
      sent++
    } catch (e) {
      console.error('[cron/finance-reminder] user failed:', e.message)
      failed++
    }
  }

  transport.close()
  return NextResponse.json({ ok: true, monthKey, optedIn: snap.size, sent, skipped, failed })
}
