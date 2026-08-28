import { weekKeyFor, historyRow, buildSnapshot, withMovement, leaderStreak } from '../friendsHistory'
import { snapshotAllGroups, readRecentHistory, HISTORY_LOOKBACK } from '../friendsHistoryStore'

const SUN = new Date('2026-08-30T12:00:00Z') // domingo

describe('la llave de la semana', () => {
  test('un domingo es su propia semana', () => {
    expect(weekKeyFor(SUN)).toBe('2026-08-30')
  })

  test('cualquier dia de la semana cae en SU domingo', () => {
    // Una corrida tardia (un lunes, un reintento a mano) tiene que escribir en
    // la semana que le toca, no abrir una nueva.
    expect(weekKeyFor(new Date('2026-09-02T12:00:00Z'))).toBe('2026-08-30') // miercoles
    expect(weekKeyFor(new Date('2026-09-05T23:00:00Z'))).toBe('2026-08-30') // sabado
    expect(weekKeyFor(new Date('2026-09-06T00:00:00Z'))).toBe('2026-09-06') // domingo siguiente
  })

  test('la frontera es UTC, no la hora local del runner', () => {
    // La suite corre en America/Guatemala (jest.config.js). A las 23:30 del
    // sabado local ya es domingo en UTC: leerlo en local abriria la semana
    // equivocada.
    expect(weekKeyFor(new Date('2026-08-30T05:30:00Z'))).toBe('2026-08-30')
  })
})

describe('que se guarda de cada fila', () => {
  const full = {
    uid: 'u1', displayName: 'Ana', avatar: 'A', verified: true, isYou: true,
    outOfScope: false, ytd: 12.5, mtd: 1.2, day: 0.3, rank: 2,
    movers: [{ symbol: 'BTC', changePct: 3 }], dayAsOf: '2026-08-28',
    updatedAt: '2026-08-30T00:00:00Z', staleDays: 0,
  }

  test('solo nombre, porcentajes y puesto: ningun monto, y nada de una sola sesion', () => {
    expect(historyRow(full)).toEqual({ uid: 'u1', displayName: 'Ana', ytd: 12.5, mtd: 1.2, rank: 2 })
  })

  test('el nombre se guarda para que la historia siga siendo legible', () => {
    // Si solo se guardara el uid, una foto de hace un mes no se podria mostrar
    // despues de que esa persona dejara el grupo.
    expect(historyRow(full).displayName).toBe('Ana')
  })

  test('la foto lleva su semana y su alcance', () => {
    const doc = buildSnapshot({
      group: { id: 'g1' },
      standings: { scope: 'ibkr', memberCount: 3, rows: [full] },
      now: SUN,
    })
    expect(doc.weekKey).toBe('2026-08-30')
    expect(doc.groupId).toBe('g1')
    expect(doc.scope).toBe('ibkr')
    expect(doc.rows).toHaveLength(1)
  })
})

