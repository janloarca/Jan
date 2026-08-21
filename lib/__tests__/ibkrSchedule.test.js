import {
  ibkrSyncDecision, inIbkrResetWindow, ibkrDayKey, attemptsOn, bumpAttempts,
  syncSkipReasonText, MAX_ATTEMPTS_PER_DAY, FATAL_ERROR_CODES,
} from '../ibkrSchedule'
import { NORMAL_INTERVAL_MS, BACKOFF_INTERVAL_MS, LOCK_GIVE_UP_ATTEMPTS } from '../ibkrRetryPolicy'

// Instantes en UTC, con su hora del Este anotada al lado. En agosto ET va 4
// horas atrás de UTC (verano) y en enero 5 (invierno): los dos casos están
// cubiertos a propósito, porque un offset escrito a mano se rompe justo ahí.
const AUG_FRI_2350_ET = '2026-08-22T03:50:00Z'
const AUG_SAT_0030_ET = '2026-08-22T04:30:00Z'
const AUG_SAT_0050_ET = '2026-08-22T04:50:00Z'
const JAN_WED_2350_ET = '2026-01-15T04:50:00Z'
const AUG_THU_1000_ET = '2026-08-20T14:00:00Z'

describe('inIbkrResetWindow', () => {
  it('atrapa el lado de entrada, 23:45 ET, en verano y en invierno', () => {
    expect(inIbkrResetWindow(new Date(AUG_FRI_2350_ET))).toBe(true)
    expect(inIbkrResetWindow(new Date(JAN_WED_2350_ET))).toBe(true)
  })

  it('el viernes la ventana termina a las 00:30, no a las 00:45', () => {
    // 00:30 ET del sábado: la ventana que arrancó el viernes YA cerró.
    expect(inIbkrResetWindow(new Date(AUG_SAT_0030_ET))).toBe(false)
    expect(inIbkrResetWindow(new Date(AUG_SAT_0050_ET))).toBe(false)
  })

  it('el resto de los días termina a las 00:45', () => {
    // Jueves 00:30 ET (la ventana arrancó el miércoles).
    expect(inIbkrResetWindow(new Date('2026-08-20T04:30:00Z'))).toBe(true)
    expect(inIbkrResetWindow(new Date('2026-08-20T04:50:00Z'))).toBe(false)
  })

  it('en pleno horario de mercado no hay ventana', () => {
    expect(inIbkrResetWindow(new Date(AUG_THU_1000_ET))).toBe(false)
  })
})

describe('ibkrDayKey', () => {
  it('el día es el de IBKR (ET), no el del navegador', () => {
    // 23:50 ET del viernes 21 de agosto sigue siendo el día 21 para IBKR,
    // aunque en UTC ya sea el 22.
    expect(ibkrDayKey(new Date(AUG_FRI_2350_ET))).toBe('2026-08-21')
    expect(ibkrDayKey(new Date(AUG_SAT_0050_ET))).toBe('2026-08-22')
  })
})

describe('presupuesto diario', () => {
  it('un día distinto vale cero: el contador se reinicia solo', () => {
    expect(attemptsOn({ date: '2026-08-20', count: 3 }, '2026-08-21')).toBe(0)
    expect(attemptsOn({ date: '2026-08-21', count: 3 }, '2026-08-21')).toBe(3)
    expect(attemptsOn(null, '2026-08-21')).toBe(0)
    expect(attemptsOn({ date: '2026-08-21', count: 'x' }, '2026-08-21')).toBe(0)
  })

  it('bumpAttempts arranca en 1 y cambia de día sin arrastrar', () => {
    expect(bumpAttempts(null, 'd1')).toEqual({ date: 'd1', count: 1 })
    expect(bumpAttempts({ date: 'd1', count: 2 }, 'd1')).toEqual({ date: 'd1', count: 3 })
    expect(bumpAttempts({ date: 'd0', count: 9 }, 'd1')).toEqual({ date: 'd1', count: 1 })
  })
})

