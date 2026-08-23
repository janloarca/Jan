import { buildFriendStats } from '../friendsStats'

// Minimal enriched-item factory. getItemValue = quantity × currentPrice.
const item = (o) => ({ quantity: 1, currentPrice: 100, ...o })

describe('buildFriendStats', () => {
  it('publishes ytd/day as bounded percentages, never amounts', () => {
    const stats = buildFriendStats({
      enrichedItems: [item({ symbol: 'AAPL', change1d: 1 })],
      returnYTD: 12.34,
      dailyChange: { abs: 999999, pct: 0.8 },
      totalAssets: 100,
    })
    expect(stats.ytd).toBe(12.34)
    expect(stats.day).toBe(0.8)
    // No amount fields leak anywhere in the payload.
    const json = JSON.stringify(stats)
    expect(json).not.toContain('999999')
    stats.movers.forEach((m) => {
      expect(m).not.toHaveProperty('value')
      expect(m).not.toHaveProperty('amount')
    })
  })

  // FASE JA5. Estos dos tests fijaban `5000 → 200`, o sea documentaban el
  // CLAMPEO. Actualizar el número esperado es correcto acá (a diferencia del
  // candado de 3.94%) porque el valor viejo describía el defecto, no un
  // invariante: saturar publica una cifra que no es el retorno de nadie Y,
  // como el ranking ordena descendente, la pone en PRIMER lugar.
  it('rejects out-of-band returns instead of saturating them', () => {
    expect(buildFriendStats({ returnYTD: 5000 }).ytd).toBe(null)
    expect(buildFriendStats({ returnYTD: -9000 }).ytd).toBe(null)
    expect(buildFriendStats({ returnYTD: NaN }).ytd).toBe(null)
    expect(buildFriendStats({ returnYTD: null }).ytd).toBe(null)
    // Los bordes exactos SÍ se publican: la banda no encoge.
    expect(buildFriendStats({ returnYTD: 200 }).ytd).toBe(200)
    expect(buildFriendStats({ returnYTD: -200 }).ytd).toBe(-200)
    expect(buildFriendStats({ returnYTD: 199.9 }).ytd).toBe(199.9)
  })

  // Lo que el clampeo causaba, dicho como el daño y no como la mecánica: un
  // dato roto le ganaba a uno real en el mismo grupo.
  it('a broken return can no longer outrank a real one', () => {
    const broken = buildFriendStats({ returnYTD: 8400 }).ytd   // ancla mala
    const real = buildFriendStats({ returnYTD: 41.2 }).ytd
    const ranked = [{ ytd: broken }, { ytd: real }].sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
    expect(ranked[0].ytd).toBe(41.2)
    expect(ranked[1].ytd).toBe(null)
  })

  it('publishes month-to-date (mtd) alongside ytd, within the same band', () => {
    expect(buildFriendStats({ returnYTD: 10, returnMTD: 3.2 }).mtd).toBe(3.2)
    expect(buildFriendStats({ returnMTD: 5000 }).mtd).toBe(null)
    expect(buildFriendStats({ returnMTD: NaN }).mtd).toBe(null)
    expect(buildFriendStats({ returnYTD: 10 }).mtd).toBe(null)
  })

  it('accepts dailyChange as a bare number', () => {
    expect(buildFriendStats({ dailyChange: 1.5 }).day).toBe(1.5)
  })

  it('ranks movers by absolute daily impact (weight × change1d), not by value', () => {
    // Big position, tiny move vs small position, huge move.
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'BIG', quantity: 1, currentPrice: 900, change1d: 0.1 }),  // weight .9 × .1 = .09
        item({ symbol: 'SMALL', quantity: 1, currentPrice: 100, change1d: 5 }),   // weight .1 × 5 = .50
      ],
      totalAssets: 1000,
    })
    // El ORDEN es lo que sobrevive: la posicion en la lista sigue diciendo
    // cual movio mas el portafolio, sin publicar el numero del que se
    // despejaba el peso (FASE JA6).
    expect(stats.movers[0].symbol).toBe('SMALL')
    expect(stats.movers[1].symbol).toBe('BIG')
    expect(stats.movers[0]).not.toHaveProperty('impactPct')
  })

  it('ignores non-market items (no change1d) and debt', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'BANK', currentPrice: 5000 }),                 // no change1d
        item({ symbol: 'DEBT', change1d: 3, isDebt: true }),          // debt
        item({ symbol: 'VOO', currentPrice: 400, change1d: 1.2 }),
      ],
      totalAssets: 5400,
    })
    expect(stats.movers.map((m) => m.symbol)).toEqual(['VOO'])
  })

  it('scopeFilter narrows movers to a subset (e.g. IBKR only)', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        item({ symbol: 'IBK', currentPrice: 500, change1d: 2, _source: 'ibkr' }),
        item({ symbol: 'MAN', currentPrice: 500, change1d: 9, _source: 'manual' }),
      ],
      totalAssets: 1000,
      scopeFilter: (it) => it._source === 'ibkr',
    })
    expect(stats.movers.map((m) => m.symbol)).toEqual(['IBK'])
  })

  it('caps movers at 5', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ symbol: `S${i}`, currentPrice: 100, change1d: i + 1 }))
    const stats = buildFriendStats({ enrichedItems: many, totalAssets: 1000 })
    expect(stats.movers.length).toBe(5)
  })
})

