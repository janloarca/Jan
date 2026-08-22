// Ingest path C: forwarded bank alert emails.
//
// Shape of the flow, and why it is built this way:
//   1. The user sets a rule in their mail client that forwards their bank's card
//      alerts to <mailbox>+<ingest token>@ourdomain. The local part is not
//      matched on, so this is the mailbox that already sends our own mail
//      rather than a second one created for the purpose.
//   2. This sweep logs into ONE mailbox on our own domain over IMAP (same
//      "no third-party service, our own mailbox" call as the finance reminder
//      SMTP) and reads what arrived.
//   3. The plus-address label identifies the user. Routing on an unguessable
//      token rather than on the From: header matters: From: is trivially
//      spoofable, so matching on it would let anyone write expenses into another
//      user's account. The token is the credential; the sender is not trusted.
//
// Gating follows the repo convention: without IMAP_* env vars this is a silent
// no-op, so the deploy is safe before the mailbox exists.
//
// Everything except the IMAP I/O is pure and tested (extractIngestToken plus the
// parser in lib/parsers/bankAlertParser.js).

import { expenseFromAlert } from './alertIngest'
import { resolveIngestToken, readUserRules, readUserBaseCurrency, TOKEN_RE } from './ingestTokens'
import { ingestExpense } from './expenseIngest'
import { zoneOffsetFromDateHeader } from './sameCharge'
import { isTransientFirestoreError, withFirestoreRetry } from './firestoreErrors'

// Recipient headers, in order of trust. Auto-forwarding rewrites the envelope
// recipient but leaves the original To: alone, so Delivered-To / X-Original-To
// are the headers that actually carry our plus-address; To/Cc are the fallback
// for a manual forward.
const RECIPIENT_HEADERS = ['delivered-to', 'x-original-to', 'x-forwarded-to', 'envelope-to', 'to', 'cc']

const PLUS_TOKEN = /\+([a-f0-9]{32})@/i

// headers: a Map or plain object of lowercased header name → string (or string[]).
export function extractIngestToken(headers) {
  const get = (name) => {
    const v = headers instanceof Map ? headers.get(name) : headers?.[name]
    if (Array.isArray(v)) return v.join(' ')
    return typeof v === 'string' ? v : ''
  }
  for (const name of RECIPIENT_HEADERS) {
    const match = get(name).match(PLUS_TOKEN)
    if (match && TOKEN_RE.test(match[1].toLowerCase())) return match[1].toLowerCase()
  }
  return null
}

export function imapConfigured() {
  const { IMAP_HOST, IMAP_USER, IMAP_PASS } = process.env
  return Boolean(IMAP_HOST && IMAP_USER && IMAP_PASS)
}

function imapConfig() {
  const port = Number(process.env.IMAP_PORT) || 993
  return {
    host: process.env.IMAP_HOST,
    port,
    secure: port === 993, // implicit TLS on 993; STARTTLS is negotiated otherwise
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
    // Serverless: never let a stalled socket hold the function open.
    socketTimeout: 20000,
    greetingTimeout: 10000,
  }
}

// The Date header exactly as it was written, offset included. mailparser hands
// back `parsed.date` already resolved to an absolute Date, which loses the very
// thing needed here: the sender's zone.
function rawDateHeader(parsed) {
  const line = (parsed?.headerLines || []).find((h) => h?.key === 'date')?.line
  return line ? String(line).replace(/^date\s*:\s*/i, '') : null
}

// Processes one already-parsed message. Split out from the IMAP loop so the
// decision logic can be exercised without a mail server.
export async function ingestParsedEmail({ db, parsed, headers }) {
  const token = extractIngestToken(headers)
  if (!token) return { status: 'unmatched', reason: 'no-token' }

  const resolved = await resolveIngestToken(db, token)
  if (!resolved) return { status: 'unmatched', reason: 'unknown-token' }

  // La moneda base del usuario decide qué significa un '$' suelto en la alerta.
  // Se lee ANTES de parsear porque el parser la necesita: para una tarjeta
  // mexicana "$1,234" son pesos, y leerlos como dólares multiplica el cobro por
  // el tipo de cambio, en silencio. Sin dato, GTQ, que es el comportamiento de
  // siempre.
  const base = await readUserBaseCurrency(db, resolved.uid)
  const { input, skip } = expenseFromAlert({
    subject: parsed.subject || '',
    text: parsed.text || '',
    html: parsed.html || '',
    // La cabecera Date del MENSAJE, NUNCA el reloj del barrido: el barrido corre
    // una vez al día, así que "ahora" acá estaría hasta 24h después de la compra
    // y haría que cada alerta pareciera un cobro distinto.
    receivedAt: parsed.date || null,
    defaultCurrency: base || 'GTQ',
    source: 'email',
    // La zona con la que colocar la hora de pared que imprime la alerta. Sale de
    // la cabecera Date del propio mensaje: leerla como UTC del servidor guardaría
    // una compra de las 14:32 en UTC-6 seis horas corrida.
    offsetMinutes: zoneOffsetFromDateHeader(rawDateHeader(parsed)),
  })
  if (skip) return { status: 'skipped', reason: skip }
  if (input.error) return { status: 'skipped', reason: input.error }

  // Reintento acotado por la misma razón que en la ruta del atajo, y acá pesa
  // más: el barrido corre una vez al día, así que sin esto un hipo de la base
  // atrasa el gasto 24 horas aunque el mensaje quede sin leer.
  const rules = await withFirestoreRetry(() => readUserRules(db, resolved.uid), { label: 'email/rules' })
  const result = await withFirestoreRetry(
    () => ingestExpense({ db, uid: resolved.uid, input, rules }),
    { label: 'email/write' }
  )
  return { status: result.status, id: result.id, uid: resolved.uid, reason: result.reason }
}

