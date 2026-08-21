import { computeDayMovers, moverKeyOf, moverLabelOf, moverWindowOf } from '../dayMovers'

// getItemValue real: cantidad x precio, deuda en negativo.
const val = (it) => (Number(it.quantity) || 0) * (Number(it.currentPrice) || 0) * (it.isDebt ? -1 : 1)
const eligible = (it) => !it.isDebt && !it.excluded
const run = (items, opts) => computeDayMovers({ items, getValue: val, isEligible: eligible, ...opts })

const mk = (o) => ({ quantity: 1, currentPrice: 1000, change1d: 1, ...o })

describe('agregacion por activo', () => {
  // El caso REAL del usuario: BTC en dos cuentas producia DOS filas "BTC" en la
  // misma lista, con montos distintos y compitiendo entre si.
  it('suma el mismo simbolo en dos cuentas en UNA sola fila', () => {
    const r = run([
      mk({ id: 'a', symbol: 'BTC', quantity: 1, currentPrice: 10000, change1d: 0.3 }),
      mk({ id: 'b', symbol: 'BTC', quantity: 3, currentPrice: 10000, change1d: 0.3 }),
      mk({ id: 'c', symbol: 'ETH', quantity: 5, currentPrice: 2000, change1d: 0.5 }),
    ])
    const btc = r.gainers.filter((g) => g.label === 'BTC')
    expect(btc).toHaveLength(1)
    expect(btc[0].count).toBe(2)
    // 40,000 de BTC al 0.3% = 120. Los dos lotes juntos, no uno de ellos.
    expect(btc[0].dollarChange).toBeCloseTo(120, 6)
    expect(btc[0].pct).toBeCloseTo(0.3, 9)
  })

  it('agrupa por la ETIQUETA, que es lo que la fila muestra', () => {
    // FASE HV11: las dos posiciones de Bitcoin de este usuario llegaron a tener
    // el campo `symbol` distinto. Lo que se ve igual se suma.
    const r = run([
      mk({ id: 'a', symbol: 'btc', quantity: 1, currentPrice: 10000 }),
      mk({ id: 'b', symbol: 'BTC', quantity: 1, currentPrice: 10000 }),
    ])
    expect(r.gainers).toHaveLength(1)
    expect(r.gainers[0].count).toBe(2)
  })

  it('dos activos DISTINTOS no se fusionan', () => {
    const r = run([
      mk({ id: 'a', symbol: 'BTC', quantity: 1, currentPrice: 10000 }),
      mk({ id: 'b', symbol: 'ETH', quantity: 4, currentPrice: 2500 }),
    ])
    expect(r.gainers.map((g) => g.label).sort()).toEqual(['BTC', 'ETH'])
    expect(r.gainers.every((g) => g.count === 1)).toBe(true)
  })

  it('las llaves son unicas: es lo que impedia el nodo rancio de React', () => {
    const r = run([
      mk({ id: 'a', symbol: 'BTC', quantity: 1, currentPrice: 10000 }),
      mk({ id: 'b', symbol: 'BTC', quantity: 3, currentPrice: 10000 }),
      mk({ id: 'c', symbol: 'ETH', quantity: 5, currentPrice: 2000 }),
    ])
    const keys = [...r.gainers, ...r.losers].map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('el piso de peso se aplica DESPUES de sumar', () => {
    // Dos lotes de 0.4% cada uno: por separado los dos caen bajo el piso de
    // 0.5%, juntos son 0.8% y califican. Antes, partir una posicion entre dos
    // brokers la hacia desaparecer de la tarjeta.
    const big = mk({ id: 'big', symbol: 'VOO', quantity: 1, currentPrice: 99200, change1d: 0.01 })
    const r = run([
      big,
      mk({ id: 'a', symbol: 'BTC', quantity: 1, currentPrice: 400, change1d: 2 }),
      mk({ id: 'b', symbol: 'BTC', quantity: 1, currentPrice: 400, change1d: 2 }),
    ])
    expect(r.gainers.map((g) => g.label)).toContain('BTC')
  })
})

describe('orden por impacto en el patrimonio', () => {
  // La lista se titula "mayores movimientos" y su pie dice "impacto sobre tu
  // portafolio total", pero ordenaba por el % PROPIO de la posicion. Por eso el
  // orden no se parecia al del broker, que rankea por P&L en dinero.
  it('una posicion grande que subio poco le gana a una chica que subio mucho', () => {
    const r = run([
      mk({ id: 'big', symbol: 'BIG', quantity: 1, currentPrice: 100000, change1d: 2 }),   // +2,000
      mk({ id: 'small', symbol: 'SMALL', quantity: 1, currentPrice: 5000, change1d: 8 }), // +400
    ])
    expect(r.gainers.map((g) => g.label)).toEqual(['BIG', 'SMALL'])
    // Regresion negativa: ordenar por `pct` habria puesto SMALL primero.
    expect(r.gainers[0].pct).toBeLessThan(r.gainers[1].pct)
  })

  it('ordenar por impacto y por dolares dan el MISMO orden', () => {
    const r = run([
      mk({ id: '1', symbol: 'A', quantity: 1, currentPrice: 50000, change1d: 1 }),
      mk({ id: '2', symbol: 'B', quantity: 1, currentPrice: 30000, change1d: 3 }),
      mk({ id: '3', symbol: 'C', quantity: 1, currentPrice: 20000, change1d: 0.5 }),
    ])
    const byImpact = r.gainers.map((g) => g.label)
    const byDollar = [...r.gainers].sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange)).map((g) => g.label)
    expect(byImpact).toEqual(byDollar)
  })

  it('los perdedores tambien se ordenan por impacto, no por el % mas negativo', () => {
    const r = run([
      mk({ id: 'big', symbol: 'BIG', quantity: 1, currentPrice: 100000, change1d: -2 }),
      mk({ id: 'small', symbol: 'SMALL', quantity: 1, currentPrice: 5000, change1d: -9 }),
    ])
    expect(r.losers.map((g) => g.label)).toEqual(['BIG', 'SMALL'])
  })
})

