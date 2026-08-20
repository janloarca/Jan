// FASE FU. planEquitySnapshotWrites + preferFullPortfolioPerDay: el NAV real
// del broker se guarda SIEMPRE (doc paralelo cuando la fecha la ocupa una
// observación de portafolio completo) y los consumidores de portafolio
// completo siguen prefiriendo la observación completa.

import { planEquitySnapshotWrites, misplacedPlainNavMigrations, applyNavMigrations, planQuarterlyNavWrite, IBKR_NAV_DOC_SUFFIX } from '@/lib/ibkrSnapshotPlan'
import { preferFullPortfolioPerDay } from '@/lib/snapshotSelect'

const toUSD = (v, cur) => (cur === 'EUR' ? (v || 0) * 1.1 : (v || 0))
const eq = (date, nav, extra = {}) => ({ date, netWorthUSD: nav, totalActivosUSD: nav, totalDebtUSD: 0, ...extra })

describe('planEquitySnapshotWrites: donde aterriza cada NAV', () => {
  it('fecha libre: doc plano (sin _docId), igual que siempre', () => {
    const out = planEquitySnapshotWrites([eq('2026-07-23', 10012.27)], [], toUSD)
    expect(out).toHaveLength(1)
    expect(out[0]._docId).toBeUndefined()
    expect(out[0].netWorthUSD).toBe(10012.27)
    expect(out[0]._source).toBe('ibkr')
  })

  it('fecha ocupada por el snapshot diario COMPLETO: doc paralelo, y el diario se queda', () => {
    // El caso exacto del reporte: el usuario abre la app a diario, cada fecha
    // tiene doc 'daily' de ~$23K, y el NAV de ~$10K se descartaba por la regla
    // vieja de "solo si es mayor". Ahora convive en su propio doc.
    const existing = [{ id: '2026-07-23', date: '2026-07-23', netWorthUSD: 23181, _source: 'daily' }]
    const out = planEquitySnapshotWrites([eq('2026-07-23', 10012.27)], existing, toUSD)
    expect(out).toHaveLength(1)
    expect(out[0]._docId).toBe(`2026-07-23${IBKR_NAV_DOC_SUFFIX}`)
    expect(out[0].netWorthUSD).toBe(10012.27)
  })

  it('fecha ocupada por un snapshot manual: tambien doc paralelo', () => {
    const existing = [{ id: '2026-05-01', date: '2026-05-01', netWorthUSD: 20000, _source: 'manual' }]
    const out = planEquitySnapshotWrites([eq('2026-05-01', 9500)], existing, toUSD)
    expect(out[0]._docId).toBe(`2026-05-01${IBKR_NAV_DOC_SUFFIX}`)
  })

  it('fecha ocupada por un backfill: doc paralelo, el backfill se queda (FASE GD)', () => {
    // La regla vieja (reemplazo plano) destruia la observacion de portafolio
    // completo sin necesidad: la vista escopada ya recibe el NAV por el doc
    // paralelo. Asi fue como la vista "Todas" perdio ene-jul en un sync.
    const existing = [{ id: '2026-06-10', date: '2026-06-10', netWorthUSD: 21000, _source: 'backfill' }]
    const out = planEquitySnapshotWrites([eq('2026-06-10', 9800)], existing, toUSD)
    expect(out).toHaveLength(1)
    expect(out[0]._docId).toBe(`2026-06-10${IBKR_NAV_DOC_SUFFIX}`)
  })

  it('fecha ocupada por ibkr_quarterly: reemplazo plano (NAV real gana a transcripcion)', () => {
    const existing = [{ id: '2025-12-31', date: '2025-12-31', netWorthUSD: 5000, _source: 'ibkr_quarterly' }]
    const out = planEquitySnapshotWrites([eq('2025-12-31', 5400)], existing, toUSD)
    expect(out).toHaveLength(1)
    expect(out[0]._docId).toBeUndefined()
  })

  it('doc ibkr plano ya existente con el MISMO valor: se salta (cero reescrituras)', () => {
    const existing = [{ id: '2026-07-01', date: '2026-07-01', netWorthUSD: 10000, _source: 'ibkr' }]
    const out = planEquitySnapshotWrites([eq('2026-07-01', 10000)], existing, toUSD)
    expect(out).toHaveLength(0)
  })

  it('doc ibkr plano existente con valor DISTINTO: actualiza el mismo doc plano', () => {
    const existing = [{ id: '2026-07-01', date: '2026-07-01', netWorthUSD: 10000, _source: 'ibkr' }]
    const out = planEquitySnapshotWrites([eq('2026-07-01', 10100)], existing, toUSD)
    expect(out).toHaveLength(1)
    expect(out[0]._docId).toBeUndefined()
  })

  it('doc PARALELO existente: se actualiza bajo su mismo id, jamas se duplica', () => {
    const existing = [
      { id: '2026-07-23', date: '2026-07-23', netWorthUSD: 23181, _source: 'daily' },
      { id: `2026-07-23${IBKR_NAV_DOC_SUFFIX}`, date: '2026-07-23', netWorthUSD: 10012, _source: 'ibkr' },
    ]
    const changed = planEquitySnapshotWrites([eq('2026-07-23', 10050)], existing, toUSD)
    expect(changed).toHaveLength(1)
    expect(changed[0]._docId).toBe(`2026-07-23${IBKR_NAV_DOC_SUFFIX}`)
    const unchanged = planEquitySnapshotWrites([eq('2026-07-23', 10012)], existing, toUSD)
    expect(unchanged).toHaveLength(0)
  })

  it('moneda base no-USD: se convierte con toUSD', () => {
    const out = planEquitySnapshotWrites([eq('2026-07-01', 1000, { _equityCurrency: 'EUR' })], [], toUSD)
    expect(out[0].netWorthUSD).toBeCloseTo(1100, 9)
  })

  it('fechas repetidas en el flex (paginas duplicadas): una sola escritura', () => {
    const out = planEquitySnapshotWrites([eq('2026-07-01', 10000), eq('2026-07-01', 10000)], [], toUSD)
    expect(out).toHaveLength(1)
  })

  it('NAV en cero o invalido: se salta', () => {
    const out = planEquitySnapshotWrites([eq('2026-07-01', 0), eq('2026-07-02', NaN)], [], toUSD)
    expect(out).toHaveLength(0)
  })

  it('anclas de calibracion (_account) no cuentan como ocupacion', () => {
    const existing = [{ id: '2026-07-01~cal~x', date: '2026-07-01', netWorthUSD: 99999, _source: 'manual', _account: 'x', _calibrated: true }]
    const out = planEquitySnapshotWrites([eq('2026-07-01', 10000)], existing, toUSD)
    expect(out[0]._docId).toBeUndefined()
  })
})

