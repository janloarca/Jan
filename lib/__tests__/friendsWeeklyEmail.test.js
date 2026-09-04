import { buildFriendsWeeklyEmail, standingSentence, fmtPct, weekLabel } from '../friendsWeeklyEmail'
import { buildFriendsWeeklyForUser } from '../friendsWeeklyBuilder'

const NOW = new Date('2026-08-30T12:00:00Z') // un domingo

const row = (over = {}) => ({
  uid: 'u1', isYou: false, displayName: 'Ana', avatar: 'A', verified: false,
  outOfScope: false, ytd: 10, mtd: 2, day: 0.5, movers: [],
  dayAsOf: '2026-08-28', updatedAt: '2026-08-30T00:00:00Z', staleDays: 0, rank: 1,
  ...over,
})

describe('el formato de las cifras', () => {
  test('siempre dos decimales y signo explicito', () => {
    // Dos decimales fijos es lo que hace que la columna se lea como columna
    // (regla 3 de emailLayout), y el signo es lo que le da color.
    expect(fmtPct(10)).toBe('+10.00%')
    expect(fmtPct(-2.5)).toBe('-2.50%')
    expect(fmtPct(0)).toBe('+0.00%')
  })

  test('sin dato es un guion, jamas un cero', () => {
    expect(fmtPct(null)).toBe('-')
    expect(fmtPct(undefined)).toBe('-')
    expect(fmtPct('nada')).toBe('-')
  })

  test('la etiqueta de semana cubre siete dias y cierra hoy', () => {
    expect(weekLabel(NOW)).toBe('Aug 24-Aug 30, 2026')
  })
})

describe('donde quedaste, en una linea', () => {
  test('lider: dice a cuanto va del segundo', () => {
    const rows = [row({ uid: 'me', isYou: true, ytd: 20, rank: 1 }), row({ uid: 'u2', displayName: 'Beto', ytd: 12, rank: 2 })]
    expect(standingSentence({ rows })).toBe('You are 1st of 2, 8.00 points ahead of Beto.')
  })

  test('atras: dice a cuanto esta del lider', () => {
    const rows = [row({ uid: 'u2', displayName: 'Beto', ytd: 20, rank: 1 }), row({ uid: 'me', isYou: true, ytd: 12, rank: 2 })]
    expect(standingSentence({ rows })).toBe('You are 2nd of 2, 8.00 points behind Beto.')
  })

  test('el ordinal es correcto en 3 (donde un sufijo ingenuo falla)', () => {
    const rows = [
      row({ uid: 'a', ytd: 30, rank: 1 }), row({ uid: 'b', ytd: 20, rank: 2 }),
      row({ uid: 'me', isYou: true, ytd: 10, rank: 3 }),
    ]
    expect(standingSentence({ rows })).toContain('3rd of 3')
  })

  test('sin haber publicado: lo dice, no te pone ultimo', () => {
    const rows = [row({ uid: 'u2', ytd: 20, rank: 1 }), row({ uid: 'me', isYou: true, ytd: null, rank: null })]
    expect(standingSentence({ rows })).toMatch(/have not published/)
  })

  test('sin datos para el ALCANCE del grupo dice esa razon, no la otra', () => {
    const rows = [row({ uid: 'u2', ytd: 20, rank: 1 }), row({ uid: 'me', isYou: true, ytd: null, rank: null, outOfScope: true })]
    expect(standingSentence({ rows })).toMatch(/no numbers for this scope/)
  })

  test('sin fila tuya no se inventa ninguna frase', () => {
    expect(standingSentence({ rows: [row()] })).toBe(null)
  })
})

