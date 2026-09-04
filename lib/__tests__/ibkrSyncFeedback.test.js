import { ibkrFailureFeedback, ibkrCooldownRemainingMs, formatCooldown, FIXABLE_BY_USER, retryCannotFix, ibkrFixActionLabel } from '../ibkrSyncFeedback'

const CODES = ['TOKEN_EXPIRED', 'INVALID_QUERY', 'LOCKED', 'RATE_LIMITED', 'TIMEOUT', 'UNKNOWN', 'ALGO_NUEVO']

describe('ibkrFailureFeedback', () => {
  test('ningún fallo de sincronización se pinta de rojo', () => {
    // La regla del producto: en una app de dinero el rojo tiene que significar
    // algo grave o irreversible. Un token vencido o un broker ocupado no lo son.
    for (const code of CODES) {
      expect(ibkrFailureFeedback(code).tone).toBe('warn')
    }
  })

  test('lo que el usuario puede arreglar lo lleva a la pantalla que lo arregla', () => {
    // Reintentar con el mismo token vencido no puede funcionar, así que el toque
    // tiene que abrir el formulario en vez de gastar otro intento fallido.
    for (const code of FIXABLE_BY_USER) {
      const fb = ibkrFailureFeedback(code)
      expect(fb.action).toBe('open-connection')
      expect(fb.cooldownMs).toBe(0)
    }
  })

  test('lo que NO puede arreglar no le pide nada y se enfría', () => {
    for (const code of ['LOCKED', 'RATE_LIMITED', 'TIMEOUT', 'UNKNOWN']) {
      const fb = ibkrFailureFeedback(code)
      expect(fb.action).toBeNull()
      expect(fb.cooldownMs).toBeGreaterThan(0)
    }
  })

  test('un bloqueo espera mucho más que un fallo pasajero', () => {
    // Reintentar durante un bloqueo lo REFRESCA: es el lazo que este helper
    // existe para cortar.
    expect(ibkrFailureFeedback('LOCKED').cooldownMs)
      .toBeGreaterThan(ibkrFailureFeedback('TIMEOUT').cooldownMs)
  })

  test('un código desconocido cae al caso pasajero, nunca a un callejón sin salida', () => {
    const fb = ibkrFailureFeedback('ALGO_QUE_NO_EXISTE')
    expect(fb.cooldownMs).toBeGreaterThan(0)
    expect(fb.message).toBeTruthy()
  })

  test('cada mensaje dice qué pasa, en los dos idiomas, sin jerga de código', () => {
    for (const code of CODES) {
      for (const lang of ['es', 'en']) {
        const msg = ibkrFailureFeedback(code, lang).message
        expect(msg.length).toBeGreaterThan(20)
        // El código interno nunca se le muestra al usuario.
        expect(msg).not.toMatch(/TOKEN_EXPIRED|INVALID_QUERY|RATE_LIMITED/)
      }
    }
    expect(ibkrFailureFeedback('LOCKED', 'en').message).not.toEqual(ibkrFailureFeedback('LOCKED', 'es').message)
  })
})

describe('un bloqueo que ya no se levanta (FASE KL)', () => {
  const stuck = (lang = 'es') => ibkrFailureFeedback('LOCKED', lang, { failCount: 14 })

  test('deja de decir "no hace falta que hagas nada"', () => {
    // Ese consejo es cierto las primeras horas y falso a la semana: un token
    // vencido produce intentos fallidos, que son lo que refresca el bloqueo,
    // así que esperar es lo único que garantiza que no se arregle.
    const fresh = ibkrFailureFeedback('LOCKED', 'es', { failCount: 0 })
    expect(fresh.message).toMatch(/solo/i)
    expect(stuck().message).not.toEqual(fresh.message)
    expect(stuck().message).toMatch(/token/i)
  })

  test('el toque abre donde se pega el token nuevo, sin enfriamiento', () => {
    // Reintentar con el mismo token no puede funcionar y suma otro intento
    // fallido: mandarlo a esperar otra hora es el consejo exactamente inverso.
    expect(stuck().action).toBe('open-connection')
    expect(stuck().cooldownMs).toBe(0)
  })

  test('sigue en ámbar y en los dos idiomas', () => {
    expect(stuck().tone).toBe('warn')
    expect(stuck('en').message).not.toEqual(stuck('es').message)
    expect(stuck('en').message).toMatch(/token/i)
  })

  test('sin failCount el comportamiento es el de siempre', () => {
    expect(ibkrFailureFeedback('LOCKED').action).toBeNull()
    expect(ibkrFailureFeedback('LOCKED').cooldownMs).toBeGreaterThan(0)
  })
})

