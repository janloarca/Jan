import {
  ibkrSyncIntervalMs, nextFailCount,
  NORMAL_INTERVAL_MS, BACKOFF_INTERVAL_MS, REPEATED_FAILURE_THRESHOLD,
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