describe('el correo', () => {
  const group = {
    name: 'Los Cuates', scope: 'all', memberCount: 4, pendingCount: 1,
    rows: [
      row({ uid: 'u2', displayName: 'Beto', ytd: 20, mtd: 3, rank: 1 }),
      row({ uid: 'me', isYou: true, displayName: 'Ana', ytd: 12, mtd: 1, rank: 2 }),
      row({ uid: 'u3', displayName: 'Caro', ytd: null, rank: null, outOfScope: true }),
    ],
  }

  test('trae asunto, HTML y texto, con las posiciones adentro', () => {
    const m = buildFriendsWeeklyEmail({ groups: [group], now: NOW })
    expect(m.subject).toBe('Chispudo Friends · Aug 24-Aug 30, 2026')
    for (const body of [m.html, m.text]) {
      // El nombre del grupo es un ENCABEZADO, y renderEmail los pone en
      // mayusculas en la version de texto (y por CSS en el HTML): la
      // comparacion va sin distinguir caja, como en el resto del repo.
      expect(body.toLowerCase()).toContain('los cuates')
      expect(body).toContain('1. Beto')
      expect(body).toContain('2. Ana (you)')
      expect(body).toContain('+20.00%')
      expect(body).toContain('2nd of 2')
    }
  })

  test('el mes viaja ROTULADO en la nota, para que no se lea como otro anio', () => {
    const m = buildFriendsWeeklyEmail({ groups: [group], now: NOW })
    expect(m.text).toContain('month +3.00%')
  })

  test('una fila sin datos para el alcance lo DICE en vez de mostrar un cero', () => {
    const m = buildFriendsWeeklyEmail({ groups: [group], now: NOW })
    expect(m.text).toContain('no data for this scope')
    expect(m.text).toContain('Caro')
  })

  test('una fila vieja se marca con sus dias', () => {
    const g = { ...group, rows: [row({ isYou: true, ytd: 5, staleDays: 12, rank: 1 }), row({ uid: 'u2', ytd: 3, rank: 2 })] }
    expect(buildFriendsWeeklyEmail({ groups: [g], now: NOW }).text).toContain('12d old')
  })

  test('los que no publicaron se nombran', () => {
    expect(buildFriendsWeeklyEmail({ groups: [group], now: NOW }).text).toMatch(/1 member has joined but not published/)
  })

  test('un grupo de broker dice su alcance', () => {
    const g = { ...group, scope: 'ibkr' }
    expect(buildFriendsWeeklyEmail({ groups: [g], now: NOW }).text.toLowerCase()).toContain('ibkr only')
  })

  // ⛔ El contrato de privacidad, del lado del correo: solo porcentajes.
  test('ningun monto sale en el correo', () => {
    const m = buildFriendsWeeklyEmail({ groups: [group], now: NOW })
    expect(m.text).not.toMatch(/\$\s?\d/)
    expect(m.html).not.toMatch(/\$\s?\d/)
  })

  // Este test fijaba que el correo NO afirmara movimiento, porque en FASE LR
  // no existia memoria por semana contra la cual compararse. Desde FASE LS si
  // existe, asi que el invariante honesto cambio de "nunca lo dice" a "solo lo
  // dice cuando hay foto previa": describia la ausencia de una capacidad, no
  // una regla, y por eso actualizarlo es correcto.
  test('SIN foto previa no afirma ningun movimiento ni racha', () => {
    const m = buildFriendsWeeklyEmail({ groups: [group], now: NOW })
    for (const body of [m.text, m.html]) {
      expect(body).not.toMatch(/passed/)
      expect(body).not.toMatch(/led for/)
      // Ni las flechas, ni su leyenda: explicar un simbolo que no esta en
      // pantalla es ruido.
      expect(body).not.toMatch(/[▲▼]/)
      expect(body).not.toMatch(/arrow counts how many people/)
    }
  })

  describe('con memoria de la semana pasada (FASE LS)', () => {
    const movido = {
      ...group,
      rows: [
        row({ uid: 'me', isYou: true, displayName: 'Ana', ytd: 30, mtd: 2, rank: 1, rankDelta: 1, previousWeek: '2026-08-23' }),
        row({ uid: 'u2', displayName: 'Beto', ytd: 20, mtd: 3, rank: 2, rankDelta: -1, previousWeek: '2026-08-23' }),
        row({ uid: 'u3', displayName: 'Caro', ytd: 5, rank: 3, rankDelta: 0, previousWeek: '2026-08-23' }),
      ],
    }

    test('las flechas van pegadas al NOMBRE, no a la nota (que ya lleva el mes)', () => {
      const m = buildFriendsWeeklyEmail({ groups: [movido], now: NOW })
      expect(m.text).toContain('1. Ana (you) ▲1')
      expect(m.text).toContain('2. Beto ▼1')
      expect(m.text).toContain('month +3.00%')
    })

    test('quien NO se movio no lleva un cero al lado', () => {
      // Un "0" en cada fila quieta es ruido, y peor, se lee como si el cero
      // fuera un dato de esta semana.
      const m = buildFriendsWeeklyEmail({ groups: [movido], now: NOW })
      expect(m.text).toContain('3. Caro')
      expect(m.text).not.toMatch(/Caro ?[▲▼]/)
    })

    test('tu movimiento se dice en PERSONAS, nombrando la semana comparada', () => {
      const m = buildFriendsWeeklyEmail({ groups: [movido], now: NOW })
      expect(m.text).toContain('You passed one person since the week of Aug 23.')
    })

    test('haber sido pasado se dice tambien, no solo lo bueno', () => {
      const g = { ...movido, rows: [
        row({ uid: 'u2', displayName: 'Beto', ytd: 30, rank: 1, rankDelta: 1, previousWeek: '2026-08-23' }),
        row({ uid: 'me', isYou: true, ytd: 20, rank: 2, rankDelta: -2, previousWeek: '2026-08-23' }),
      ] }
      expect(buildFriendsWeeklyEmail({ groups: [g], now: NOW }).text)
        .toContain('2 people passed you since the week of Aug 23.')
    })

    test('la leyenda de las flechas aparece SOLO cuando hay flechas', () => {
      expect(buildFriendsWeeklyEmail({ groups: [movido], now: NOW }).text)
        .toContain('arrow counts how many people')
    })

    test('la racha se dice cuando la hay', () => {
      const g = { ...movido, streak: { uid: 'u2', displayName: 'Beto', weeks: 3 } }
      expect(buildFriendsWeeklyEmail({ groups: [g], now: NOW }).text)
        .toContain('Beto has led for 3 weeks running.')
    })

    test('y las cifras siguen siendo solo porcentajes', () => {
      const m = buildFriendsWeeklyEmail({ groups: [movido], now: NOW })
      expect(m.text).not.toMatch(/\$\s?\d/)
      expect(m.html).not.toMatch(/\$\s?\d/)
    })
  })
})

