import { statsForScope, staleDaysOf, groupStandings, rankedCount, STALE_AFTER_DAYS } from '../friendsGroups'

const NOW = Date.parse('2026-08-27T12:00:00Z')

const prof = (over = {}) => ({
  displayName: 'Ana', avatar: 'A', verified: false,
  stats: { all: { ytd: 10, mtd: 2, day: 0.5, movers: [], updatedAt: '2026-08-27T00:00:00Z' } },
  updatedAt: '2026-08-27T00:00:00Z',
  ...over,
})

describe('el alcance del grupo nunca cae al portafolio completo', () => {
  test('un grupo "todo" lee el bloque all', () => {
    expect(statsForScope(prof(), 'all').ytd).toBe(10)
  })

  test('un grupo de broker SIN bloque de broker devuelve null, no el bloque all', () => {
    // Caer al bloque `all` haria dos danios a la vez: la comparacion deja de
    // ser la que el grupo dice ser, y esa persona publica MAS de lo que acepto.
    expect(statsForScope(prof(), 'ibkr')).toBe(null)
  })

  test('un grupo de broker CON bloque de broker lee el suyo', () => {
    const p = prof({ stats: { all: { ytd: 10 }, ibkr: { ytd: 30 } } })
    expect(statsForScope(p, 'ibkr').ytd).toBe(30)
  })
})

describe('la frescura de una fila', () => {
  test('sin fecha es null, no cero: "no se" y "hoy" son cosas distintas', () => {
    expect(staleDaysOf(null, NOW)).toBe(null)
    expect(staleDaysOf('no es una fecha', NOW)).toBe(null)
  })

  test('cuenta dias completos', () => {
    expect(staleDaysOf('2026-08-27T00:00:00Z', NOW)).toBe(0)
    expect(staleDaysOf('2026-08-18T00:00:00Z', NOW)).toBe(9)
  })

  test('una marca en el futuro no produce dias negativos', () => {
    expect(staleDaysOf('2026-09-01T00:00:00Z', NOW)).toBe(0)
  })
})

