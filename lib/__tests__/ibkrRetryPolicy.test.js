import {
  ibkrSyncIntervalMs, nextFailCount, ibkrLockIsStuck,
  NORMAL_INTERVAL_MS, BACKOFF_INTERVAL_MS, REPEATED_FAILURE_THRESHOLD,
  LOCK_GIVE_UP_ATTEMPTS,
} from '../ibkrRetryPolicy'
import { classifyError } from '../parsers/ibkrFlex'

describe('ibkrSyncIntervalMs', () => {
  it('cadencia normal cuando todo va bien', () => {
    expect(ibkrSyncIntervalMs()).toBe(NORMAL_INTERVAL_MS)
    expect(ibkrSyncIntervalMs({ errorCode: null, failCount: 0 })).toBe(NORMAL_INTERVAL_MS)
  })

  it('uno o dos fallos son ruido: sigue la cadencia normal', () => {
    expect(ibkrSyncIntervalMs({ errorCode: 'UNKNOWN', failCount: 1 })).toBe(NORMAL_INTERVAL_MS)
    expect(ibkrSyncIntervalMs({ errorCode: 'UNKNOWN', failCount: 2 })).toBe(NORMAL_INTERVAL_MS)
  })

  it('al tercer fallo seguido se espacia, sea cual sea el código', () => {
    expect(ibkrSyncIntervalMs({ errorCode: 'UNKNOWN', failCount: REPEATED_FAILURE_THRESHOLD })).toBe(BACKOFF_INTERVAL_MS)
    expect(ibkrSyncIntervalMs({ errorCode: 'TIMEOUT', failCount: 9 })).toBe(BACKOFF_INTERVAL_MS)
    // Un código que todavía no existe queda cubierto igual: ESE es el punto.
    expect(ibkrSyncIntervalMs({ errorCode: 'CODIGO_NUEVO_DE_IBKR', failCount: 5 })).toBe(BACKOFF_INTERVAL_MS)
  })

  it('LOCKED se espacia desde el primer fallo (reintentar lo refresca)', () => {
    expect(ibkrSyncIntervalMs({ errorCode: 'LOCKED', failCount: 0 })).toBe(BACKOFF_INTERVAL_MS)
  })

  it('el techo diario cae de ~48 intentos a 2', () => {
    const dia = 24 * 60 * 60 * 1000
    expect(Math.floor(dia / NORMAL_INTERVAL_MS)).toBe(48)
    expect(Math.floor(dia / BACKOFF_INTERVAL_MS)).toBe(2)
  })

  it('tolera un contador corrupto sin espaciar de más ni de menos', () => {
    expect(ibkrSyncIntervalMs({ failCount: null })).toBe(NORMAL_INTERVAL_MS)
    expect(ibkrSyncIntervalMs({ failCount: 'muchos' })).toBe(NORMAL_INTERVAL_MS)
    expect(ibkrSyncIntervalMs({ failCount: -3 })).toBe(NORMAL_INTERVAL_MS)
  })
})

describe('ibkrLockIsStuck (FASE KL)', () => {
  it('un bloqueo fresco NO es un bloqueo trabado: conserva su camino de sanar solo', () => {
    // La razón por la que LOCKED no es fatal desde el primer fallo: una ráfaga
    // de intentos se levanta sola en horas y detener el sync ahí lo deadlockea.
    for (let n = 0; n < LOCK_GIVE_UP_ATTEMPTS; n++) {
      expect(ibkrLockIsStuck({ errorCode: 'LOCKED', failCount: n })).toBe(false)
    }
  })

  it('después de varias corridas de la cadencia larga, deja de reintentar', () => {
    expect(ibkrLockIsStuck({ errorCode: 'LOCKED', failCount: LOCK_GIVE_UP_ATTEMPTS })).toBe(true)
    // El caso real del usuario: una semana a 12h de cadencia son ~14 intentos.
    expect(ibkrLockIsStuck({ errorCode: 'LOCKED', failCount: 14 })).toBe(true)
  })

  it('el umbral tarda al menos un día en alcanzarse, nunca minutos', () => {
    // Si esto bajara de un día, un mal rato de IBKR bastaría para apagar el
    // sync de alguien cuyo token está perfecto.
    expect(LOCK_GIVE_UP_ATTEMPTS * BACKOFF_INTERVAL_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000)
  })

  it('solo aplica a LOCKED: ningún otro código deja de reintentar por contar fallos', () => {
    // Un fallo transitorio que dura días TIENE que poder sanar solo; lo único
    // que lo distingue es que reintentar no empeora nada.
    for (const code of ['UNKNOWN', 'TIMEOUT', 'RATE_LIMITED', null, 'CODIGO_NUEVO']) {
      expect(ibkrLockIsStuck({ errorCode: code, failCount: 99 })).toBe(false)
    }
    expect(ibkrLockIsStuck()).toBe(false)
  })

  it('tolera un contador corrupto sin apagar el sync por accidente', () => {
    expect(ibkrLockIsStuck({ errorCode: 'LOCKED', failCount: null })).toBe(false)
    expect(ibkrLockIsStuck({ errorCode: 'LOCKED', failCount: 'muchos' })).toBe(false)
  })
})

describe('nextFailCount', () => {
  it('cuenta hacia arriba y arranca en 1', () => {
    expect(nextFailCount(undefined)).toBe(1)
    expect(nextFailCount(0)).toBe(1)
    expect(nextFailCount(2)).toBe(3)
  })
  it('ignora basura en vez de propagar NaN', () => {
    expect(nextFailCount('x')).toBe(1)
    expect(nextFailCount(-5)).toBe(1)
  })
})

describe('classifyError: el token vencido ya no cae en UNKNOWN', () => {
  it('reconoce el código 1012 (Token has expired)', () => {
    expect(classifyError('Token has expired.', '1012').errorCode).toBe('TOKEN_EXPIRED')
  })

  it('reconoce el texto aunque el código no venga', () => {
    expect(classifyError('Token has expired.').errorCode).toBe('TOKEN_EXPIRED')
    expect(classifyError('Your token expired').errorCode).toBe('TOKEN_EXPIRED')
  })

  it('NO marca fatal un "expired" que no habla del token', () => {
    // Un reference code vencido es transitorio: marcarlo fatal detendría el
    // sync de alguien cuyo token está perfecto.
    expect(classifyError('Reference code has expired, please try again').errorCode).not.toBe('TOKEN_EXPIRED')
  })

  it('reconoce el código 1014 y las dos redacciones de query inválida', () => {
    expect(classifyError('Query is invalid.', '1014').errorCode).toBe('INVALID_QUERY')
    expect(classifyError('Query is invalid.').errorCode).toBe('INVALID_QUERY')
    expect(classifyError('Invalid query').errorCode).toBe('INVALID_QUERY')
  })

  it('no cambia lo que ya clasificaba bien', () => {
    expect(classifyError('anything', '1019').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('Too many failed attempts. Please review your configuration.').errorCode).toBe('LOCKED')
    expect(classifyError('timed out').errorCode).toBe('TIMEOUT')
    expect(classifyError('algo rarísimo').errorCode).toBe('UNKNOWN')
  })
})