// ⛔ FASE KN. El mismo defecto que la tarjeta del patrimonio, una superficie mas
// alla: quien tiene el mismo activo en dos cuentas publicaba DOS movers "BTC" a
// sus grupos de amigos.
describe('agregacion por activo en lo que se publica', () => {
  const mk = (o) => ({ isDebt: false, quantity: 1, currentPrice: 1000, change1d: 1, ...o })

  it('dos cuentas con el mismo simbolo salen como UN solo mover', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'BTC', name: 'Bitcoin', quantity: 1, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'b', symbol: 'BTC', name: 'Bitcoin', quantity: 3, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'c', symbol: 'ETH', name: 'Ether', quantity: 1, currentPrice: 5000, change1d: 1 }),
      ],
      returnYTD: 5, dailyChange: 1, totalAssets: 45000,
    })
    const btc = stats.movers.filter((m) => m.symbol === 'BTC')
    expect(btc).toHaveLength(1)
    expect(btc[0].changePct).toBeCloseTo(2, 9)
  })

  it('el contrato de privacidad no cambia: cero montos', () => {
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'BTC', name: 'Bitcoin', quantity: 1, currentPrice: 10000, change1d: 2 }),
        mk({ id: 'b', symbol: 'BTC', name: 'Bitcoin', quantity: 3, currentPrice: 10000, change1d: 2 }),
      ],
      returnYTD: 5, dailyChange: 1, totalAssets: 40000,
    })
    stats.movers.forEach((m) => {
      expect(Object.keys(m).sort()).toEqual(['changePct', 'name', 'symbol'])
    })
  })

  it('sin piso de peso: un mover chiquito se sigue publicando', () => {
    // La tarjeta del patrimonio descarta por debajo del 0.5%; aca no hay piso,
    // y ese comportamiento se conserva.
    const stats = buildFriendStats({
      enrichedItems: [
        mk({ id: 'big', symbol: 'BIG', quantity: 1, currentPrice: 100000, change1d: 0.01 }),
        mk({ id: 'tiny', symbol: 'TINY', quantity: 1, currentPrice: 100, change1d: 5 }),
      ],
      returnYTD: 1, dailyChange: 0.1, totalAssets: 100100,
    })
    expect(stats.movers.map((m) => m.symbol)).toContain('TINY')
  })
})