describe('clasificacion y filtros', () => {
  it('un 0.00% exacto no entra a ninguna lista', () => {
    const r = run([
      mk({ id: 'flat', symbol: 'FLAT', quantity: 1, currentPrice: 50000, change1d: 0 }),
      mk({ id: 'up', symbol: 'UP', quantity: 1, currentPrice: 50000, change1d: 1 }),
    ])
    // Regresion negativa: `pct >= 0` lo mandaba a ganadores con flecha verde.
    expect(r.gainers.map((g) => g.label)).toEqual(['UP'])
    expect(r.losers).toHaveLength(0)
  })

  it('la direccion sale del DINERO, asi la flecha nunca contradice el monto', () => {
    // Valor negativo (descubierto sin marcar como deuda) que "baja de precio":
    // el dinero que mueve es POSITIVO, asi que es un ganador.
    const r = run([
      mk({ id: 'neg', symbol: 'NEG', quantity: -1, currentPrice: 50000, change1d: -2 }),
      mk({ id: 'ok', symbol: 'OK', quantity: 1, currentPrice: 50000, change1d: 1 }),
    ])
    const neg = [...r.gainers, ...r.losers].find((m) => m.label === 'NEG')
    expect(neg.dollarChange).toBeGreaterThan(0)
    expect(r.gainers.map((g) => g.label)).toContain('NEG')
  })

  it('deuda y excluidos quedan fuera', () => {
    const r = run([
      mk({ id: 'd', symbol: 'DEBT', isDebt: true, quantity: 1, currentPrice: 50000, change1d: 5 }),
      mk({ id: 'x', symbol: 'EXC', excluded: true, quantity: 1, currentPrice: 50000, change1d: 5 }),
      mk({ id: 'ok', symbol: 'OK', quantity: 1, currentPrice: 50000, change1d: 1 }),
    ])
    expect([...r.gainers, ...r.losers].map((m) => m.label)).toEqual(['OK'])
  })

  it('sin change1d no hay fila, y sin items no revienta', () => {
    expect(run([mk({ id: 'a', symbol: 'A', change1d: null })]).gainers).toHaveLength(0)
    expect(run([mk({ id: 'a', symbol: 'A', change1d: NaN })]).gainers).toHaveLength(0)
    expect(run([]).gainers).toHaveLength(0)
    expect(run(null).gainers).toHaveLength(0)
    expect(computeDayMovers({}).gainers).toHaveLength(0)
  })

  it('respeta el limite por pestana', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      mk({ id: `i${i}`, symbol: `S${i}`, quantity: 1, currentPrice: 50000, change1d: i + 1 }))
    expect(run(items).gainers).toHaveLength(5)
    expect(run(items, { limit: 3 }).gainers).toHaveLength(3)
  })
})