describe('ibkrSyncDecision', () => {
  const now = new Date(AUG_THU_1000_ET)

  it('sin nada previo, sincroniza', () => {
    expect(ibkrSyncDecision({ now })).toEqual({ sync: true })
  })

  it('un sync exitoso HOY cierra el día: IBKR actualiza una vez al cierre', () => {
    const d = ibkrSyncDecision({ now, lastSuccess: '2026-08-20T12:00:00Z' })
    expect(d).toEqual({ sync: false, reason: 'synced-today' })
  })

  it('un sync exitoso de AYER no bloquea el de hoy', () => {
    expect(ibkrSyncDecision({ now, lastSuccess: '2026-08-19T12:00:00Z' }).sync).toBe(true)
  })

  it('nunca dentro de la ventana de reset, aunque todo lo demás habilite', () => {
    const d = ibkrSyncDecision({ now: new Date(JAN_WED_2350_ET) })
    expect(d).toEqual({ sync: false, reason: 'reset-window' })
  })

  it('agotado el presupuesto del día, para hasta mañana', () => {
    const attempts = { date: '2026-08-20', count: MAX_ATTEMPTS_PER_DAY }
    expect(ibkrSyncDecision({ now, attempts })).toEqual({ sync: false, reason: 'budget-spent' })
    // Y al día siguiente vuelve solo.
    expect(ibkrSyncDecision({ now: new Date('2026-08-21T14:00:00Z'), attempts }).sync).toBe(true)
  })

  it('con presupuesto disponible reintenta el mismo día, respetando el espaciado', () => {
    const attempts = { date: '2026-08-20', count: 1 }
    const justFailed = new Date(now.getTime() - 60_000).toISOString()
    expect(ibkrSyncDecision({ now, attempts, lastAttempt: justFailed }))
      .toEqual({ sync: false, reason: 'too-soon' })
    const longAgo = new Date(now.getTime() - NORMAL_INTERVAL_MS - 1000).toISOString()
    expect(ibkrSyncDecision({ now, attempts, lastAttempt: longAgo }).sync).toBe(true)
  })

  it('el espaciado se mide contra el último INTENTO, no contra el último éxito', () => {
    // Si se midiera contra el éxito, cada recarga en estado de error dispararía
    // otro intento fallido: el lazo que alimenta el bloqueo de IBKR.
    const justFailed = new Date(now.getTime() - 60_000).toISOString()
    expect(ibkrSyncDecision({ now, lastSuccess: null, lastAttempt: justFailed }).reason).toBe('too-soon')
  })

  it('un error fatal detiene el automático, sin gastar presupuesto', () => {
    for (const code of FATAL_ERROR_CODES) {
      expect(ibkrSyncDecision({ now, errorCode: code })).toEqual({ sync: false, reason: 'fatal' })
    }
  })

  it('un bloqueo trabado detiene el automático', () => {
    const d = ibkrSyncDecision({ now, errorCode: 'LOCKED', failCount: LOCK_GIVE_UP_ATTEMPTS })
    expect(d).toEqual({ sync: false, reason: 'lock-stuck' })
  })

  it('un bloqueo FRESCO no detiene, solo espacia', () => {
    const d = ibkrSyncDecision({ now, errorCode: 'LOCKED', failCount: 1 })
    expect(d).toEqual({ sync: true })
  })

  it('toda razón tiene texto en los dos idiomas', () => {
    for (const r of ['fatal', 'lock-stuck', 'reset-window', 'synced-today', 'budget-spent', 'too-soon']) {
      expect(syncSkipReasonText(r, 'es')).toBeTruthy()
      expect(syncSkipReasonText(r, 'en')).toBeTruthy()
      expect(syncSkipReasonText(r, 'en')).not.toEqual(syncSkipReasonText(r, 'es'))
    }
    expect(syncSkipReasonText('algo-nuevo')).toBeNull()
  })
})

// ⛔ El invariante que no se ve leyendo el código: cuánto le pegamos a IBKR en
// el peor día. Existe para que nadie baje una constante sin ver el efecto.
describe('techo diario de solicitudes contra IBKR', () => {
  it('un token muerto ya no puede gastar decenas de intentos por día', () => {
    // Antes: cadencia de 30 min = 48 intentos fallidos diarios, indefinidamente.
    expect(Math.floor(24 * 60 * 60 * 1000 / NORMAL_INTERVAL_MS)).toBe(48)
    // Ahora el techo es el presupuesto, no la cadencia.
    expect(MAX_ATTEMPTS_PER_DAY).toBeLessThanOrEqual(3)
  })

  it('el espaciado impide gastar el presupuesto de un tirón', () => {
    // Tres intentos con 30 min de separación mínima ocupan al menos una hora:
    // no pueden salir como una ráfaga, que es la forma que IBKR castiga.
    expect((MAX_ATTEMPTS_PER_DAY - 1) * NORMAL_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it('el camino feliz baja de 48 syncs diarios a 1', () => {
    // La regla de "un sync por día" no depende de ninguna constante de tiempo,
    // así que este test fija la propiedad, no un número.
    const now = new Date(AUG_THU_1000_ET)
    let lastSuccess = null
    let syncs = 0
    for (let i = 0; i < 48; i++) {
      const t = new Date(now.getTime() + i * 30 * 60 * 1000)
      // Solo cuenta lo que ocurre dentro del mismo día ET.
      if (ibkrDayKey(t) !== ibkrDayKey(now)) break
      if (ibkrSyncDecision({ now: t, lastSuccess }).sync) {
        syncs++
        lastSuccess = t.toISOString()
      }
    }
    expect(syncs).toBe(1)
  })

  it('el bloqueo trabado sigue siendo el techo más bajo de todos', () => {
    expect(LOCK_GIVE_UP_ATTEMPTS * BACKOFF_INTERVAL_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000)
  })
})

// El sondeo no exporta sus constantes (son privadas del modulo), asi que se
// leen del ARCHIVO: fijar una copia aca dejaria pasar un cambio en el codigo.
describe('cadencia del sondeo (FASE KN)', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'ibkrSync.js'), 'utf8')
  const num = (name) => {
    const m = src.match(new RegExp(`const ${name} = (\\d+)`))
    expect(m).toBeTruthy()
    return Number(m[1])
  }

  it('nunca mas de 10 solicitudes por minuto por token', () => {
    const perMinute = 60000 / num('POLL_INTERVAL_MS')
    expect(perMinute).toBeLessThanOrEqual(10)
  })

  it('sin alargar lo que el usuario espera', () => {
    // La ventana total de sondeo se mantiene en ~90 segundos: la mitad de
    // solicitudes por el mismo resultado, no una espera mas larga.
    const window = num('POLL_INTERVAL_MS') * num('MAX_POLL_ATTEMPTS')
    expect(window).toBeGreaterThanOrEqual(85000)
    expect(window).toBeLessThanOrEqual(125000)
  })
})
