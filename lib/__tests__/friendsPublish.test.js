import {
  publishDayKey, shouldPublishToday, publishIdentity,
  buildPublishStats, hasSomethingToPublish, buildPublishPayload,
} from '../friendsPublish'

const item = (over = {}) => ({
  id: 'i1', symbol: 'AAA', name: 'Alpha', type: 'Stock',
  quantity: 10, currentPrice: 100, change1d: 2, _priceAsOf: '2026-08-25',
  ...over,
})

describe('la cadencia es por día UTC', () => {
  test('la llave es la fecha UTC, no la local', () => {
    // 23:30 en Guatemala (UTC-6) del 25 de agosto ya es el 26 en UTC. La suite
    // corre en America/Guatemala (jest.config.js), así que con hora local esto
    // devolvería el 25 y una pestaña abierta republicaría al cruzar medianoche
    // según la zona de quien la mire.
    expect(publishDayKey(Date.parse('2026-08-26T05:30:00Z'))).toBe('2026-08-26')
    expect(publishDayKey(Date.parse('2026-08-26T00:00:00Z'))).toBe('2026-08-26')
  })

  test('publicado hoy no se vuelve a publicar; ayer sí', () => {
    const now = Date.parse('2026-08-26T12:00:00Z')
    expect(shouldPublishToday({ lastDay: '2026-08-26', nowTs: now })).toBe(false)
    expect(shouldPublishToday({ lastDay: '2026-08-25', nowTs: now })).toBe(true)
  })

  test('sin marca previa se publica', () => {
    const now = Date.parse('2026-08-26T12:00:00Z')
    expect(shouldPublishToday({ lastDay: null, nowTs: now })).toBe(true)
    expect(shouldPublishToday({ nowTs: now })).toBe(true)
  })
})

describe('la identidad es la misma en las dos superficies', () => {
  test('el perfil gana sobre la cuenta, y la cuenta sobre el correo', () => {
    expect(publishIdentity({ profile: { name: 'Ana' }, user: { displayName: 'X', email: 'z@x.com' } }))
      .toEqual({ displayName: 'Ana', avatar: 'A' })
    expect(publishIdentity({ profile: null, user: { displayName: 'Beto', email: 'z@x.com' } }))
      .toEqual({ displayName: 'Beto', avatar: 'B' })
    expect(publishIdentity({ user: { email: 'carlos@x.com' } }))
      .toEqual({ displayName: 'carlos', avatar: 'C' })
  })

  test('sin nada cae a un nombre, nunca a undefined', () => {
    const id = publishIdentity({})
    expect(id.displayName).toBe('Anónimo')
    expect(id.avatar).toBe('A')
  })
})

describe('el bloque de alcance', () => {
  test('sin activos de broker NO se publica el bloque ibkr', () => {
    const stats = buildPublishStats({ enrichedItems: [item()], returnYTD: 5, dailyChange: 1, totalAssets: 1000 })
    expect(stats.all).toBeTruthy()
    expect(stats.ibkr).toBeUndefined()
  })

  test('con activos de broker el bloque ibkr usa los retornos ESCOPADOS', () => {
    const items = [item(), item({ id: 'i2', symbol: 'BBB', _source: 'ibkr' })]
    const stats = buildPublishStats({
      enrichedItems: items, returnYTD: 5, returnMTD: 1, dailyChange: 1, totalAssets: 2000,
      ibkrReturnYTD: 12, ibkrReturnMTD: 3, ibkrDayChange: 4,
    })
    // Si el bloque ibkr usara los números del portafolio completo, un grupo
    // "Solo IBKR" compararía una cuenta de broker contra patrimonios enteros.
    expect(stats.all.ytd).toBe(5)
    expect(stats.ibkr.ytd).toBe(12)
    expect(stats.ibkr.mtd).toBe(3)
  })

  test('el contrato de privacidad no se mueve: cero montos', () => {
    const stats = buildPublishStats({ enrichedItems: [item()], returnYTD: 5, dailyChange: 1, totalAssets: 1000 })
    // Las llaves publicadas son exactamente las que friendsStats declara.
    expect(Object.keys(stats.all).sort()).toEqual(['day', 'dayAsOf', 'movers', 'mtd', 'ytd'])
    for (const m of stats.all.movers) {
      expect(Object.keys(m).sort()).toEqual(['changePct', 'name', 'symbol'])
    }
  })
})

describe('qué cuenta como "hay algo que publicar"', () => {
  test('una cartera con activos siempre publica', () => {
    const stats = buildPublishStats({ enrichedItems: [item()], returnYTD: null, dailyChange: null, totalAssets: 1000 })
    expect(hasSomethingToPublish({ stats, enrichedItems: [item()] })).toBe(true)
  })

  test('una cartera VACÍA sin ninguna cifra no publica', () => {
    const stats = buildPublishStats({ enrichedItems: [], returnYTD: null, returnMTD: null, dailyChange: null, totalAssets: 0 })
    expect(hasSomethingToPublish({ stats, enrichedItems: [] })).toBe(false)
    expect(buildPublishPayload({ enrichedItems: [], returnYTD: null, dailyChange: null, totalAssets: 0 })).toBe(null)
  })

  test('sin activos pero con un YTD medible sí publica', () => {
    const stats = buildPublishStats({ enrichedItems: [], returnYTD: 7, dailyChange: null, totalAssets: 0 })
    expect(hasSomethingToPublish({ stats, enrichedItems: [] })).toBe(true)
  })
})

describe('el payload completo', () => {
  test('trae identidad y stats, listo para action:sync', () => {
    const p = buildPublishPayload({
      enrichedItems: [item()], returnYTD: 5, returnMTD: 2, dailyChange: 1, totalAssets: 1000,
      profile: { name: 'Ana' }, user: { email: 'ana@x.com' },
    })
    expect(p.displayName).toBe('Ana')
    expect(p.avatar).toBe('A')
    expect(p.stats.all.ytd).toBe(5)
    // Nada más: el servidor re-valida todo lo que recibe, y agregarle campos
    // acá es cómo un dato que nadie sanea termina en la pantalla de otro.
    expect(Object.keys(p).sort()).toEqual(['avatar', 'displayName', 'stats'])
  })
})