describe('la tabla del grupo', () => {
  const group = { scope: 'all', memberUids: ['u1', 'u2', 'u3', 'u4'] }
  const profiles = [
    { uid: 'u1', profile: prof({ displayName: 'Ana', stats: { all: { ytd: 5, mtd: 1 } } }) },
    { uid: 'u2', profile: prof({ displayName: 'Beto', stats: { all: { ytd: 20, mtd: 3 } } }) },
    { uid: 'u3', profile: prof({ displayName: 'Caro', stats: { all: { ytd: -2, mtd: -1 } } }) },
  ]

  test('ordena por retorno del anio, de mayor a menor', () => {
    const { rows } = groupStandings({ group, profiles, viewerUid: 'u1', nowTs: NOW })
    expect(rows.map((r) => r.displayName)).toEqual(['Beto', 'Ana', 'Caro'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  test('marca cual sos vos', () => {
    const { rows } = groupStandings({ group, profiles, viewerUid: 'u1', nowTs: NOW })
    expect(rows.filter((r) => r.isYou).map((r) => r.displayName)).toEqual(['Ana'])
  })

  test('los que entraron y no publicaron se CUENTAN, no desaparecen', () => {
    // Antes la tarjeta decia "4 miembros" y mostraba 3 sin explicar el otro:
    // desde afuera, una fila que falta y una tabla rota se ven igual.
    const s = groupStandings({ group, profiles, viewerUid: 'u1', nowTs: NOW })
    expect(s.memberCount).toBe(4)
    expect(s.pendingCount).toBe(1)
  })

  test('una fila SIN numero no recibe puesto: no esta ultima, no esta en la carrera', () => {
    const conVacio = [...profiles, { uid: 'u4', profile: prof({ displayName: 'Dani', stats: { all: {} } }) }]
    const { rows } = groupStandings({ group, profiles: conVacio, viewerUid: 'u1', nowTs: NOW })
    const dani = rows.find((r) => r.displayName === 'Dani')
    expect(dani.ytd).toBe(null)
    expect(dani.rank).toBe(null)
    // Y sigue en la tabla: existe en el grupo.
    expect(rows).toHaveLength(4)
  })

  test('empate: dos primeros y despues un tercero', () => {
    const empate = [
      { uid: 'u1', profile: prof({ displayName: 'Ana', stats: { all: { ytd: 20 } } }) },
      { uid: 'u2', profile: prof({ displayName: 'Beto', stats: { all: { ytd: 20 } } }) },
      { uid: 'u3', profile: prof({ displayName: 'Caro', stats: { all: { ytd: 5 } } }) },
    ]
    const { rows } = groupStandings({ group, profiles: empate, viewerUid: 'u1', nowTs: NOW })
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3])
  })

  test('en un grupo de broker, quien no tiene broker sale marcado y sin cifras', () => {
    const g = { scope: 'ibkr', memberUids: ['u1', 'u2'] }
    const p = [
      { uid: 'u1', profile: prof({ displayName: 'Ana', stats: { all: { ytd: 99 }, ibkr: { ytd: 7 } } }) },
      { uid: 'u2', profile: prof({ displayName: 'Beto', stats: { all: { ytd: 50 } } }) },
    ]
    const { rows } = groupStandings({ group: g, profiles: p, viewerUid: 'u1', nowTs: NOW })
    const beto = rows.find((r) => r.displayName === 'Beto')
    expect(beto.outOfScope).toBe(true)
    expect(beto.ytd).toBe(null)
    // Y sobre todo: NO se le publico su 50 del portafolio completo.
    expect(rows.find((r) => r.displayName === 'Ana').ytd).toBe(7)
  })

  test('marca la fila vieja con sus dias', () => {
    const viejo = [{ uid: 'u1', profile: prof({ stats: { all: { ytd: 5, updatedAt: '2026-08-10T00:00:00Z' } } }) }]
    const { rows } = groupStandings({ group, profiles: viejo, viewerUid: 'u1', nowTs: NOW })
    expect(rows[0].staleDays).toBe(17)
    expect(rows[0].staleDays).toBeGreaterThanOrEqual(STALE_AFTER_DAYS)
  })

  test('el contrato de privacidad: ninguna llave de fila puede ser un monto', () => {
    const { rows } = groupStandings({ group, profiles, viewerUid: 'u1', nowTs: NOW })
    expect(Object.keys(rows[0]).sort()).toEqual([
      // `rankMtd` se agregó con el arreglo del selector "Este mes" (la pantalla
      // reordenaba por mes y numeraba por el puesto del AÑO). Actualizar esta
      // lista es correcto acá porque es un PUESTO, no un monto: el contrato que
      // este test fija sigue intacto, y de hecho es él quien obliga a mirar cada
      // llave nueva antes de que salga hacia otra persona.
      'avatar', 'day', 'dayAsOf', 'displayName', 'isYou', 'movers', 'mtd',
      'outOfScope', 'rank', 'rankMtd', 'staleDays', 'uid', 'updatedAt', 'verified', 'ytd',
    ])
  })

  test('un grupo sin miembros no revienta', () => {
    const s = groupStandings({ group: { scope: 'all', memberUids: [] }, profiles: [], nowTs: NOW })
    expect(s.rows).toEqual([])
    expect(s.pendingCount).toBe(0)
  })
})

describe('cuantos tienen numero comparable', () => {
  test('cuenta solo los que publicaron', () => {
    expect(rankedCount([{ ytd: 1 }, { ytd: null }, { ytd: -3 }])).toBe(2)
    expect(rankedCount([])).toBe(0)
    expect(rankedCount(null)).toBe(0)
  })
})


// ⛔ La pantalla tiene un selector "Año / Este mes" que REORDENA las filas, pero
// el número, la medalla y la corona salían de `rank`, que siempre era el del
// AÑO. Con "Este mes" la columna se leía 2, 1, 3 y la corona marcaba al líder
// del año aunque no estuviera arriba. El campo se emitía sin decir de qué
// métrica era, y el consumidor lo tomó como "el puesto" a secas.
describe('el puesto existe para las dos métricas', () => {
  const p = (name, ytd, mtd) => ({ displayName: name, stats: { all: { ytd, mtd, updatedAt: '2026-08-27T00:00:00Z' } } })
  const grp = { scope: 'all', memberUids: ['a', 'b', 'c'] }
  // Orden por año: A, B, C. Por mes: C, B, A. O sea INVERTIDO a propósito.
  const profs = [
    { uid: 'a', profile: p('A', 30, 1) },
    { uid: 'b', profile: p('B', 20, 5) },
    { uid: 'c', profile: p('C', 10, 9) },
  ]

  test('rank es el del año y rankMtd el del mes', () => {
    const { rows } = groupStandings({ group: grp, profiles: profs, nowTs: Date.parse('2026-08-27T00:00:00Z') })
    const by = Object.fromEntries(rows.map((r) => [r.uid, r]))
    expect([by.a.rank, by.b.rank, by.c.rank]).toEqual([1, 2, 3])
    expect([by.a.rankMtd, by.b.rankMtd, by.c.rankMtd]).toEqual([3, 2, 1])
  })

  test('quien no tiene la métrica no recibe puesto en ELLA, pero sí en la otra', () => {
    const mixto = [
      { uid: 'a', profile: { displayName: 'A', stats: { all: { ytd: 30 } } } },
      { uid: 'b', profile: p('B', 20, 5) },
    ]
    const { rows } = groupStandings({ group: { scope: 'all', memberUids: ['a', 'b'] }, profiles: mixto })
    const by = Object.fromEntries(rows.map((r) => [r.uid, r]))
    expect(by.a.rank).toBe(1)
    expect(by.a.rankMtd).toBe(null)
    expect(by.b.rankMtd).toBe(1)
  })

  test('empates: mismo puesto y el siguiente salta, en las dos métricas', () => {
    const emp = [
      { uid: 'a', profile: p('A', 10, 10) },
      { uid: 'b', profile: p('B', 10, 10) },
      { uid: 'c', profile: p('C', 5, 5) },
    ]
    const { rows } = groupStandings({ group: grp, profiles: emp })
    const by = Object.fromEntries(rows.map((r) => [r.uid, r]))
    expect([by.a.rank, by.b.rank, by.c.rank]).toEqual([1, 1, 3])
    expect([by.a.rankMtd, by.b.rankMtd, by.c.rankMtd]).toEqual([1, 1, 3])
  })
})

// GUARDIÁN DE FUENTE. La tarjeta no puede volver a numerar una lista ordenada
// por una métrica con los puestos de la otra.
describe('la tarjeta usa el puesto de la métrica activa', () => {
  test('GroupCard resuelve el puesto según metric', () => {
    const fs = require('fs')
    const path = require('path')
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/friends/GroupCard.jsx'), 'utf8')
    expect(src).toMatch(/metric === 'mtd' \? r\.rankMtd : r\.rank/)
    // Y no queda ningún uso crudo de `r.rank` decidiendo el podio o el número.
    expect(src).not.toMatch(/isPodium = r\.rank/)
    expect(src).not.toMatch(/MEDALS\[r\.rank/)
  })
})
