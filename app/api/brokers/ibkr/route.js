import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { retryRequest } from '@/lib/fetchWithRetry'
import { getAdminDb } from '@/lib/firebase-admin'
import { encryptToken, decryptToken } from '@/lib/crypto'
// Pure parse/classify helpers live in lib so they are unit-testable (a Next.js
// route file can only export HTTP handlers, so nothing defined here can be imported
// by jest). See lib/parsers/ibkrFlex.js.
import { classifyError, parseXmlToData } from '@/lib/parsers/ibkrFlex'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FLEX_REQUEST_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest'
const FLEX_FETCH_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement'

const REQUEST_ATTEMPTS = 5
const REQUEST_DELAYS = [0, 5000, 15000, 25000, 40000]
const FETCH_TIMEOUT_MS = 15000
const POLL_TIMEOUT_MS = 10000

// Techo total de la fase de generación, DEBAJO del presupuesto del cliente
// (REQUEST_TIMEOUT_MS en lib/ibkrSync.js). Sin esto, las esperas de arriba suman
// 85s solo de pausas más hasta 15s por intento: el peor caso pasa de dos
// minutos y medio y el cliente ya colgó hace rato. Una respuesta honesta que
// LLEGA vale más que una completa que nadie recibe (lección de FASE HK).
const REQUEST_BUDGET_MS = 85000

// Legacy sync constants (kept for backward compat)
const LEGACY_POLL_ATTEMPTS = 8
const LEGACY_POLL_DELAY_MS = 3000

async function requestFlexReference(token, queryId) {
  const requestUrl = `${FLEX_REQUEST_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`

  const deadline = Date.now() + REQUEST_BUDGET_MS
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    const wait = REQUEST_DELAYS[attempt] || 0
    // No empezar un intento que no cabe: su espera más su propio timeout
    // terminarían pasado el deadline, o sea contestaríamos cuando ya nadie
    // escucha. Mejor rendirse ahora y decirlo.
    if (Date.now() + wait + FETCH_TIMEOUT_MS > deadline) {
      return { error: classifyError('could not be generated') }
    }
    if (wait) await new Promise((r) => setTimeout(r, wait))

    let requestXml
    try {
      const res = await fetch(requestUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      requestXml = await res.text()
    } catch (err) {
      if (attempt === REQUEST_ATTEMPTS - 1) {
        return { error: classifyError(err.name === 'TimeoutError' ? 'timed out' : err.message) }
      }
      continue
    }

    const refMatch = requestXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/)
    if (refMatch) {
      return { referenceCode: refMatch[1] }
    }

    const errMatch = requestXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    const codeMatch = requestXml.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const errMsg = errMatch ? errMatch[1] : ''
    const classified = classifyError(errMsg, codeMatch ? codeMatch[1] : '')

    if (classified.errorCode === 'RATE_LIMITED') {
      if (attempt === REQUEST_ATTEMPTS - 1) return { error: classified }
      continue
    }

    return { error: classified }
  }

  return { error: classifyError('timed out') }
}

