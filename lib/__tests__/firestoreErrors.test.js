import {
  isFirestoreQuotaError,
  firestoreErrorCode,
  isTransientFirestoreError,
  withFirestoreRetry,
  describeFirestoreFailure,
  DEFAULT_RETRY_ATTEMPTS,
} from '../firestoreErrors'

// Un error tal como lo entrega el SDK de Admin: código numérico en `code` y el
// mismo código repetido al principio del mensaje.
const grpc = (code, name, msg = 'boom') => Object.assign(new Error(`${code} ${name}: ${msg}`), { code })

describe('leer el código de un error de Firestore', () => {
  it('del campo, que es donde lo pone el SDK', () => {
    expect(firestoreErrorCode(grpc(14, 'UNAVAILABLE'))).toBe(14)
  })

  it('del texto cuando alguien lo re-lanzó envuelto', () => {
    expect(firestoreErrorCode(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded'))).toBe(8)
  })

  it('null cuando no es un error de Firestore', () => {
    expect(firestoreErrorCode(new Error('algo se rompió'))).toBeNull()
    expect(firestoreErrorCode(null)).toBeNull()
  })
})

describe('qué se reintenta', () => {
  it('los hipos de la conexión y del servidor', () => {
    for (const [code, name] of [[4, 'DEADLINE_EXCEEDED'], [10, 'ABORTED'], [13, 'INTERNAL'], [14, 'UNAVAILABLE']]) {
      expect(isTransientFirestoreError(grpc(code, name))).toBe(true)
    }
  })

  it('la CUOTA no: reintentarla la gasta más rápido', () => {
    expect(isTransientFirestoreError(grpc(8, 'RESOURCE_EXHAUSTED', 'Quota exceeded'))).toBe(false)
  })

  it('permisos y credenciales tampoco: no cambian por insistir', () => {
    expect(isTransientFirestoreError(grpc(7, 'PERMISSION_DENIED'))).toBe(false)
    expect(isTransientFirestoreError(grpc(16, 'UNAUTHENTICATED'))).toBe(false)
  })

  it('un error sin código de Firestore tampoco', () => {
    expect(isTransientFirestoreError(new Error('bug de verdad'))).toBe(false)
  })
})

describe('el reintento', () => {
  it('devuelve el resultado del intento que funciona', async () => {
    let n = 0
    const out = await withFirestoreRetry(async () => {
      n++
      if (n < 3) throw grpc(14, 'UNAVAILABLE')
      return 'ok'
    }, { baseDelayMs: 0 })
    expect(out).toBe('ok')
    expect(n).toBe(3)
  })

  it('un fallo NO transitorio se propaga al primer intento, sin reintentar', async () => {
    let n = 0
    await expect(withFirestoreRetry(async () => {
      n++
      throw grpc(8, 'RESOURCE_EXHAUSTED', 'Quota exceeded')
    }, { baseDelayMs: 0 })).rejects.toThrow(/RESOURCE_EXHAUSTED/)
    expect(n).toBe(1)
  })

  it('se rinde tras el presupuesto y propaga el último error', async () => {
    let n = 0
    await expect(withFirestoreRetry(async () => {
      n++
      throw grpc(14, 'UNAVAILABLE')
    }, { baseDelayMs: 0 })).rejects.toThrow(/UNAVAILABLE/)
    expect(n).toBe(DEFAULT_RETRY_ATTEMPTS)
  })

  it('el presupuesto es chico: del otro lado hay un atajo esperando', () => {
    expect(DEFAULT_RETRY_ATTEMPTS).toBeLessThanOrEqual(3)
  })

  it('sin fallos corre una sola vez', async () => {
    let n = 0
    expect(await withFirestoreRetry(async () => { n++; return 1 })).toBe(1)
    expect(n).toBe(1)
  })
})

describe('cómo se le nombra el fallo al usuario', () => {
  // El único lugar donde ve esto es una notificación en la pantalla de bloqueo:
  // ahí no hay consola, así que la frase tiene que decir qué pasó y qué hacer.
  it('la cuota se explica como límite que se reinicia solo', () => {
    const d = describeFirestoreFailure(grpc(8, 'RESOURCE_EXHAUSTED', 'Quota exceeded'))
    expect(d.kind).toBe('quota')
    expect(d.code).toBe('error:quota')
    expect(d.retryable).toBe(true)
    expect(d.message).toMatch(/límite diario/i)
  })

  it('un transitorio invita a reintentar', () => {
    const d = describeFirestoreFailure(grpc(14, 'UNAVAILABLE'))
    expect(d.kind).toBe('transient')
    expect(d.retryable).toBe(true)
  })

  it('un fallo desconocido NO se presenta como pasajero', () => {
    const d = describeFirestoreFailure(new Error('bug'))
    expect(d.kind).toBe('unknown')
    expect(d.retryable).toBe(false)
    expect(d.code).toBe('error')
  })

  it('el código archivado siempre empieza con "error", que es lo que la UI lee', () => {
    for (const err of [grpc(8, 'RESOURCE_EXHAUSTED'), grpc(14, 'UNAVAILABLE'), grpc(7, 'PERMISSION_DENIED'), new Error('x')]) {
      expect(describeFirestoreFailure(err).code.startsWith('error')).toBe(true)
    }
  })

  it('ninguna frase queda vacía', () => {
    for (const err of [grpc(8, 'RESOURCE_EXHAUSTED'), grpc(4, 'DEADLINE_EXCEEDED'), grpc(16, 'UNAUTHENTICATED'), new Error('x')]) {
      expect(describeFirestoreFailure(err).message.length).toBeGreaterThan(20)
    }
  })
})

describe('isFirestoreQuotaError', () => {
  it('recognizes the real gRPC error string Firestore sends', () => {
    expect(isFirestoreQuotaError('8: 8 RESOURCE_EXHAUSTED: Quota exceeded.')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isFirestoreQuotaError('quota EXCEEDED')).toBe(true)
  })

  it('does not fire on an unrelated error', () => {
    expect(isFirestoreQuotaError('permission-denied: Missing permissions')).toBe(false)
    expect(isFirestoreQuotaError('Internal server error')).toBe(false)
  })

  it('handles null/undefined/empty without throwing', () => {
    expect(isFirestoreQuotaError(null)).toBe(false)
    expect(isFirestoreQuotaError(undefined)).toBe(false)
    expect(isFirestoreQuotaError('')).toBe(false)
  })
})