// Sweeps the mailbox. Only unseen messages are considered.
//
// What gets marked \Seen, and why it is not simply "everything we looked at":
// this now runs against the SAME mailbox that sends the reminder and brief
// emails, so its inbox also receives bounces, auto-replies and anything else
// addressed to a human. Marking those read would be a background job quietly
// deciding what the owner has already seen — a bounce would disappear before
// anyone noticed it. A message with no ingest token in its recipient headers is
// not ours, so it is left exactly as it was found.
//
// The original reason for marking everything still holds where it applies: a
// message that IS addressed to us and then fails would otherwise be reprocessed
// forever, so those are marked. Leaving a non-ours message unseen costs one
// regex per sweep, not a wedge — nothing is parsed and the database is never
// touched before the token check.
//
// Newest first for the same reason: in a shared mailbox a backlog of unread
// mail that is not ours would otherwise consume the batch budget and starve
// today's actual alerts.
export async function sweepInbox({ db, limit = 50 } = {}) {
  if (!imapConfigured()) return { skipped: 'IMAP not configured' }
  if (!db) throw new Error('Admin DB not configured')

  const { ImapFlow } = await import('imapflow')
  const { simpleParser } = await import('mailparser')

  const client = new ImapFlow(imapConfig())
  // `ours` separates "nothing arrived" from "mail arrived and none of it carried
  // a token", which look identical from outside and mean very different things:
  // the second says the forwarding rule is sending to the wrong address.
  const summary = { scanned: 0, ours: 0, created: 0, duplicates: 0, skipped: 0, unmatched: 0, failed: 0 }

  await client.connect()
  let lock
  try {
    lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX')
    const uids = await client.search({ seen: false }, { uid: true })
    const batch = (uids || []).slice().sort((a, b) => b - a).slice(0, limit)

    for (const uid of batch) {
      summary.scanned++
      try {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })
        if (!msg?.source) { summary.failed++; continue }
        const parsed = await simpleParser(msg.source)

        // mailparser exposes headers as a Map keyed by lowercased name; address
        // headers come back as objects, so fall back to their rendered text.
        const headers = new Map()
        for (const [key, value] of parsed.headers || []) {
          headers.set(key, typeof value === 'string' ? value : (value?.text || ''))
        }

        const result = await ingestParsedEmail({ db, parsed, headers })
        if (result.status === 'created') summary.created++
        else if (result.status === 'duplicate') summary.duplicates++
        else if (result.status === 'unmatched') summary.unmatched++
        else summary.skipped++

        // Addressed to us — ours to consume, whatever the outcome.
        if (result.reason !== 'no-token') {
          summary.ours++
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {})
        }
      } catch (err) {
        // Marcarlo leído es el guard contra el atasco: un mensaje que falla
        // SIEMPRE (viene malformado, el parser no puede con él) se reprocesaría
        // en cada barrido para siempre.
        //
        // Pero un hipo de Firestore no es ese caso, y hasta ahora se trataban
        // igual: el mensaje quedaba leído, el barrido corre una vez al día y
        // solo mira lo no leído, así que ese gasto se perdía PARA SIEMPRE por
        // un fallo que el siguiente intento habría resuelto. Un transitorio se
        // deja sin leer; el atasco no vuelve porque un fallo determinístico no
        // trae código de Firestore y sigue marcándose igual que antes.
        const transient = isTransientFirestoreError(err)
        console.error(`[emailIngest] message failed${transient ? ' (transitorio, se reintenta)' : ''}:`, err.message)
        summary.failed++
        if (!transient) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {})
      }
    }
  } finally {
    if (lock) lock.release()
    await client.logout().catch(() => client.close())
  }

  return summary
}