async function resolveCredentials(body, uid) {
  let { token, queryId } = body
  if (!queryId) {
    return { error: NextResponse.json({ error: 'Query ID is required' }, { status: 400 }) }
  }

  if (!token || token === '__stored__') {
    const db = getAdminDb()
    if (!db) return { error: NextResponse.json({ error: 'Server not configured' }, { status: 500 }) }
    const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
    if (!doc.exists || !doc.data().flexToken) {
      return { error: NextResponse.json({ error: 'No stored token found. Enter your Flex Token.' }, { status: 400 }) }
    }
    try {
      token = await decryptToken(doc.data().flexToken, uid)
    } catch {
      // A corrupt/undecryptable vault token must read as TOKEN_EXPIRED (re-save),
      // not a raw 500 the UI can't explain.
      return { error: NextResponse.json({ error: 'Tu Flex Token guardado no se pudo leer. Vuelve a guardarlo.', errorCode: 'TOKEN_EXPIRED' }, { status: 400 }) }
    }
    if (!queryId) queryId = doc.data().flexQueryId
  }

  if (typeof token !== 'string' || typeof queryId !== 'string' || token.length > 200 || queryId.length > 50) {
    return { error: NextResponse.json({ error: 'Invalid credentials format' }, { status: 400 }) }
  }

  if (!/^[a-zA-Z0-9]+$/.test(queryId)) {
    return { error: NextResponse.json({ error: 'Invalid query ID format' }, { status: 400 }) }
  }

  return { token, queryId }
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 40 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action } = body

  const validActions = ['sync', 'request-sync', 'poll-sync', 'save-credentials', 'get-credentials']
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // --- NEW: request-sync (Step 1 — get reference code) ---
  if (action === 'request-sync') {
    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    const result = await requestFlexReference(creds.token, creds.queryId)
    if (result.error) {
      return NextResponse.json(result.error, { status: 502 })
    }

    return NextResponse.json({ referenceCode: result.referenceCode, status: 'pending' })
  }

  // --- NEW: poll-sync (Step 2 — poll for result) ---
  if (action === 'poll-sync') {
    const { referenceCode } = body
    if (!referenceCode || typeof referenceCode !== 'string') {
      return NextResponse.json({ error: 'referenceCode is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    const fetchUrl = `${FLEX_FETCH_URL}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(creds.token)}&v=3`

    let fetchXml
    try {
      // A transient blip here used to fail the whole sync after the statement
      // was already generated — retry the download before giving up.
      const fetchRes = await retryRequest(() => fetch(fetchUrl, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }))
      fetchXml = await fetchRes.text()
    } catch (err) {
      const classified = classifyError(err.name === 'TimeoutError' ? 'timed out' : err.message)
      return NextResponse.json({ ...classified, status: 'error' }, { status: 502 })
    }

    if (fetchXml.includes('<FlexStatement') || fetchXml.includes('<OpenPosition')) {
      const data = parseXmlToData(fetchXml)
      if (data.empty) {
        return NextResponse.json({
          errorCode: 'EMPTY_REPORT',
          error: 'El reporte no tiene posiciones ni trades. Verifica que tu Flex Query incluya Open Positions, Trades, Cash Transactions, Cash Report y Equity Summary.',
          status: 'error',
        }, { status: 200 })
      }
      return NextResponse.json({ ...data, status: 'ready' })
    }

    if (fetchXml.includes('Statement generation in progress') || fetchXml.toLowerCase().includes('try again')) {
      return NextResponse.json({ status: 'pending' })
    }

    const errMatch = fetchXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
    if (errMatch) {
      const classified = classifyError(errMatch[1])
      return NextResponse.json({ ...classified, status: 'error' }, { status: 502 })
    }

    return NextResponse.json({ status: 'pending' })
  }

  // --- LEGACY: sync (backward compat, with reduced timeouts) ---
  if (action === 'sync') {
    const creds = await resolveCredentials(body, uid)
    if (creds.error) return creds.error

    try {
      const refResult = await requestFlexReference(creds.token, creds.queryId)
      if (refResult.error) {
        return NextResponse.json(refResult.error, { status: 502 })
      }

      const { referenceCode } = refResult

      for (let i = 0; i < LEGACY_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, LEGACY_POLL_DELAY_MS))
        const fetchUrl = `${FLEX_FETCH_URL}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(creds.token)}&v=3`

        let fetchXml
        try {
          const fetchRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
          fetchXml = await fetchRes.text()
        } catch {
          if (i === LEGACY_POLL_ATTEMPTS - 1) throw new Error('IBKR no respondió a tiempo.')
          continue
        }

        if (fetchXml.includes('<FlexStatement') || fetchXml.includes('<OpenPosition')) {
          const data = parseXmlToData(fetchXml)
          if (data.empty) {
            return NextResponse.json({ error: 'El reporte no tiene posiciones.', errorCode: 'EMPTY_REPORT' }, { status: 200 })
          }
          return NextResponse.json(data)
        }
        if (fetchXml.includes('Statement generation in progress')) continue
        if (fetchXml.toLowerCase().includes('try again')) continue
        const errMatch = fetchXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)
        if (errMatch) throw new Error(errMatch[1])
      }
      throw new Error('Flex statement generation timed out')
    } catch (err) {
      const classified = classifyError(err.message)
      return NextResponse.json(classified, { status: 502 })
    }
  }

  if (action === 'save-credentials') {
    const { token, queryId } = body
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

    try {
      if (token && queryId) {
        const encryptedToken = await encryptToken(token, uid)
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').set({
          flexToken: encryptedToken,
          flexQueryId: queryId,
          updatedAt: new Date().toISOString(),
        })
      } else {
        await db.collection('users').doc(uid).collection('settings').doc('ibkr').delete()
      }
      return NextResponse.json({ saved: true })
    } catch (err) {
      console.error('[api/ibkr] save-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'get-credentials') {
    const db = getAdminDb()
    if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    try {
      const doc = await db.collection('users').doc(uid).collection('settings').doc('ibkr').get()
      if (!doc.exists) return NextResponse.json({ configured: false })
      const data = doc.data()
      return NextResponse.json({
        configured: true,
        flexQueryId: data.flexQueryId,
        hasToken: !!data.flexToken,
        lastSync: data.lastSync || null,
      })
    } catch (err) {
      console.error('[api/ibkr] get-credentials error:', err.message)
      return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