describe('el movimiento se mide sobre la MISMA gente', () => {
  const prev = (rows) => ({ weekKey: '2026-08-23', rows })

  test('pasar a alguien se reporta con su signo', () => {
    const previous = prev([
      { uid: 'a', ytd: 20, rank: 1 }, { uid: 'b', ytd: 10, rank: 2 },
    ])
    const rows = [{ uid: 'b', ytd: 30, rank: 1 }, { uid: 'a', ytd: 20, rank: 2 }]
    const out = withMovement({ rows, previous })
    expect(out.find((r) => r.uid === 'b').rankDelta).toBe(1)   // subio uno
    expect(out.find((r) => r.uid === 'a').rankDelta).toBe(-1)  // bajo uno
    expect(out[0].previousWeek).toBe('2026-08-23')
  })

  // ⛔ EL CASO QUE DEFINE EL DISENIO. Si alguien se va, todos los de abajo
  // suben un puesto sin haber hecho nada. Comparar puestos crudos fabricaria
  // un ascenso que nadie se gano.
  test('que alguien SE VAYA del grupo no regala un ascenso', () => {
    const previous = prev([
      { uid: 'a', ytd: 30, rank: 1 }, { uid: 'b', ytd: 20, rank: 2 }, { uid: 'c', ytd: 10, rank: 3 },
    ])
    // 'a' se fue. 'b' y 'c' no se movieron uno respecto del otro.
    const rows = [{ uid: 'b', ytd: 20, rank: 1 }, { uid: 'c', ytd: 10, rank: 2 }]
    const out = withMovement({ rows, previous })
    expect(out.find((r) => r.uid === 'b').rankDelta).toBe(0)
    expect(out.find((r) => r.uid === 'c').rankDelta).toBe(0)
  })

  test('que alguien ENTRE tampoco empuja a nadie hacia abajo', () => {
    const previous = prev([{ uid: 'b', ytd: 20, rank: 1 }, { uid: 'c', ytd: 10, rank: 2 }])
    const rows = [
      { uid: 'nuevo', ytd: 99, rank: 1 }, { uid: 'b', ytd: 20, rank: 2 }, { uid: 'c', ytd: 10, rank: 3 },
    ]
    const out = withMovement({ rows, previous })
    expect(out.find((r) => r.uid === 'b').rankDelta).toBe(0)
    expect(out.find((r) => r.uid === 'c').rankDelta).toBe(0)
    // Y del recien llegado no se afirma nada: no tiene semana anterior.
    expect(out.find((r) => r.uid === 'nuevo').rankDelta).toBe(null)
  })

  test('sin foto previa NO se afirma ningun movimiento', () => {
    const rows = [{ uid: 'a', ytd: 20, rank: 1 }, { uid: 'b', ytd: 10, rank: 2 }]
    for (const r of withMovement({ rows, previous: null })) {
      expect(r.rankDelta).toBe(null)
      expect(r.previousWeek).toBe(null)
    }
  })

  test('quien no tenia numero la semana pasada no recibe movimiento', () => {
    const previous = prev([{ uid: 'a', ytd: 20, rank: 1 }, { uid: 'b', ytd: null, rank: null }])
    const rows = [{ uid: 'b', ytd: 50, rank: 1 }, { uid: 'a', ytd: 20, rank: 2 }]
    const out = withMovement({ rows, previous })
    expect(out.find((r) => r.uid === 'b').rankDelta).toBe(null)
  })

  test('las filas sobreviven intactas: solo se AGREGAN dos campos', () => {
    const rows = [{ uid: 'a', ytd: 20, rank: 1, displayName: 'Ana', isYou: true }]
    const out = withMovement({ rows, previous: null })
    expect(out[0].displayName).toBe('Ana')
    expect(out[0].isYou).toBe(true)
  })
})

describe('la racha del lider', () => {
  const wk = (key, leaderUid, name = 'Beto') => ({
    weekKey: key, rows: [{ uid: leaderUid, displayName: name, ytd: 10, rank: 1 }, { uid: 'z', ytd: 1, rank: 2 }],
  })

  test('con una sola foto NO se afirma racha', () => {
    // Con una sola semana, "viene liderando" no dice nada que la tabla de hoy
    // no diga ya.
    expect(leaderStreak([wk('2026-08-23', 'a')])).toBe(null)
  })

  test('cuenta las semanas seguidas del mismo lider', () => {
    const s = leaderStreak([wk('2026-08-23', 'a'), wk('2026-08-16', 'a'), wk('2026-08-09', 'a')])
    expect(s.weeks).toBe(3)
    expect(s.uid).toBe('a')
  })

  test('se corta cuando cambia el lider', () => {
    const s = leaderStreak([wk('2026-08-23', 'a'), wk('2026-08-16', 'a'), wk('2026-08-09', 'b')])
    expect(s.weeks).toBe(2)
  })

  test('un lider recien llegado (una sola semana arriba) no es racha', () => {
    expect(leaderStreak([wk('2026-08-23', 'a'), wk('2026-08-16', 'b')])).toBe(null)
  })

  test('sin fotos no revienta', () => {
    expect(leaderStreak([])).toBe(null)
    expect(leaderStreak()).toBe(null)
  })
})