// ⛔ FASE KO. DE CUANDO son las cifras que se publican al grupo.
describe('la sesion viaja con las cifras del dia', () => {
  const mk = (o) => ({ isDebt: false, quantity: 1, currentPrice: 10000, change1d: 1, ...o })
  const today = new Date().toLocaleDateString('en-CA')

  it('publica la sesion mas RANCIA de la cartera', () => {
    const s = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'MO', change1d: 1, _change1dWindow: 'session', _change1dAsOf: '2026-08-21' }),
        mk({ id: 'b', symbol: 'BTC', change1d: 2, _change1dWindow: 'rolling24h' }),
      ],
      returnYTD: 1, dailyChange: 0.5, totalAssets: 20000,
    })
    expect(s.dayAsOf).toBe('2026-08-21')
  })

  it('una cartera de pura cripto nunca queda congelada', () => {
    const s = buildFriendStats({
      enrichedItems: [mk({ id: 'b', symbol: 'BTC', change1d: 2, _change1dWindow: 'rolling24h' })],
      returnYTD: 1, dailyChange: 0.5, totalAssets: 10000,
    })
    expect(s.dayAsOf).toBeNull()
  })

  it('con la sesion de hoy publica hoy', () => {
    const s = buildFriendStats({
      enrichedItems: [mk({ id: 'a', symbol: 'MO', change1d: 1, _change1dWindow: 'session', _change1dAsOf: today })],
      returnYTD: 1, dailyChange: 0.5, totalAssets: 10000,
    })
    expect(s.dayAsOf).toBe(today)
  })

  it('sigue sin salir un solo monto', () => {
    const s = buildFriendStats({
      enrichedItems: [mk({ id: 'a', symbol: 'MO', change1d: 1, _change1dWindow: 'session', _change1dAsOf: '2026-08-21' })],
      returnYTD: 1, dailyChange: 0.5, totalAssets: 10000,
    })
    expect(Object.keys(s).sort()).toEqual(['day', 'dayAsOf', 'movers', 'mtd', 'ytd'])
    s.movers.forEach((m) => {
      expect(Object.keys(m).sort()).toEqual(['changePct', 'name', 'symbol'])
    })
  })
})

// La frontera de datos NO confiables. El cliente manda `dayAsOf` y el servidor
// (app/api/friends/route.js) lo re-valida con ESTA misma funcion: una sola
// definicion, para que el productor y el validador no puedan separarse.
describe('sanitizeDayAsOf', () => {
  const { sanitizeDayAsOf } = require('../friendsStats')

  it('acepta solo la forma exacta YYYY-MM-DD', () => {
    expect(sanitizeDayAsOf('2026-08-21')).toBe('2026-08-21')
  })

  it('rechaza cualquier otra cosa, que terminaria en la pantalla de otra persona', () => {
    for (const bad of ['21/08/2026', '2026-8-21', 'hoy', '<script>', '2026-08-21T00:00:00Z',
                       '', null, undefined, 0, 123, {}, [], true]) {
      expect(sanitizeDayAsOf(bad)).toBeNull()
    }
  })

  it('no deja pasar texto pegado a una fecha valida', () => {
    expect(sanitizeDayAsOf('2026-08-21 y algo mas')).toBeNull()
    expect(sanitizeDayAsOf('x2026-08-21')).toBeNull()
  })
})

// ⛔ FASE JA5. La banda vive en UN solo lugar y la comparte el servidor
// (app/api/friends/route.js la importa en vez de re-escribirla). Este bloque
// prueba la funcion directamente, porque el defecto que arregla es del
// VALIDADOR tanto como del productor: la ruta tenia su propia copia, asi que
// cambiar solo el cliente habria dejado al servidor saturando lo que el cliente
// ya rechazaba, y el servidor es el que manda.
describe('boundedPct', () => {
  const { boundedPct, PCT_BOUND } = require('../friendsStats')

  it('deja pasar lo que cabe en la banda, con signo y decimales intactos', () => {
    expect(boundedPct(0)).toBe(0)
    expect(boundedPct(-12.5)).toBe(-12.5)
    expect(boundedPct(PCT_BOUND)).toBe(PCT_BOUND)
    expect(boundedPct(-PCT_BOUND)).toBe(-PCT_BOUND)
  })

  it('devuelve null fuera de banda, nunca el borde', () => {
    expect(boundedPct(PCT_BOUND + 0.01)).toBeNull()
    expect(boundedPct(8400)).toBeNull()
    expect(boundedPct(-9000)).toBeNull()
    expect(boundedPct(Infinity)).toBeNull()
  })

  it('null no es cero: se descarta ANTES de Number()', () => {
    // Number(null) === 0 y 0 es finito, asi que un chequeo de finitud a secas
    // convierte "no hay dato" en "su retorno fue exactamente 0%", que en un
    // ranking es una posicion, no una ausencia.
    expect(boundedPct(null)).toBeNull()
    expect(boundedPct(undefined)).toBeNull()
    expect(boundedPct(NaN)).toBeNull()
    expect(boundedPct('')).toBeNull()
    expect(boundedPct('   ')).toBeNull()
    // Un numero serializado SI es un dato, solo que en texto.
    expect(boundedPct('12.5')).toBe(12.5)
  })
})

