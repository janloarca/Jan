import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { resolveIngestToken, readUserRules, readUserBaseCurrency, stampIngestResult } from '@/lib/ingestTokens'
import { expenseFromAlert } from '@/lib/alertIngest'
import { normalizeExpenseInput, ingestExpense, explainIngestError, INGEST_SOURCES } from '@/lib/expenseIngest'

// De qué transporte dice venir la captura. Se acepta del cuerpo pero SOLO de la
// lista cerrada: no es una frontera de seguridad (esa es el token), pero sí
// decide el id determinístico del documento, así que un valor libre dejaría que
// un cliente se saliera del espacio de dedup de su propia cuenta.
function sourceOf(body) {
  const s = String(body?.source || '').toLowerCase()
  return INGEST_SOURCES.includes(s) ? s : 'shortcut'
}

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
//     "date": "2026-08-03", "occurredAt": "2026-08-03T14:32:00-06:00",
//     "lat": 14.57, "lon": -90.48, "clientId": "..." }
//
// `occurredAt` is optional but worth sending: the hour is what separates one
// charge captured twice (Wallet AND the forwarded alert) from two identical
// charges at the same place. Without it the arrival time is used instead, which
// is close enough here because the automation fires at the register — see
// lib/sameCharge.js.
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

    // Dos formas de mandar el mismo gasto, y la diferencia es de dónde sale el
    // dato, no de qué se hace con él:
    //
    //   estructurada — el atajo de iOS ya trae monto y comercio separados,
    //                  porque Wallet se los entrega así.
    //   texto crudo  — Android manda el push del banco tal cual lo mostró la
    //                  pantalla, y el parseo pasa acá.
    //
    // El parseo va en el SERVIDOR y no en la app de automatización a propósito:
    // ese parser ya resuelve la ambigüedad del "$" contra la moneda del usuario,
    // las dos convenciones de número de LatAm y la diferencia entre un cobro y un
    // reverso. Meterlo en Tasker o MacroDroid sería una segunda copia que se
    // queda atrás, y el usuario que la configuró no tiene cómo darse cuenta.
    const rawText = typeof body?.text === 'string' ? body.text : ''
    const rawTitle = typeof body?.title === 'string' ? body.title : ''
    // La hora de LLEGADA sirve como instante de la compra en los dos caminos: el
    // atajo dispara en la caja y el push del banco llega en segundos.
    const receivedAt = new Date().toISOString()

    let input
    let alertSkip = null
    if (rawText || rawTitle) {
      // La moneda base decide qué significa un "$" suelto: para una tarjeta
      // mexicana son pesos, y leerlos como dólares multiplica el cobro por el
      // tipo de cambio, en silencio.
      const base = await readUserBaseCurrency(db, resolved.uid)
      // Sin offset a propósito: un push no trae zona horaria, y no la necesita.
      // Llega en segundos, así que la hora de llegada es mejor dato que una hora
      // de pared impresa en el texto sin zona con qué colocarla.
      const out = expenseFromAlert({
        subject: rawTitle,
        text: rawText,
        receivedAt,
        defaultCurrency: base || 'GTQ',
        source: sourceOf(body),
      })
      input = out.input
      alertSkip = out.skip || null
    } else {
      input = normalizeExpenseInput({
        receivedAt,
        ...body,
        source: sourceOf(body),
      })
    }

    // Un reverso o un texto que no era una alerta NO son fallos: son resultados
    // legítimos, y decirlos como error haría que el usuario persiguiera un
    // problema que no existe.
    if (alertSkip) {
      await stampIngestResult(db, token, alertSkip)
      return NextResponse.json({ ok: true, status: 'skipped', reason: alertSkip, message: explainIngestError(alertSkip) })
    }
    // El error viaja con una frase legible además del código, porque el único
    // lugar donde el usuario lo ve es una notificación del teléfono: ahí no hay
    // consola, ni logs, ni forma de preguntar nada. Un código suelto obliga a
    // una ronda de diagnóstico por cada fallo (la lección de "Reparar ahora").
    if (input.error) {
      // Se deja constancia también del fallo: "el atajo llegó y lo rechazamos"
      // y "el atajo nunca llegó" son diagnósticos opuestos y desde afuera se ven
      // igual (no aparece el gasto).
      await stampIngestResult(db, token, input.error)
      return NextResponse.json({ error: input.error, message: explainIngestError(input.error) }, { status: 400 })
    }

    const rules = await readUserRules(db, resolved.uid)
    const result = await ingestExpense({ db, uid: resolved.uid, input, rules })
    await stampIngestResult(db, token, result.status)

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