describe('enfriamiento', () => {
  test('cuenta hacia abajo y nunca es negativo', () => {
    const now = 1_000_000
    expect(ibkrCooldownRemainingMs(now + 60000, now)).toBe(60000)
    expect(ibkrCooldownRemainingMs(now - 60000, now)).toBe(0)
    expect(ibkrCooldownRemainingMs(null, now)).toBe(0)
    expect(ibkrCooldownRemainingMs(undefined, now)).toBe(0)
  })

  test('el tiempo restante se dice en minutos u horas, redondeado hacia arriba', () => {
    // Hacia arriba a propósito: decir "en ~1 min" cuando faltan 90 segundos
    // invita a tocar otra vez antes de tiempo, que es justo lo que evitamos.
    expect(formatCooldown(90 * 1000, 'es')).toBe('en ~2 min')
    expect(formatCooldown(5 * 60 * 1000, 'es')).toBe('en ~5 min')
    expect(formatCooldown(60 * 60 * 1000, 'es')).toBe('en ~1 hora')
    expect(formatCooldown(120 * 60 * 1000, 'es')).toBe('en ~2 horas')
    expect(formatCooldown(60 * 60 * 1000, 'en')).toBe('in ~1 hour')
  })
})

describe('reintentar cuando reintentar no puede arreglar nada', () => {
  test('todo lo que el usuario tiene que arreglar sale del reintento', () => {
    // El modal ofrecia "Reintentar" sobre un token vencido, o sea el boton mas
    // prominente de la pantalla era la unica accion que garantizaba que el
    // problema no se resolviera: cada toque es otro intento FALLIDO, que es la
    // moneda con la que se compra el bloqueo de IBKR.
    for (const code of ['TOKEN_EXPIRED', 'INVALID_QUERY', 'EMPTY_REPORT', 'LOCKED']) {
      expect(retryCannotFix(code)).toBe(true)
    }
  })

  test('lo transitorio SI se reintenta', () => {
    // Control: sin esto, "no ofrece reintentar" podria pasar por haber dejado
    // de ofrecerlo NUNCA, que romperia el caso comun de un mal rato de IBKR.
    for (const code of ['RATE_LIMITED', 'TIMEOUT', 'UNKNOWN', '', null, undefined]) {
      expect(retryCannotFix(code)).toBe(false)
    }
  })

  test('una Flex Query vacia no promete un reintento que no puede llegar', () => {
    // El reporte sale de la DEFINICION de la query, no del momento en que se
    // pide: reintentar devuelve el mismo reporte vacio para siempre. El default
    // decia "lo reintentamos solos en unos minutos".
    const fb = ibkrFailureFeedback('EMPTY_REPORT')
    expect(fb.action).toBe('open-connection')
    expect(fb.cooldownMs).toBe(0)
    expect(fb.message).not.toMatch(/reintentamos solos/i)
    expect(ibkrFailureFeedback('EMPTY_REPORT', 'en').message).not.toMatch(/retry on our own/i)
  })

  test('el boton que arregla nombra lo que de verdad hay que cambiar', () => {
    // "Pegar un token nuevo" sobre un Query ID inexistente manda al usuario a
    // cambiar justo lo unico que estaba bien.
    expect(ibkrFixActionLabel('INVALID_QUERY', 'es')).toMatch(/Query ID/)
    expect(ibkrFixActionLabel('EMPTY_REPORT', 'es')).toMatch(/Flex Query/)
    expect(ibkrFixActionLabel('TOKEN_EXPIRED', 'es')).toMatch(/token/i)
    expect(ibkrFixActionLabel('LOCKED', 'en')).toMatch(/token/i)
  })

  test('una Flex Query vacia NO detiene el auto-sync', () => {
    // Acotado a proposito: un reporte vacio puede ser una cuenta genuinamente
    // vacia, y detener la cadencia para siempre por eso seria peor que el
    // problema. Lo que se apaga es OFRECER un reintento que no ayuda, no la
    // cadencia diaria, que ya esta acotada por su propio presupuesto.
    const { FATAL_ERROR_CODES } = require('../ibkrSchedule')
    expect(FATAL_ERROR_CODES).not.toContain('EMPTY_REPORT')
  })
})
