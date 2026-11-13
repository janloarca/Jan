import { dayPointLabel, isDateOnlyTs } from '../dayPointLabel'
import { formatBackfillLog } from '../snapshotBackfill'
import { firestoreErrorCode, isTransientFirestoreError, withFirestoreRetry } from '../firestoreErrors'

describe('dayPointLabel (FASE SA)', () => {
  test('la suite corre al oeste de UTC (si no, el caso no prueba nada)', () => {
    expect(new Date(Date.UTC(2026, 10, 13)).getHours()).toBe(18)
  })
  test('un snapshot diario (medianoche UTC) se rotula con su fecha, no "18:00"', () => {
    const ts = Date.UTC(2026, 10, 13)
    expect(isDateOnlyTs(ts)).toBe(true)
    const l = dayPointLabel(ts, 'es')
    expect(l).toMatch(/13/)
    expect(l).not.toMatch(/18:00/)
    expect(dayPointLabel(ts, 'es', { long: true })).toMatch(/registro del día/)
  })
  test('un instante intradía sale en la hora LOCAL', () => {
    const ts = Date.UTC(2026, 10, 13, 18, 35) // 12:35 en Guatemala
    expect(isDateOnlyTs(ts)).toBe(false)
    expect(dayPointLabel(ts, 'es')).toMatch(/12:35/)
  })
})

describe('formatBackfillLog (FASE SA)', () => {
  test('con cambio de valor, el detalle va en la MISMA línea', () => {
    const l = formatBackfillLog({
      written: 315, unchanged: 1, reasons: { value: 315 }, maxDelta: 1432.4, maxDeltaDate: '2026-10-06',
      detail: { storedTotal: 100, nextTotal: 1532.4, accounts: [{ key: 'ibkr', stored: 50, next: 1482.4 }] },
      lotsCount: 3, txCount: 9, build: 'abc',
    })
    expect(l).toMatch(/315 día\(s\) escritos/)
    expect(l).toMatch(/2026-10-06: guardado 100\.00 USD, recalculado 1532\.40 USD \(lotes 3, movimientos 9\)/)
    expect(l).toMatch(/ibkr 50\.00 → 1482\.40/)
    expect(l).toMatch(/\[build abc\]/)
  })
  test('días escritos SIN cambio de valor (solo huecos) igual nombran un día', () => {
    const l = formatBackfillLog({ written: 2, reasons: { gap: 2 }, firstWritten: { date: '2026-01-02', reason: 'gap', total: 10 } })
    expect(l).toMatch(/primer día escrito 2026-01-02 \(huecos\)/)
  })
  test('sin días escritos no agrega detalle', () => {
    expect(formatBackfillLog({ written: 0, unchanged: 316 })).toBe('[backfill] 0 día(s) escritos, 316 sin cambios')
  })
})

describe('códigos del SDK del navegador (FASE SA)', () => {
  test('unavailable / deadline-exceeded son transitorios; permission-denied no', () => {
    expect(firestoreErrorCode({ code: 'unavailable' })).toBe(14)
    expect(isTransientFirestoreError({ code: 'unavailable' })).toBe(true)
    expect(isTransientFirestoreError({ code: 'deadline-exceeded' })).toBe(true)
    expect(isTransientFirestoreError({ code: 'permission-denied' })).toBe(false)
    expect(isTransientFirestoreError({ code: 'resource-exhausted' })).toBe(false)
  })
  test('withFirestoreRetry rescata un "client is offline" de arranque', async () => {
    let n = 0
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const v = await withFirestoreRetry(async () => {
      n += 1
      if (n === 1) { const e = new Error('Failed to get document because the client is offline.'); e.code = 'unavailable'; throw e }
      return 'ok'
    }, { baseDelayMs: 1 })
    warn.mockRestore()
    expect(v).toBe('ok')
    expect(n).toBe(2)
  })
})