// ---- el builder completo, contra un Firestore falso -------------------------
function fakeDb({ groups = [], profiles = {}, history = {} } = {}) {
  const docs = groups.map((g) => ({ id: g.id, data: () => g }))
  return {
    collection: (name) => {
      if (name === 'friendGroups') {
        return {
          where: () => ({ get: async () => ({ empty: docs.length === 0, docs }) }),
          doc: (gid) => ({
            __id: gid,
            collection: () => ({
              orderBy: () => ({ limit: (n) => ({ get: async () => ({
                docs: (history[gid] || []).slice(0, n).map((h) => ({ data: () => h })),
              }) }) }),
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
}

const p = (name, ytd, extra = {}) => ({
  displayName: name, avatar: name[0], verified: false,
  stats: { all: { ytd, mtd: 1, movers: [], updatedAt: '2026-08-30T00:00:00Z' }, ...extra },
  updatedAt: '2026-08-30T00:00:00Z',
})

describe('el builder lee los grupos y arma el correo', () => {
  test('con dos personas publicando manda el correo', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Los Cuates', scope: 'all', memberUids: ['me', 'u2'] }],
      profiles: { me: p('Ana', 12), u2: p('Beto', 20) },
    })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.subject).toContain('Chispudo Friends')
    expect(mail.text.toLowerCase()).toContain('los cuates')
    expect(mail.text).toContain('Ana (you)')
  })

  test('sin grupos NO manda nada', async () => {
    const mail = await buildFriendsWeeklyForUser({ db: fakeDb(), uid: 'me', now: NOW })
    expect(mail).toBe(null)
  })

  // Una tabla de posiciones de UNA fila no es una comparacion: es ruido
  // semanal sobre algo que la persona ya sabe.
  test('un grupo donde solo vos publicaste NO genera correo', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Solos', scope: 'all', memberUids: ['me', 'u2'] }],
      profiles: { me: p('Ana', 12) },
    })
    expect(await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })).toBe(null)
  })

  test('con Amigos APAGADO no manda nada', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Los Cuates', scope: 'all', memberUids: ['me', 'u2'] }],
      profiles: { me: p('Ana', 12), u2: p('Beto', 20) },
    })
    expect(await buildFriendsWeeklyForUser({ db, uid: 'me', prefs: { friendsEnabled: false }, now: NOW })).toBe(null)
  })

  test('omite el grupo flojo y manda el que si compara', async () => {
    const db = fakeDb({
      groups: [
        { id: 'g1', name: 'Solos', scope: 'all', memberUids: ['me', 'u3'] },
        { id: 'g2', name: 'Los Cuates', scope: 'all', memberUids: ['me', 'u2'] },
      ],
      profiles: { me: p('Ana', 12), u2: p('Beto', 20) },
    })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text.toLowerCase()).toContain('los cuates')
    expect(mail.text.toLowerCase()).not.toContain('solos')
  })

  // ⛔ El alcance del grupo se respeta igual que en la pantalla: nunca se cae
  // al portafolio completo de alguien que no tiene broker.
  test('en un grupo de broker no se publica el portafolio completo de nadie', async () => {
    const db = fakeDb({
      groups: [{ id: 'g1', name: 'Brokers', scope: 'ibkr', memberUids: ['me', 'u2'] }],
      profiles: {
        me: p('Ana', 99, { ibkr: { ytd: 7, mtd: 1, movers: [], updatedAt: '2026-08-30T00:00:00Z' } }),
        u2: p('Beto', 55, { ibkr: { ytd: 4, mtd: 1, movers: [], updatedAt: '2026-08-30T00:00:00Z' } }),
      },
    })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('+7.00%')
    expect(mail.text).toContain('+4.00%')
    expect(mail.text).not.toContain('+99.00%')
    expect(mail.text).not.toContain('+55.00%')
  })

  test('un grupo sin miembros no revienta (getAll sin argumentos lanza)', async () => {
    const db = fakeDb({ groups: [{ id: 'g1', name: 'Vacio', scope: 'all', memberUids: [] }] })
    expect(await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })).toBe(null)
  })
})

