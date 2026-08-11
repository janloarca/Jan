import { staleBackfillDates, resolveGapFills, buildNavByDate, composeDailyTotals, windowDates, divergentDailyDates } from '../snapshotBackfill'

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

  describe('resolveGapFills (FASE HI: fin de semana = ultimo cierre de mercado)', () => {
    // La serie del API solo trae dias habiles. La regla del usuario: sabado y
    // domingo valen lo que dijo el ultimo cierre (viernes); un feriado, el
    // habil previo.
    const t = (dateStr, hour = 21) => Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`)

    it('un dia habil matchea su punto exacto, sin arrastre', () => {
      // 2026-08-06 es jueves
      const pts = [{ ts: t('2026-08-06'), total: 100 }]
      const out = resolveGapFills(['2026-08-06'], pts)
      expect(out).toEqual([{ date: '2026-08-06', total: 100, carried: false }])
    })

    it('sabado y domingo arrastran el cierre del viernes', () => {
      // 2026-08-07 viernes; 08-08 sabado; 08-09 domingo
      const pts = [{ ts: t('2026-08-07'), total: 230 }]
      const out = resolveGapFills(['2026-08-08', '2026-08-09'], pts)
      expect(out).toEqual([
        { date: '2026-08-08', total: 230, carried: true },
        { date: '2026-08-09', total: 230, carried: true },
      ])
    })

    it('un lunes feriado arrastra el viernes (3 dias, dentro del tope)', () => {
      const pts = [{ ts: t('2026-08-07'), total: 230 }]
      const out = resolveGapFills(['2026-08-10'], pts)
      expect(out).toEqual([{ date: '2026-08-10', total: 230, carried: true }])
    })

    it('un hueco a mas de maxCarryDays del ultimo punto NO se inventa', () => {
      // Un agujero real de datos del API no es un fin de semana: arrastrar un
      // valor de semanas seria una meseta falsa con cara de dato.
      const pts = [{ ts: t('2026-07-01'), total: 230 }]
      const out = resolveGapFills(['2026-07-20'], pts)
      expect(out).toEqual([])
    })

    it('un hueco ANTERIOR al primer punto no se rellena: nunca hacia atras', () => {
      const pts = [{ ts: t('2026-08-07'), total: 230 }]
      const out = resolveGapFills(['2026-08-05'], pts)
      // 08-05 (miercoles) es anterior al unico punto: sin cierre previo que
      // arrastrar, el dia queda como este.
      expect(out).toEqual([])
    })

    it('puntos con total <= 0 o ts invalido se descartan antes de resolver', () => {
      const pts = [
        { ts: t('2026-08-07'), total: 0 },
        { ts: NaN, total: 500 },
        { ts: t('2026-08-06'), total: 100 },
      ]
      const out = resolveGapFills(['2026-08-08'], pts)
      // El viernes 07 en cero no cuenta; arrastra el jueves 06 (2 dias, ok).
      expect(out).toEqual([{ date: '2026-08-08', total: 100, carried: true }])
    })

    it('varios puntos el mismo dia: gana el ultimo del dia', () => {
      const pts = [
        { ts: t('2026-08-06', 14), total: 90 },
        { ts: t('2026-08-06', 20), total: 110 },
      ]
      const out = resolveGapFills(['2026-08-06'], pts)
      expect(out).toEqual([{ date: '2026-08-06', total: 110, carried: false }])
    })

    it('puntos desordenados se resuelven igual', () => {
      const pts = [
        { ts: t('2026-08-07'), total: 230 },
        { ts: t('2026-08-03'), total: 200 },
        { ts: t('2026-08-05'), total: 210 },
      ]
      const out = resolveGapFills(['2026-08-08', '2026-08-05'], pts)
      expect(out).toEqual([
        { date: '2026-08-08', total: 230, carried: true },
        { date: '2026-08-05', total: 210, carried: false },
      ])
    })
  })

  describe('composeDailyTotals (FASE HN: NAV real del broker + reconstruccion manual)', () => {
    const t = (dateStr) => Date.parse(`${dateStr}T21:00:00Z`)
    // Reconstruccion de lo MANUAL (sin el broker), dias habiles.
    const manualPoints = [
      { ts: t('2026-08-05'), total: 13000 },
      { ts: t('2026-08-06'), total: 13100 },
      { ts: t('2026-08-07'), total: 13200 },
    ]
    const nav = new Map([
      ['2026-08-05', 9900],
      ['2026-08-06', 10000],
      ['2026-08-07', 10100],
    ])

    it('cada dia suma NAV real + manual, sin estimar la mitad del broker', () => {
      const out = composeDailyTotals({
        gaps: ['2026-08-05', '2026-08-06', '2026-08-07'],
        manualPoints, navByDate: nav, hasBrokerItems: true,
      })
      expect(out).toEqual([
        { date: '2026-08-05', total: 22900, composed: true },
        { date: '2026-08-06', total: 23100, composed: true },
        { date: '2026-08-07', total: 23300, composed: true },
      ])
    })

    it('sabado y domingo arrastran el ultimo cierre de AMBAS mitades', () => {
      const out = composeDailyTotals({
        gaps: ['2026-08-08', '2026-08-09'],
        manualPoints, navByDate: nav, hasBrokerItems: true,
      })
      // viernes 07: manual 13200 + nav 10100
      expect(out).toEqual([
        { date: '2026-08-08', total: 23300, composed: true },
        { date: '2026-08-09', total: 23300, composed: true },
      ])
    })

    // La garantia dura: es exactamente el bug del diente de sierra. Un dia
    // escrito a nivel solo-manual mientras el broker esta conectado archiva un
    // patrimonio que omite una cuenta entera.
    it('con broker conectado, un dia SIN NAV disponible no se escribe', () => {
      const out = composeDailyTotals({
        gaps: ['2026-06-01'], // muy anterior a cualquier NAV
        manualPoints: [{ ts: t('2026-06-01'), total: 13000 }],
        navByDate: nav, hasBrokerItems: true,
      })
      expect(out).toEqual([])
    })

    it('sin broker en el portafolio, el total manual ES el portafolio', () => {
      const out = composeDailyTotals({
        gaps: ['2026-08-06'],
        manualPoints, navByDate: new Map(), hasBrokerItems: false,
      })
      expect(out).toEqual([{ date: '2026-08-06', total: 13100, composed: false }])
    })

    it('un dia sin reconstruccion manual alcanzable no se escribe', () => {
      const out = composeDailyTotals({
        gaps: ['2026-01-02'],
        manualPoints, navByDate: nav, hasBrokerItems: true,
      })
      expect(out).toEqual([])
    })
  })

  describe('divergentDailyDates (FASE HO: el pico de fin de semana)', () => {
    // El caso real: los picos del diente de sierra caen EXACTAMENTE en fin de
    // semana, o sea son docs 'daily' escritos en vivo (el backfill no puede
    // escribir findes: no hay precios) mientras el sync de IBKR responde mal.
    // Quedaron inflados y protegidos de reescritura por ser "observaciones".
    const composed = [
      { date: '2026-08-07', total: 23000, composed: true },
      { date: '2026-08-08', total: 23000, composed: true },
      { date: '2026-08-09', total: 23000, composed: true },
    ]

    it('marca el daily inflado que contradice la composicion', () => {
      const out = divergentDailyDates([
        { date: '2026-08-08', _source: 'daily', netWorthUSD: 26500 },
      ], composed)
      expect(out).toEqual(['2026-08-08'])
    })

    it('un daily que coincide con la composicion se respeta', () => {
      const out = divergentDailyDates([
        { date: '2026-08-08', _source: 'daily', netWorthUSD: 23100 },
      ], composed)
      expect(out).toEqual([])
    })

    it('NUNCA toca un doc manual: la transcripcion del usuario manda', () => {
      const out = divergentDailyDates([
        { date: '2026-08-08', _source: 'manual', netWorthUSD: 26500 },
      ], composed)
      expect(out).toEqual([])
    })

    it('no juzga contra una composicion que no uso NAV real', () => {
      const out = divergentDailyDates([
        { date: '2026-08-08', _source: 'daily', netWorthUSD: 26500 },
      ], [{ date: '2026-08-08', total: 13000, composed: false }])
      expect(out).toEqual([])
    })

    it('una diferencia chica en dolares no dispara reescritura', () => {
      const out = divergentDailyDates([
        { date: '2026-08-08', _source: 'daily', netWorthUSD: 23040 },
      ], composed)
      expect(out).toEqual([])
    })
  })

  describe('windowDates (FASE HO)', () => {
    it('devuelve la ventana completa, no solo los huecos', () => {
      const out = windowDates(3, TODAY)
      expect(out).toEqual([dayStr(1), dayStr(2), dayStr(3)])
    })
  })

  describe('buildNavByDate (FASE HN)', () => {
    it('toma el NAV real del broker por fecha, incluidos los docs paralelos', () => {
      const out = buildNavByDate([
        { id: '2026-08-06', date: '2026-08-06', _source: 'daily', netWorthUSD: 23000 },
        { id: '2026-08-06~nav~ibkr', date: '2026-08-06', _source: 'ibkr', netWorthUSD: 10000 },
        { id: '2026-08-07', date: '2026-08-07', _source: 'ibkr', netWorthUSD: 10100 },
      ])
      expect(out.get('2026-08-06')).toBe(10000)
      expect(out.get('2026-08-07')).toBe(10100)
      expect(out.size).toBe(2)
    })

    it('ignora anclas de calibracion y transcripciones trimestrales', () => {
      const out = buildNavByDate([
        { id: '2026-01-01~cal~ibkr', date: '2026-01-01', _source: 'ibkr', _account: 'ibkr', netWorthUSD: 5000 },
        { id: '2026-03-31', date: '2026-03-31', _source: 'ibkr_quarterly', netWorthUSD: 7000 },
      ])
      expect(out.size).toBe(0)
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