// ⛔ FASE JA6. El PESO de cada posicion ya no se puede despejar.
//
// Decision del usuario (23 ago 2026). Publicando el cambio de la posicion Y su
// impacto en el portafolio, cualquiera que reciba la fila hace una division y
// obtiene "BTC es el 47% de su cartera". No son montos, pero la composicion de
// la cartera es mas de lo que la tarjeta promete.
describe('el peso de una posicion no se publica', () => {
  const { publicMovers } = require('../friendsStats')
  const mk = (o) => ({ isDebt: false, quantity: 1, currentPrice: 1000, change1d: 1, ...o })

  it('la fila publicada no trae con que dividir', () => {
    const s = buildFriendStats({
      enrichedItems: [
        mk({ id: 'a', symbol: 'BTC', name: 'Bitcoin', quantity: 47, currentPrice: 1000, change1d: 5 }),
        mk({ id: 'b', symbol: 'ETH', name: 'Ether', quantity: 53, currentPrice: 1000, change1d: 1 }),
      ],
      returnYTD: 5, dailyChange: 1, totalAssets: 100000,
    })
    for (const m of s.movers) {
      expect(m).not.toHaveProperty('impactPct')
      expect(Object.keys(m).sort()).toEqual(['changePct', 'name', 'symbol'])
    }
  })

  // Lo que se conserva, que es la razon por la que quitar el campo no cuesta
  // nada: la POSICION en la lista sigue diciendo cual movio mas el portafolio.
  it('el orden por impacto sobrevive sin publicar el impacto', () => {
    const s = buildFriendStats({
      enrichedItems: [
        // Sube mucho pero pesa poquisimo: impacto chico.
        mk({ id: 'tiny', symbol: 'TINY', quantity: 1, currentPrice: 100, change1d: 20 }),
        // Sube poco pero es casi toda la cartera: impacto grande.
        mk({ id: 'huge', symbol: 'HUGE', quantity: 1, currentPrice: 99900, change1d: 1 }),
      ],
      returnYTD: 1, dailyChange: 1, totalAssets: 100000,
    })
    // Si el orden fuera por el % propio, TINY (+20%) iria primero.
    expect(s.movers.map((m) => m.symbol)).toEqual(['HUGE', 'TINY'])
  })

  // La agregacion por activo (FASE KN) ya no se puede leer de un numero
  // publicado, asi que se verifica por el ORDEN, que es una prueba mas fuerte:
  // dos lotes de BTC que por separado pesan menos que ETH, juntos pesan mas.
  it('el orden prueba que los dos lotes del mismo activo se sumaron', () => {
    const s = buildFriendStats({
      enrichedItems: [
        mk({ id: 'btc1', symbol: 'BTC', name: 'Bitcoin', quantity: 30, currentPrice: 1000, change1d: 1 }),
        mk({ id: 'btc2', symbol: 'BTC', name: 'Bitcoin', quantity: 30, currentPrice: 1000, change1d: 1 }),
        mk({ id: 'eth', symbol: 'ETH', name: 'Ether', quantity: 40, currentPrice: 1000, change1d: 1 }),
      ],
      returnYTD: 1, dailyChange: 1, totalAssets: 100000,
    })
    // Sin agregar, cada lote de BTC (30) perderia contra ETH (40).
    expect(s.movers.map((m) => m.symbol)).toEqual(['BTC', 'ETH'])
  })

  // El servidor lo aplica tambien al LEER: sin eso, todo perfil ya publicado
  // seguiria entregando su impactPct guardado hasta que su dueno republique.
  it('publicMovers limpia lo que ya estaba guardado', () => {
    const stored = [
      { symbol: 'BTC', name: 'Bitcoin', changePct: 2, impactPct: 1.77 },
      { symbol: 'ETH', name: 'Ether', changePct: 1, impactPct: 0.11 },
    ]
    const out = publicMovers(stored)
    expect(out).toEqual([
      { symbol: 'BTC', name: 'Bitcoin', changePct: 2 },
      { symbol: 'ETH', name: 'Ether', changePct: 1 },
    ])
    // Y conserva el orden, que es de donde sale el ranking.
    expect(out.map((m) => m.symbol)).toEqual(['BTC', 'ETH'])
  })

  it('un campo nuevo en el documento no sale al mundo por accidente', () => {
    const out = publicMovers([{ symbol: 'BTC', changePct: 1, weightPct: 47, valorUSD: 12345 }])
    expect(Object.keys(out[0]).sort()).toEqual(['changePct', 'name', 'symbol'])
  })
})