// ---- de punta a punta: la memoria llega al correo --------------------------
describe('el builder lee la memoria y el correo la usa (FASE LS)', () => {
  const groups = [{ id: 'g1', name: 'Los Cuates', scope: 'all', memberUids: ['me', 'u2'] }]
  const profiles = { me: p('Ana', 30), u2: p('Beto', 20) }

  test('con foto de la semana pasada, el correo reporta el movimiento real', async () => {
    const db = fakeDb({
      groups, profiles,
      history: { g1: [
        // La semana pasada Beto iba arriba; esta semana Ana lo paso.
        { weekKey: '2026-08-23', rows: [
          { uid: 'u2', displayName: 'Beto', ytd: 25, rank: 1 },
          { uid: 'me', displayName: 'Ana', ytd: 10, rank: 2 },
        ] },
      ] },
    })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('1. Ana (you) ▲1')
    expect(mail.text).toContain('2. Beto ▼1')
    expect(mail.text).toContain('You passed one person since the week of Aug 23.')
  })

  test('SIN memoria el correo sale igual que antes de que existiera', async () => {
    const db = fakeDb({ groups, profiles, history: {} })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('1. Ana (you)')
    expect(mail.text).not.toMatch(/[▲▼]/)
    expect(mail.text).not.toMatch(/passed/)
  })

  test('la foto de ESTA semana no se usa como referencia', async () => {
    // Si se usara, el movimiento contra uno mismo saldria siempre cero y el
    // resultado dependeria de si el cron ya escribio la foto de hoy.
    const db = fakeDb({
      groups, profiles,
      history: { g1: [
        { weekKey: '2026-08-30', rows: [
          { uid: 'me', displayName: 'Ana', ytd: 30, rank: 1 },
          { uid: 'u2', displayName: 'Beto', ytd: 20, rank: 2 },
        ] },
        { weekKey: '2026-08-23', rows: [
          { uid: 'u2', displayName: 'Beto', ytd: 25, rank: 1 },
          { uid: 'me', displayName: 'Ana', ytd: 10, rank: 2 },
        ] },
      ] },
    })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('You passed one person since the week of Aug 23.')
  })

  // ⛔ REGRESIÓN. Este test afirmaba "Beto has led for 3 weeks running" sobre
  // este MISMO fixture, donde hoy lidera Ana (30 contra 20): o sea fijaba una
  // frase que contradecía a la tabla impresa dos centímetros arriba. La causa
  // era que la racha se calculaba solo con `readRecentHistory`, que excluye la
  // semana en curso a propósito. El valor viejo describía el defecto, no un
  // invariante, así que actualizarlo es correcto (a diferencia del candado de
  // 3.94%).
  test('con el liderazgo cambiado esta semana NO se afirma la racha del anterior', async () => {
    const wk = (key) => ({ weekKey: key, rows: [
      { uid: 'u2', displayName: 'Beto', ytd: 25, rank: 1 },
      { uid: 'me', displayName: 'Ana', ytd: 10, rank: 2 },
    ] })
    const db = fakeDb({ groups, profiles, history: { g1: [wk('2026-08-23'), wk('2026-08-16'), wk('2026-08-09')] } })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).not.toContain('has led for')
    // Control positivo: el correo SÍ salió y la tabla dice quién lidera hoy, o
    // sea la ausencia de la frase no es "no se generó nada".
    expect(mail.text).toContain('Ana')
  })

  test('una racha de varias semanas cuenta TAMBIEN la semana en curso', async () => {
    // Hoy lidera Ana (30 vs 20), y también lideró las tres anteriores: la racha
    // real es CUATRO. Antes se contaban solo las fotos pasadas, o sea una menos.
    const wk = (key) => ({ weekKey: key, rows: [
      { uid: 'me', displayName: 'Ana', ytd: 25, rank: 1 },
      { uid: 'u2', displayName: 'Beto', ytd: 10, rank: 2 },
    ] })
    const db = fakeDb({ groups, profiles, history: { g1: [wk('2026-08-23'), wk('2026-08-16'), wk('2026-08-09')] } })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('Ana has led for 4 weeks running.')
  })

  // ⛔ "Seguidas" quiere decir seguidas. `snapshotAllGroups` salta los grupos
  // que esa semana tuvieron menos de dos personas con número, así que la
  // historia puede tener huecos: dos fotos separadas por tres meses producían
  // "ha liderado 2 semanas seguidas".
  test('con un hueco de semanas la racha NO cruza el hueco', async () => {
    const wk = (key) => ({ weekKey: key, rows: [
      { uid: 'me', displayName: 'Ana', ytd: 25, rank: 1 },
      { uid: 'u2', displayName: 'Beto', ytd: 10, rank: 2 },
    ] })
    // 08-23 es la semana pasada; 05-31 está a tres meses.
    const db = fakeDb({ groups, profiles, history: { g1: [wk('2026-08-23'), wk('2026-05-31')] } })
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail.text).toContain('Ana has led for 2 weeks running.')
    expect(mail.text).not.toContain('3 weeks')
  })

  test('si la lectura de historia FALLA, el correo sale igual sin movimiento', async () => {
    // Perder el correo entero por un adorno seria peor que mandarlo sin el.
    const db = fakeDb({ groups, profiles })
    db.collection = ((orig) => (name) => {
      const c = orig(name)
      if (name !== 'friendGroups') return c
      return { ...c, doc: (gid) => ({ __id: gid, collection: () => { throw new Error('boom') } }) }
    })(db.collection)
    const mail = await buildFriendsWeeklyForUser({ db, uid: 'me', now: NOW })
    expect(mail).not.toBe(null)
    expect(mail.text).toContain('1. Ana (you)')
    expect(mail.text).not.toMatch(/[▲▼]/)
  })
})