describe('misplacedPlainNavMigrations: liberar el slot plano de la fecha (FASE GD)', () => {
  it('un NAV ibkr en el slot plano se mueve a su doc paralelo', () => {
    const out = misplacedPlainNavMigrations([
      { id: '2026-03-04', date: '2026-03-04', netWorthUSD: 8200, totalActivosUSD: 8200, totalDebtUSD: 0, _source: 'ibkr' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].plainId).toBe('2026-03-04')
    expect(out[0].snap._docId).toBe(`2026-03-04${IBKR_NAV_DOC_SUFFIX}`)
    expect(out[0].snap.netWorthUSD).toBe(8200)
    expect(out[0].snap._source).toBe('ibkr')
  })

  it('docs ya paralelos, daily, backfill, quarterly y anclas: nada que mover', () => {
    const out = misplacedPlainNavMigrations([
      { id: `2026-03-04${IBKR_NAV_DOC_SUFFIX}`, date: '2026-03-04', netWorthUSD: 8200, _source: 'ibkr' },
      { id: '2026-03-05', date: '2026-03-05', netWorthUSD: 21000, _source: 'daily' },
      { id: '2026-03-06', date: '2026-03-06', netWorthUSD: 21000, _source: 'backfill' },
      { id: '2025-12-31', date: '2025-12-31', netWorthUSD: 5000, _source: 'ibkr_quarterly' },
      { id: '2026-01-01~cal~x', date: '2026-01-01', netWorthUSD: 9000, _source: 'manual', _account: 'x', _calibrated: true },
    ])
    expect(out).toHaveLength(0)
  })
})

describe('planQuarterlyNavWrite: una transcripcion no pisa lo ya medido (FASE KA)', () => {
  const D = '2026-08-20'

  it('fecha libre: doc plano, igual que siempre', () => {
    expect(planQuarterlyNavWrite(D, [])).toEqual({ action: 'write' })
  })

  it('el caso real: hoy tiene el daily del portafolio COMPLETO y la transcripcion se aparta', () => {
    // El trimestre EN CURSO se fecha HOY, y hoy casi siempre hay un 'daily'.
    // Sin esto, el NAV de UNA cuenta (10,012) reemplazaba el patrimonio entero
    // (27,233) EN EL MISMO doc, y como 'ibkr_quarterly' cuenta como cobertura
    // el backfill nunca lo volvia a rellenar: corrupcion permanente.
    const plan = planQuarterlyNavWrite(D, [
      { id: D, date: D, netWorthUSD: 27233.88, _source: 'daily' },
    ])
    expect(plan).toEqual({ action: 'write', docId: `${D}${IBKR_NAV_DOC_SUFFIX}` })
  })

  it('lo mismo con manual, backfill y con un doc viejo sin _source', () => {
    for (const src of ['manual', 'backfill', undefined]) {
      const plan = planQuarterlyNavWrite(D, [{ id: D, date: D, netWorthUSD: 27233.88, _source: src }])
      expect(plan.docId).toBe(`${D}${IBKR_NAV_DOC_SUFFIX}`)
    }
  })

  it('con el NAV DIARIO real del broker no se escribe: es la misma medicion, mas fina', () => {
    expect(planQuarterlyNavWrite(D, [
      { id: `${D}${IBKR_NAV_DOC_SUFFIX}`, date: D, netWorthUSD: 10012.27, _source: 'ibkr' },
    ])).toEqual({ action: 'skip', reason: 'broker-nav' })
  })

  it('re-transcribir actualiza el doc que ya existe, nunca duplica', () => {
    expect(planQuarterlyNavWrite(D, [
      { id: `${D}${IBKR_NAV_DOC_SUFFIX}`, date: D, netWorthUSD: 9000, _source: 'ibkr_quarterly' },
    ])).toEqual({ action: 'write', docId: `${D}${IBKR_NAV_DOC_SUFFIX}` })
    expect(planQuarterlyNavWrite(D, [
      { id: D, date: D, netWorthUSD: 9000, _source: 'ibkr_quarterly' },
    ])).toEqual({ action: 'write' })
  })

  it('anclas de calibracion y otras fechas no cuentan como ocupacion', () => {
    expect(planQuarterlyNavWrite(D, [
      { id: `${D}~cal~ibkr`, date: D, netWorthUSD: 5000, _source: 'manual', _account: 'ibkr', _calibrated: true },
      { id: '2026-08-19', date: '2026-08-19', netWorthUSD: 27000, _source: 'daily' },
    ])).toEqual({ action: 'write' })
  })

  it('un doc de portafolio en CERO no bloquea el slot (no es una medicion)', () => {
    expect(planQuarterlyNavWrite(D, [{ id: D, date: D, netWorthUSD: 0, _source: 'daily' }]))
      .toEqual({ action: 'write' })
  })
})

describe('applyNavMigrations: escribir primero, borrar despues (FASE JZ)', () => {
  const plainNav = (date, v) => ({ id: date, date, netWorthUSD: v, totalActivosUSD: v, totalDebtUSD: 0, _source: 'ibkr' })

  function spies({ failWrite = false } = {}) {
    const order = []
    return {
      order,
      bulkImport: jest.fn(async (payload) => {
        order.push(`write:${(payload.snapshots || []).map((s) => s._docId).join(',')}`)
        if (failWrite) throw new Error('firestore caido')
      }),
      deleteSnapshot: jest.fn(async (id) => { order.push(`delete:${id}`) }),
    }
  }

  it('el doc paralelo se escribe ANTES de borrar el plano', async () => {
    const sp = spies()
    const moved = await applyNavMigrations({
      snapshots: [plainNav('2026-03-04', 8200), plainNav('2026-03-05', 8300)],
      bulkImport: sp.bulkImport, deleteSnapshot: sp.deleteSnapshot,
    })
    expect(moved).toBe(2)
    expect(sp.order[0]).toBe(`write:2026-03-04${IBKR_NAV_DOC_SUFFIX},2026-03-05${IBKR_NAV_DOC_SUFFIX}`)
    expect(sp.order.slice(1)).toEqual(['delete:2026-03-04', 'delete:2026-03-05'])
  })

  it('si la escritura falla NO se borra nada, y lanza para que el caller aborte', async () => {
    // Este es el punto entero: borrar el plano sin haber guardado el NAV en
    // ningun lado lo pierde para siempre, y un caller que siga adelante
    // escribe su total compuesto encima del slot que el NAV todavia ocupa.
    const sp = spies({ failWrite: true })
    await expect(applyNavMigrations({
      snapshots: [plainNav('2026-03-04', 8200)],
      bulkImport: sp.bulkImport, deleteSnapshot: sp.deleteSnapshot,
    })).rejects.toThrow('firestore caido')
    expect(sp.deleteSnapshot).not.toHaveBeenCalled()
  })

  it('sin nada que migrar no toca Firestore', async () => {
    const sp = spies()
    const moved = await applyNavMigrations({
      snapshots: [{ id: '2026-03-05', date: '2026-03-05', netWorthUSD: 21000, _source: 'daily' }],
      bulkImport: sp.bulkImport, deleteSnapshot: sp.deleteSnapshot,
    })
    expect(moved).toBe(0)
    expect(sp.bulkImport).not.toHaveBeenCalled()
    expect(sp.deleteSnapshot).not.toHaveBeenCalled()
  })
})

describe('preferFullPortfolioPerDay: la vista de portafolio completo no cambia', () => {
  const daily = (date, v) => ({ id: date, date, netWorthUSD: v, _source: 'daily' })
  const nav = (date, v) => ({ id: `${date}~nav~ibkr`, date, netWorthUSD: v, _source: 'ibkr' })

  it('dia con ambos docs: gana la observacion completa, el NAV del broker se aparta', () => {
    const out = preferFullPortfolioPerDay([daily('2026-07-23', 23181), nav('2026-07-23', 10012)])
    expect(out).toHaveLength(1)
    expect(out[0]._source).toBe('daily')
  })

  it('dia solo con NAV de broker: se queda tal cual (el overlay lo completa como siempre)', () => {
    const list = [nav('2026-01-05', 5400), daily('2026-01-06', 13700)]
    const out = preferFullPortfolioPerDay(list)
    expect(out).toHaveLength(2)
  })

  it('sin fechas completas (portafolio solo-broker): misma referencia, cero cambio', () => {
    const list = [nav('2026-01-05', 5400), nav('2026-01-06', 5500)]
    expect(preferFullPortfolioPerDay(list)).toBe(list)
  })

  it('anclas de calibracion pasan intactas', () => {
    const cal = { id: 'c', date: '2026-07-23', netWorthUSD: 9000, _source: 'manual', _calibrated: true, _account: 'ibkr' }
    const out = preferFullPortfolioPerDay([daily('2026-07-23', 23181), nav('2026-07-23', 10012), cal])
    expect(out).toContain(cal)
    expect(out.filter((s) => s._source === 'ibkr' && !s._calibrated)).toHaveLength(0)
  })
})
