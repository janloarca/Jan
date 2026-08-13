/**
 * @jest-environment node
 */
// Guardián de la causa de FASE HY.
//
// El SDK de Firebase Auth carga https://apis.google.com/js/api.js inyectando un
// <script> en el <head>. Si la CSP no permite ese host, el navegador lo bloquea,
// el script dispara un Event de error, y Firebase lo envuelve como
// auth/internal-error SIN ningún detalle: no hay respuesta de servidor que
// mirar, no hay ajuste de consola que lo arregle, y falla idéntico en todos los
// dispositivos y en las dos arquitecturas de sign-in. O sea, un síntoma que no
// apunta a su causa por ningún lado. Costó semanas encontrarlo.
//
// Este archivo no tiene ESLint ni nada que revise una cadena de CSP, así que la
// única forma de que un recorte futuro de la política no vuelva a romper el
// sign-in en silencio es fijarlo con un test.
const nextConfig = require('../../next.config')

async function cspFor(path) {
  const rules = await nextConfig.headers()
  // Next aplica, para una misma clave, la ÚLTIMA regla que matchea. Así que la
  // política vigente es la de la última coincidencia, no la primera.
  let csp = null
  for (const rule of rules) {
    const source = rule.source
    const matches = source === path
      || source === '/(.*)'
      || (source.endsWith('/:path*') && path.startsWith(source.replace('/:path*', '')))
    if (!matches) continue
    const found = (rule.headers || []).find((h) => h.key === 'Content-Security-Policy')
    if (found) csp = found.value
  }
  return csp
}

function directive(csp, name) {
  const part = (csp || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `))
  return part || ''
}

describe('CSP y Google sign-in', () => {
  test('la política de la app permite el script que Firebase Auth necesita', async () => {
    const csp = await cspFor('/login')
    expect(csp).toBeTruthy()
    expect(directive(csp, 'script-src')).toContain('https://apis.google.com')
  })

  test('el iframe del helper de OAuth sigue permitido', async () => {
    // frame-src cubre el iframe que el resolver monta; sin él, el mismo flujo
    // muere un paso después de cargar el script.
    const csp = await cspFor('/login')
    const frameSrc = directive(csp, 'frame-src')
    expect(frameSrc === '' || frameSrc.includes('https:') || frameSrc.includes('https://apis.google.com')).toBe(true)
  })

  test('el canje contra Identity Toolkit no está bloqueado por connect-src', async () => {
    const csp = await cspFor('/login')
    const connect = directive(csp, 'connect-src')
    expect(connect === '' || connect.includes('https:') || connect.includes('googleapis.com')).toBe(true)
  })
})