describe('frescura: que ventana mide cada fila', () => {
  const today = new Date().toLocaleDateString('en-CA')

  it('la lista reporta la sesion mas RANCIA que contiene', () => {
    const r = run([
      mk({ id: 's', symbol: 'MO', quantity: 1, currentPrice: 50000, change1d: 1, _change1dWindow: 'session', _change1dAsOf: '2026-08-21' }),
      mk({ id: 'c', symbol: 'BTC', quantity: 1, currentPrice: 50000, change1d: 2, _change1dWindow: 'rolling24h' }),
    ])
    expect(r.asOf).toBe('2026-08-21')
  })

  it('una sesion de HOY no marca la lista como rancia', () => {
    const r = run([
      mk({ id: 's', symbol: 'MO', quantity: 1, currentPrice: 50000, change1d: 1, _change1dWindow: 'session', _change1dAsOf: today }),
    ])
    expect(r.asOf).toBe(today)
  })

  it('solo cripto (rodante) no tiene fecha de sesion', () => {
    const r = run([
      mk({ id: 'c', symbol: 'BTC', quantity: 1, currentPrice: 50000, change1d: 2, _change1dWindow: 'rolling24h' }),
    ])
    expect(r.asOf).toBeNull()
  })

  it('sin metadata se asume sesion, o sea el comportamiento de siempre', () => {
    expect(moverWindowOf({})).toBe('session')
    expect(moverWindowOf({ _change1dWindow: 'rolling24h' })).toBe('rolling24h')
    expect(moverWindowOf(null)).toBe('session')
  })
})

describe('helpers', () => {
  it('la etiqueta prefiere el simbolo y cae al nombre', () => {
    expect(moverLabelOf({ symbol: 'BTC', name: 'Bitcoin' })).toBe('BTC')
    expect(moverLabelOf({ name: 'Bitcoin' })).toBe('Bitcoin')
    expect(moverLabelOf({})).toBe('')
  })

  it('la llave normaliza y cae al id cuando no hay etiqueta', () => {
    expect(moverKeyOf({ symbol: ' btc ' })).toBe('BTC')
    expect(moverKeyOf({ id: 'x1' })).toBe('id:x1')
  })
})

describe('cotizacion de respaldo (last-known-good, hasta 7 dias)', () => {
  it('marca la fila cuando el precio salio del respaldo', () => {
    const r = run([
      mk({ id: 's', symbol: 'MO', quantity: 1, currentPrice: 50000, change1d: 1, _priceStale: true }),
    ])
    expect(r.gainers[0].stale).toBe(true)
  })

  it('basta que UNA parte del activo sea de respaldo', () => {
    const r = run([
      mk({ id: 'a', symbol: 'BTC', quantity: 1, currentPrice: 25000, change1d: 1 }),
      mk({ id: 'b', symbol: 'BTC', quantity: 1, currentPrice: 25000, change1d: 1, _priceStale: true }),
    ])
    expect(r.gainers).toHaveLength(1)
    expect(r.gainers[0].stale).toBe(true)
  })

  it('una cotizacion viva no se marca', () => {
    const r = run([mk({ id: 's', symbol: 'MO', quantity: 1, currentPrice: 50000, change1d: 1 })])
    expect(r.gainers[0].stale).toBe(false)
  })
})

describe('rankDayMovers: la lista sin partir, para el ranking social', () => {
  const { rankDayMovers } = require('../dayMovers')

  it('respeta un denominador propio, para no mover numeros ya publicados', () => {
    const r = rankDayMovers({
      items: [mk({ id: 'a', symbol: 'A', quantity: 1, currentPrice: 1000, change1d: 2 })],
      getValue: val, isEligible: eligible, total: 10000, minWeight: 0,
    })
    // 1,000 de 10,000 al 2% = 0.2, no el 2% que daria usar su propio valor.
    expect(r.rows[0].impactPct).toBeCloseTo(0.2, 9)
    expect(r.total).toBe(10000)
  })

  it('minWeight 0 deja pasar un mover chiquito', () => {
    const r = rankDayMovers({
      items: [
        mk({ id: 'big', symbol: 'BIG', quantity: 1, currentPrice: 100000, change1d: 0.01 }),
        mk({ id: 'tiny', symbol: 'TINY', quantity: 1, currentPrice: 100, change1d: 5 }),
      ],
      getValue: val, isEligible: eligible, minWeight: 0,
    })
    expect(r.rows.map((x) => x.label)).toContain('TINY')
  })

  it('ganadores y perdedores conviven en una sola lista ordenada', () => {
    const r = rankDayMovers({
      items: [
        mk({ id: 'up', symbol: 'UP', quantity: 1, currentPrice: 10000, change1d: 1 }),
        mk({ id: 'dn', symbol: 'DN', quantity: 1, currentPrice: 90000, change1d: -1 }),
      ],
      getValue: val, isEligible: eligible,
    })
    expect(r.rows.map((x) => x.label)).toEqual(['DN', 'UP'])
  })
})
