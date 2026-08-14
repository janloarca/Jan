import { scrubEvent, scrubUrl, scrubText, REDACTED } from '../sentryScrub'

describe('scrubUrl', () => {
  test('el Flex Token de IBKR nunca viaja: va en la URL como ?t=', () => {
    const url = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest?t=123456789abcdef&q=1603751&v=3'
    const out = scrubUrl(url)
    expect(out).not.toContain('123456789abcdef')
    expect(out).toContain(`t=${REDACTED}`)
    // El Query ID SÍ se conserva: no es secreto y es justo lo que sirve para
    // diagnosticar de qué cuenta hablamos.
    expect(out).toContain('q=1603751')
    expect(out).toContain('FlexStatementService.SendRequest')
  })

  test('conserva host y ruta, que es lo que sirve para diagnosticar', () => {
    expect(scrubUrl('https://chispu.xyz/api/prices?symbols=AAPL')).toBe('https://chispu.xyz/api/prices?symbols=AAPL')
  })

  test('una URL sin query no se rompe', () => {
    expect(scrubUrl('https://chispu.xyz/dashboard')).toBe('https://chispu.xyz/dashboard')
    expect(scrubUrl('')).toBe('')
    expect(scrubUrl(null)).toBe(null)
  })
})

describe('scrubText', () => {
  test('correos, tokens Bearer y JWT sueltos se redactan', () => {
    expect(scrubText('falló para jan@chispu.xyz')).toBe(`falló para ${REDACTED}`)
    expect(scrubText('Authorization: Bearer abc123def456ghi')).toContain(`Bearer ${REDACTED}`)
    expect(scrubText('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xxxx')).toContain(REDACTED)
  })

  test('un mensaje de error normal pasa intacto', () => {
    const msg = "Cannot access 'showToast' before initialization"
    expect(scrubText(msg)).toBe(msg)
  })
})

describe('scrubEvent', () => {
  test('el usuario viaja SOLO como id, sin correo ni ip', () => {
    const ev = scrubEvent({ user: { id: 'wS1m6mB74BYfY33N7eZQrfXy5dp2', email: 'x@y.com', ip_address: '1.2.3.4' } })
    expect(ev.user).toEqual({ id: 'wS1m6mB74BYfY33N7eZQrfXy5dp2' })
  })

  test('el cuerpo, las cookies y las cabeceras de la petición se descartan enteros', () => {
    // Un cuerpo puede llevar el token de IBKR o datos del portafolio, y no hay
    // ningún caso donde haga falta para arreglar un bug.
    const ev = scrubEvent({
      request: {
        url: 'https://chispu.xyz/api/brokers/ibkr?t=secreto123456',
        data: { token: 'secreto', queryId: '1603751' },
        cookies: { __session: 'abc' },
        headers: { authorization: 'Bearer xyz' },
      },
    })
    expect(ev.request.data).toBeUndefined()
    expect(ev.request.cookies).toBeUndefined()
    expect(ev.request.headers).toBeUndefined()
    expect(JSON.stringify(ev)).not.toContain('secreto')
  })

  test('el mensaje del error se conserva: es todo el punto de reportar', () => {
    const ev = scrubEvent({
      exception: { values: [{ type: 'ReferenceError', value: "Cannot access 'nL' before initialization" }] },
    })
    expect(ev.exception.values[0].value).toContain('Cannot access')
    expect(ev.exception.values[0].type).toBe('ReferenceError')
  })

  test('los breadcrumbs se limpian en profundidad, incluidas sus URLs', () => {
    const ev = scrubEvent({
      breadcrumbs: [
        { category: 'fetch', data: { url: 'https://x.com/a?token=abc123&ok=1', method: 'POST' } },
        { category: 'console', message: 'usuario jan@chispu.xyz entró' },
      ],
    })
    const s = JSON.stringify(ev)
    expect(s).not.toContain('abc123')
    expect(s).not.toContain('jan@chispu.xyz')
    // Lo útil sobrevive.
    expect(s).toContain('ok=1')
    expect(s).toContain('POST')
  })

  test('una clave que se llama como un secreto se redacta aunque esté anidada', () => {
    const ev = scrubEvent({ extra: { ctx: { apiKey: 'AIzaSyXXXX', nivel: { access_token: 'zzz' } } } })
    expect(ev.extra.ctx.apiKey).toBe(REDACTED)
    expect(ev.extra.ctx.nivel.access_token).toBe(REDACTED)
  })

  test('no explota con entradas raras', () => {
    expect(scrubEvent(null)).toBeNull()
    expect(scrubEvent(undefined)).toBeUndefined()
    expect(scrubEvent({})).toEqual({})
  })
})

// --- Guardián de la configuración ---------------------------------------
// Lo de arriba prueba que limpiamos bien. Esto prueba que no se enciendan por
// descuido las cosas que decidimos NO mandar. Un cambio futuro que active PII o
// grabación de sesión falla acá y no en producción.
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const CONFIGS = ['sentry.client.config.js', 'sentry.server.config.js', 'sentry.edge.config.js']

describe('configuración de Sentry', () => {
  test.each(CONFIGS)('%s no arranca sin DSN', (file) => {
    // Sin proyecto configurado la app tiene que comportarse exactamente como
    // antes: mismo patrón que SMTP y el respaldo de precios.
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).toMatch(/if\s*\(dsn\)/)
  })

  test.each(CONFIGS)('%s no manda PII y usa el limpiador', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).toMatch(/sendDefaultPii:\s*false/)
    expect(src).toMatch(/beforeSend:\s*scrubEvent/)
    expect(src).toMatch(/tracesSampleRate:\s*0/)
  })

  test('nadie encendió la grabación de sesión', () => {
    // Replay grabaría la pantalla de alguien mirando su patrimonio y se la
    // mandaría a un tercero. Es la línea que no se cruza.
    const src = fs.readFileSync(path.join(ROOT, 'sentry.client.config.js'), 'utf8')
    expect(src).toMatch(/replaysSessionSampleRate:\s*0/)
    expect(src).toMatch(/replaysOnErrorSampleRate:\s*0/)
  })

  test('el usuario se etiqueta solo con su id, nunca con su correo', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sentry.client.config.js'), 'utf8')
    expect(src).toMatch(/setUser\(uid \? \{ id: uid \} : null\)/)
    expect(src).not.toMatch(/setUser\([^)]*email/)
  })

  test('AuthGate NO importa el SDK: pesa 36 kB en el arranque de toda la app', () => {
    // Medido. AuthGate envuelve todas las pantallas, así que cualquier import
    // suyo termina en el bundle compartido. El puente de window cuesta cero.
    const src = fs.readFileSync(path.join(ROOT, 'components/AuthGate.jsx'), 'utf8')
    expect(src).not.toMatch(/from ['"]@sentry|import\(['"]@sentry/)
    expect(src).toMatch(/__chispuSentryUser/)
  })
})
