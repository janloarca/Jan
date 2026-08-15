import { ibkrFailureFeedback, ibkrCooldownRemainingMs, formatCooldown, FIXABLE_BY_USER } from '../ibkrSyncFeedback'

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
