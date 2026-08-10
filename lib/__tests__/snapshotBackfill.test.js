import { staleBackfillDates } from '../snapshotBackfill'

// A fixed "today" so date math is deterministic regardless of when the test runs.
const TODAY = new Date('2026-08-06T12:00:00Z').getTime()
const dayStr = (daysAgo) => {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

describe('staleBackfillDates', () => {
  it('with no snapshots at all, every day in the window is a gap', () => {
    const out = staleBackfillDates([], { windowDays: 5, todayMs: TODAY })
    expect(out).toHaveLength(5)
    expect(out).toContain(dayStr(1))
    expect(out).toContain(dayStr(5))
  })

  it('a real observation (daily) blocks re-fill by default', () => {
    const snapshots = [{ date: dayStr(2), _source: 'daily' }]
    const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
    expect(out).not.toContain(dayStr(2))
    expect(out).toHaveLength(4)
  })

  it('manual e ibkr_quarterly siguen bloqueando; un NAV ibkr ya NO cubre el dia (FASE GD)', () => {
    // El NAV sincronizado mide UNA cuenta: desde los docs paralelos de FU
    // convive con la observacion completa y el dia debe poder recibir su
    // reconstruccion de portafolio entero. La transcripcion quarterly es
    // trabajo manual del usuario en el slot plano: sigue bloqueando.
    const snapshots = [
      { date: dayStr(1), _source: 'manual' },
      { date: dayStr(2), _source: 'ibkr' },
      { date: dayStr(3), _source: 'ibkr_quarterly' },
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 3, todayMs: TODAY, treatDailyAsStale: true })
    expect(out).toEqual([dayStr(2)])
  })

  it('un dia con NAV paralelo Y observacion completa queda cubierto (FASE GD)', () => {
    const snapshots = [
      { id: dayStr(1), date: dayStr(1), _source: 'daily' },
      { id: `${dayStr(1)}~nav~ibkr`, date: dayStr(1), _source: 'ibkr' },
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    expect(out).toHaveLength(0)
  })

  it('un dia SOLO con NAV paralelo se rellena con la reconstruccion completa (FASE GD)', () => {
    const snapshots = [
      { id: `${dayStr(1)}~nav~ibkr`, date: dayStr(1), _source: 'ibkr' },
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    expect(out).toEqual([dayStr(1)])
  })

  it('a doc with no _source at all counts as honest history (FASE DX) and blocks re-fill by default', () => {
    const snapshots = [{ date: dayStr(1) }]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    expect(out).toHaveLength(0)
  })

  // The XOCHI regression: a day already covered by an OLD backfill estimate
  // (written back when XOCHI did not exist yet) must stay re-fillable, or it
  // sits there forever alternating against the fresh days next to it.
  it('a _source:backfill doc is re-fillable, exactly like a missing day', () => {
    const snapshots = [{ date: dayStr(3), _source: 'backfill' }]
    const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
    expect(out).toContain(dayStr(3))
    expect(out).toHaveLength(5)
  })

  it('a calibration anchor (_account set) is ignored: it neither blocks nor fills the day', () => {
    const snapshots = [{ date: dayStr(1), _source: 'manual', _account: 'idc' }]
    const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY })
    // The compound-id anchor doesn't stand in for the portfolio-wide doc, so
    // the day is still a gap.
    expect(out).toContain(dayStr(1))
  })

  it('mixed window: only the missing day and the stale-backfill day come back by default', () => {
    const snapshots = [
      { date: dayStr(1), _source: 'daily' },
      { date: dayStr(2), _source: 'backfill' },
      // dayStr(3) has no doc at all
    ]
    const out = staleBackfillDates(snapshots, { windowDays: 3, todayMs: TODAY })
    expect(out.sort()).toEqual([dayStr(2), dayStr(3)].sort())
  })

  describe('brokerConnectedTs (FASE HG: un daily de antes de conectar el broker)', () => {
    // El caso real reportado: IBKR conectado hoy, pero el usuario ya usaba
    // Chispu con cuentas manuales desde antes, abriendo la app seguido. Cada
    // dia con un 'daily' de esa era pre-IBKR queda congelado sin el broker
    // para siempre (hasBrokerItem del caller ya es true), mientras los dias
    // sin ese doc se rellenan con la reconstruccion completa que si lo
    // incluye: el diente de sierra de la vista "Todas".
    it('un daily de ANTES de la conexion del broker se vuelve rellenable', () => {
      const snapshots = [{ date: dayStr(3), _source: 'daily' }]
      const brokerConnectedTs = new Date(`${dayStr(1)}T00:00:00Z`).getTime()
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, brokerConnectedTs })
      expect(out).toContain(dayStr(3))
    })

    it('un daily de DESPUES de la conexion del broker sigue protegido', () => {
      const snapshots = [{ date: dayStr(1), _source: 'daily' }]
      const brokerConnectedTs = new Date(`${dayStr(3)}T00:00:00Z`).getTime()
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, brokerConnectedTs })
      expect(out).not.toContain(dayStr(1))
    })

    it('un daily del MISMO dia que la conexion sigue protegido (limite exclusivo)', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const brokerConnectedTs = new Date(`${dayStr(2)}T00:00:00Z`).getTime()
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, brokerConnectedTs })
      expect(out).not.toContain(dayStr(2))
    })

    it('un doc backfill/manual/quarterly de antes de la conexion no cambia de regla', () => {
      const snapshots = [
        { date: dayStr(4), _source: 'backfill' },
        { date: dayStr(3), _source: 'manual' },
      ]
      const brokerConnectedTs = new Date(`${dayStr(1)}T00:00:00Z`).getTime()
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, brokerConnectedTs })
      // backfill ya era rellenable de por si (sin cambios); manual sigue
      // protegido siempre, sin importar la fecha del broker.
      expect(out).toContain(dayStr(4))
      expect(out).not.toContain(dayStr(3))
    })

    it('sin brokerConnectedTs (null), el comportamiento es identico al de antes', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, brokerConnectedTs: null })
      expect(out).not.toContain(dayStr(2))
    })
  })

  describe('treatDailyAsStale (no broker-synced item in the portfolio)', () => {
    it('a daily doc becomes re-fillable too', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY, treatDailyAsStale: true })
      expect(out).toContain(dayStr(2))
    })

    it('a doc with no _source at all becomes re-fillable too (same treatment as daily)', () => {
      const snapshots = [{ date: dayStr(1) }]
      const out = staleBackfillDates(snapshots, { windowDays: 1, todayMs: TODAY, treatDailyAsStale: true })
      expect(out).toContain(dayStr(1))
    })

    it('off by default: the caller must opt in explicitly', () => {
      const snapshots = [{ date: dayStr(2), _source: 'daily' }]
      const out = staleBackfillDates(snapshots, { windowDays: 5, todayMs: TODAY })
      expect(out).not.toContain(dayStr(2))
    })
  })
})