// ---- el almacen, contra un Firestore falso ---------------------------------
function fakeDb({ groups = [], profiles = {}, history = {} } = {}) {
  const writes = []
  const groupDocs = groups.map((g) => ({ id: g.id, data: () => g }))
  const db = {
    __writes: writes,
    collection: (name) => {
      if (name === 'friendGroups') {
        return {
          limit: () => ({ get: async () => ({ size: groupDocs.length, empty: groupDocs.length === 0, docs: groupDocs }) }),
          get: async () => ({ size: groupDocs.length, empty: groupDocs.length === 0, docs: groupDocs }),
          doc: (gid) => ({
            collection: () => ({
              doc: (wk) => ({ set: async (d) => { writes.push({ gid, wk, doc: d }) } }),
              orderBy: () => ({
                limit: (n) => ({
                  get: async () => ({
                    docs: (history[gid] || []).slice(0, n).map((h) => ({ data: () => h })),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      return { doc: (id) => ({ __id: id }) }
    },
    getAll: async (...refs) => refs.map((r) => ({
      id: r.__id, exists: !!profiles[r.__id], data: () => profiles[r.__id],
    })),
  }
  return db
}

const prof = (name, ytd) => ({
  displayName: name, avatar: name[0],
  stats: { all: { ytd, mtd: 1, movers: [], updatedAt: '2026-08-30T00:00:00Z' } },
  updatedAt: '2026-08-30T00:00:00Z',
})

describe('la foto semanal de todos los grupos', () => {
  test('escribe una foto por grupo, con la semana como id', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Cuates', scope: 'all', memberUids: ['a', 'b'] }],
      profiles: { a: prof('Ana', 12), b: prof('Beto', 20) },
    })
    const out = await snapshotAllGroups({ db, now: SUN })
    expect(out.written).toBe(1)
    expect(db.__writes[0].wk).toBe('2026-08-30')
    expect(db.__writes[0].doc.rows.map((r) => r.displayName)).toEqual(['Beto', 'Ana'])
  })

  // El id ES la semana, no el instante: dos corridas del mismo domingo (un
  // reintento del cron) escriben el mismo doc en vez de dos.
  test('dos corridas del mismo domingo escriben el MISMO doc', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Cuates', scope: 'all', memberUids: ['a', 'b'] }],
      profiles: { a: prof('Ana', 12), b: prof('Beto', 20) },
    })
    await snapshotAllGroups({ db, now: SUN })
    await snapshotAllGroups({ db, now: new Date('2026-08-30T23:00:00Z') })
    expect(new Set(db.__writes.map((w) => w.wk)).size).toBe(1)
  })

  test('un grupo con una sola persona publicando no deja foto', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Solos', scope: 'all', memberUids: ['a', 'b'] }],
      profiles: { a: prof('Ana', 12) },
    })
    const out = await snapshotAllGroups({ db, now: SUN })
    expect(out.written).toBe(0)
    expect(out.skipped).toBe(1)
  })

  test('un grupo sin miembros no revienta (getAll sin argumentos lanza)', async () => {
    const db = fakeDb({ groups: [{ id: 'g1', name: 'Vacio', scope: 'all', memberUids: [] }] })
    const out = await snapshotAllGroups({ db, now: SUN })
    expect(out.skipped).toBe(1)
    expect(out.failed).toBe(0)
  })

  test('un grupo que falla no tumba a los demas', async () => {
    const db = fakeDb({
      groups: [
        { id: 'malo', name: 'X', scope: 'all', memberUids: null },
        { id: 'g2', name: 'Cuates', scope: 'all', memberUids: ['a', 'b'] },
      ],
      profiles: { a: prof('Ana', 12), b: prof('Beto', 20) },
    })
    const out = await snapshotAllGroups({ db, now: SUN })
    expect(out.written).toBe(1)
  })

  test('la foto respeta el ALCANCE del grupo', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Brokers', scope: 'ibkr', memberUids: ['a', 'b'] }],
      profiles: {
        a: { ...prof('Ana', 99), stats: { all: { ytd: 99 }, ibkr: { ytd: 7, updatedAt: '2026-08-30T00:00:00Z' } } },
        b: { ...prof('Beto', 55), stats: { all: { ytd: 55 }, ibkr: { ytd: 4, updatedAt: '2026-08-30T00:00:00Z' } } },
      },
    })
    await snapshotAllGroups({ db, now: SUN })
    expect(db.__writes[0].doc.rows.map((r) => r.ytd)).toEqual([7, 4])
  })
})

describe('leer la historia reciente', () => {
  // ⛔ La garantia que hace que el orden de las dos pasadas del cron no importe.
  test('EXCLUYE la semana en curso', async () => {
    const db = fakeDb({
      groups: [], history: { g1: [
        { weekKey: '2026-08-30', rows: [] }, // la de HOY, escrita por este mismo cron
        { weekKey: '2026-08-23', rows: [] },
        { weekKey: '2026-08-16', rows: [] },
      ] },
    })
    const out = await readRecentHistory({ db, groupId: 'g1', now: SUN })
    expect(out.map((h) => h.weekKey)).toEqual(['2026-08-23', '2026-08-16'])
  })

  test('devuelve de la mas nueva a la mas vieja, acotado', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ weekKey: `2026-0${i < 5 ? 8 : 7}-0${i}`, rows: [] }))
    const db = fakeDb({ history: { g1: many } })
    const out = await readRecentHistory({ db, groupId: 'g1', now: SUN })
    expect(out.length).toBeLessThanOrEqual(HISTORY_LOOKBACK)
  })

  test('sin historia devuelve vacio, no null', async () => {
    const db = fakeDb({ history: {} })
    expect(await readRecentHistory({ db, groupId: 'g1', now: SUN })).toEqual([])
  })
})
