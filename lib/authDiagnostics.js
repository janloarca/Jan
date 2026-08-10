// Google sign-in has failed with auth/internal-error across several rounds of
// fixes, and every round has been diagnosed by guessing from a screenshot: the
// error the browser surfaces ("an internal error has occurred") names neither
// the piece that broke nor the side it is on. There are only a handful of ways
// the same-origin OAuth helper can be broken, and each one leaves a DIFFERENT
// observable trace that the user's own browser can read in a second.
//
// So this checks them, on the device that is actually failing, and prints a
// result specific enough to act on:
//
//   · our proxy      -- /__/auth and /__/firebase are Next rewrites to the
//                       Firebase helper host. If they 404 or return HTML, the
//                       rewrite is broken or the build had no project id, and
//                       nothing in any Google console will fix it.
//   · the project    -- init.json comes from Firebase itself, so its projectId
//                       proves which project the proxy actually reaches. A
//                       mismatch means the rewrite points somewhere else.
//   · same-origin    -- the helper only avoids Safari's cross-site storage
//                       block when authDomain IS this host. On a preview
//                       domain it deliberately is not, and Google sign-in
//                       failing there says nothing about production.
//   · Google console -- everything above passing while sign-in still fails
//                       narrows it to the two settings only the account owner
//                       can change, and the report says which.
//
// Pure except for the injected fetch, so it can be tested without a network.

export const HELPER_PATHS = {
  init: '/__/firebase/init.json',
  handler: '/__/auth/handler',
}

// Firebase serves the helper from <project>.firebaseapp.com. Anything else in
// authDomain means the same-origin setup is not active on this host.
export function isSameOriginAuth(origin, authDomain) {
  if (!origin || !authDomain) return false
  try {
    return new URL(origin).host === authDomain
  } catch {
    return origin === authDomain
  }
}

async function probe(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { credentials: 'omit' })
    const text = await res.text().catch(() => '')
    // Set by our own /__/firebase route: whether Firebase answered or we filled
    // in for it. Absent on a plain proxy or a cross-origin response.
    const source = res.headers?.get ? res.headers.get('x-helper-source') : null
    return { ok: res.ok, status: res.status, text, source }
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err?.message || 'fetch failed' }
  }
}

export async function runAuthDiagnostics({ origin, authDomain, projectId, lastError = null, fetchImpl = null } = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  const checks = []
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail })

  add('origin', 'Dominio', 'info', origin || 'desconocido')
  add('authDomain', 'authDomain en uso', 'info', authDomain || 'sin configurar')

  const sameOrigin = isSameOriginAuth(origin, authDomain)
  add('same-origin', 'Helper en nuestro dominio', sameOrigin ? 'ok' : 'warn',
    sameOrigin
      ? 'sí (es lo que evita el bloqueo de Safari)'
      : 'no: este dominio usa el helper de Firebase. Solo pasa en previews y en local.')

  if (!f) {
    add('proxy', 'Proxy del helper', 'warn', 'no se pudo probar en este navegador')
    return { checks, summary: buildSummary(checks, lastError) }
  }

  const init = await probe(f, HELPER_PATHS.init)
  if (init.ok) {
    let parsed = null
    try { parsed = JSON.parse(init.text) } catch {}
    if (!parsed) {
      // A 200 that is not JSON is the app's own page: the rewrite never matched.
      add('proxy', 'Proxy /__/firebase', 'fail', 'responde 200 pero no es JSON: el rewrite no está aplicando')
    } else {
      add('proxy', 'Proxy /__/firebase', 'ok',
        init.source === 'local'
          ? 'responde con nuestra config de respaldo (Firebase Hosting no la sirve)'
          : 'responde la config real de Firebase')
      const reached = parsed.projectId || parsed.projectID || null
      const matches = !projectId || !reached || reached === projectId
      add('project', 'Proyecto alcanzado', matches ? 'ok' : 'fail',
        matches ? (reached || 'sin projectId en la respuesta')
          : `el proxy llega a "${reached}" y la app usa "${projectId}"`)
    }
  } else {
    add('proxy', 'Proxy /__/firebase', 'fail',
      init.error ? `no respondió (${init.error})` : `respondió ${init.status}`)
  }

  const handler = await probe(f, HELPER_PATHS.handler)
  // The handler answers 400 without OAuth parameters, which still proves the
  // proxy reaches it. Only a 404 or a network failure means it is unreachable.
  const handlerReached = handler.status > 0 && handler.status !== 404
  add('handler', 'Página de OAuth', handlerReached ? 'ok' : 'fail',
    handlerReached ? `alcanzable (HTTP ${handler.status})`
      : (handler.error ? `no respondió (${handler.error})` : `respondió ${handler.status}`))

  const proxyOk = checks.every((c) => c.status !== 'fail')
  if (proxyOk && lastError) {
    // Nothing on our side is broken, so what is left is the pair of console
    // settings only the account owner can change.
    add('console', 'Queda revisar en consola', 'warn',
      `1) Firebase Console > Authentication > Settings > Authorized domains debe incluir ${hostOf(origin)}. `
      + `2) Google Cloud Console > Credentials > cliente OAuth web: ${origin} en "JavaScript origins" y ${origin}${HELPER_PATHS.handler} en "Authorized redirect URIs".`)
  }

  return { checks, summary: buildSummary(checks, lastError) }
}

function hostOf(origin) {
  try { return new URL(origin).host } catch { return origin || 'tu dominio' }
}

// A single block the user can copy out of a phone, where there is no console.
export function buildSummary(checks, lastError) {
  const lines = checks.map((c) => `${symbolFor(c.status)} ${c.label}: ${c.detail}`)
  if (lastError) lines.push(`✖ Último error: ${lastError}`)
  return lines.join('\n')
}

function symbolFor(status) {
  if (status === 'ok') return '✔'
  if (status === 'fail') return '✖'
  if (status === 'warn') return '!'
  return '·'
}
