import { runAuthDiagnostics, isSameOriginAuth, HELPER_PATHS } from '../authDiagnostics'

const ORIGIN = 'https://chispu.xyz'
const PROJECT = 'chispudo'

// Minimal fetch double: a map of path -> {status, body}.
const fetchWith = (routes) => (url) => {
  const path = url.startsWith('http') ? new URL(url).pathname : url
  const r = routes[path]
  if (!r) return Promise.reject(new Error('network'))
  return Promise.resolve({
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    text: () => Promise.resolve(r.body ?? ''),
    headers: { get: (k) => (k === 'x-helper-source' ? (r.source ?? null) : null) },
  })
}
const healthy = {
  [HELPER_PATHS.init]: { status: 200, body: JSON.stringify({ projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }) },
  [HELPER_PATHS.handler]: { status: 400, body: 'missing params' },
}
const run = (routes, over = {}) => runAuthDiagnostics({
  origin: ORIGIN, authDomain: 'chispu.xyz', projectId: PROJECT, lastError: 'auth/internal-error',
  fetchImpl: fetchWith(routes), ...over,
})
const byId = (res, id) => res.checks.find((c) => c.id === id)

describe('isSameOriginAuth', () => {
  test('true only when the helper is served from this very host', () => {
    expect(isSameOriginAuth('https://chispu.xyz', 'chispu.xyz')).toBe(true)
    expect(isSameOriginAuth('https://chispu.xyz', 'chispudo.firebaseapp.com')).toBe(false)
    expect(isSameOriginAuth('https://preview.vercel.app', 'chispudo.firebaseapp.com')).toBe(false)
    expect(isSameOriginAuth(null, 'chispu.xyz')).toBe(false)
  })
})

describe('runAuthDiagnostics', () => {
  test('everything healthy points at the two console settings, and names them', async () => {
    const res = await run(healthy)
    expect(byId(res, 'proxy').status).toBe('ok')
    expect(byId(res, 'project').status).toBe('ok')
    expect(byId(res, 'handler').status).toBe('ok')
    // The whole point: when our side is clean, say precisely what is left.
    const console_ = byId(res, 'console')
    expect(console_).toBeDefined()
    expect(console_.detail).toContain('Authorized domains')
    expect(console_.detail).toContain(`${ORIGIN}${HELPER_PATHS.handler}`)
  })

  test('says when the config came from our fallback instead of Firebase', async () => {
    // The reported failure: Hosting answers 404 for init.json while /__/auth
    // keeps working, so the helper had no config to start from. Now our route
    // fills in, and the report must not pretend Firebase served it.
    const res = await run({ ...healthy, [HELPER_PATHS.init]: { ...healthy[HELPER_PATHS.init], source: 'local' } })
    expect(byId(res, 'proxy').status).toBe('ok')
    expect(byId(res, 'proxy').detail).toContain('respaldo')

    const upstream = await run({ ...healthy, [HELPER_PATHS.init]: { ...healthy[HELPER_PATHS.init], source: 'upstream' } })
    expect(upstream.checks.find((c) => c.id === 'proxy').detail).toContain('real de Firebase')
  })

  test('a rewrite that never matched is caught by the 200 that is not JSON', async () => {
    // The app's own HTML answering /__/firebase/init.json means the rewrite is
    // not applying, and no console setting anywhere would fix that.
    const res = await run({ ...healthy, [HELPER_PATHS.init]: { status: 200, body: '<!doctype html><html>' } })
    expect(byId(res, 'proxy').status).toBe('fail')
    expect(byId(res, 'console')).toBeUndefined()
  })

  test('a proxy pointing at the wrong project is named, not just failed', async () => {
    const res = await run({ ...healthy, [HELPER_PATHS.init]: { status: 200, body: JSON.stringify({ projectId: 'otro-proyecto' }) } })
    const proj = byId(res, 'project')
    expect(proj.status).toBe('fail')
    expect(proj.detail).toContain('otro-proyecto')
    expect(proj.detail).toContain(PROJECT)
  })

  test('a 404 on the helper is our proxy, not Google', async () => {
    const res = await run({ ...healthy, [HELPER_PATHS.handler]: { status: 404, body: '' } })
    expect(byId(res, 'handler').status).toBe('fail')
  })

  test('the handler answering 400 without OAuth params still counts as reachable', async () => {
    // It has no code/state to work with; that it answers at all proves the
    // proxy reaches it, which is what this check is for.
    expect(byId(await run(healthy), 'handler').detail).toContain('400')
  })

  test('a domain that is not set up for same-origin auth says so instead of failing', async () => {
    // Preview deployments are SUPPOSED to use the Firebase helper, so Google
    // failing there proves nothing about production.
    const res = await run(healthy, { origin: 'https://preview.vercel.app', authDomain: `${PROJECT}.firebaseapp.com` })
    expect(byId(res, 'same-origin').status).toBe('warn')
  })

  test('a network failure is reported as such, never as a passing check', async () => {
    const res = await run({})
    expect(byId(res, 'proxy').status).toBe('fail')
    expect(byId(res, 'handler').status).toBe('fail')
  })

  test('the summary is one copyable block carrying the original error', async () => {
    const res = await run(healthy)
    expect(res.summary).toContain('auth/internal-error')
    expect(res.summary.split('\n').length).toBe(res.checks.length + 1)
  })

  test('no console step is offered when sign-in never actually failed', async () => {
    const res = await run(healthy, { lastError: null })
    expect(byId(res, 'console')).toBeUndefined()
  })
})
