import {
  cleanCloses, windowChangePct, trailingWindowChanges,
  describeBiggestMove, describeLevelExtreme, buildMarketBrief, BRIEF_INSTRUMENTS,
} from '../marketBrief'

// Serie diaria sintética: `n` cierres partiendo de `start`, con un paso fijo.
const ramp = (n, start, step) => Array.from({ length: n }, (_, i) => start + i * step)

describe('marketBrief: cálculo de ventanas', () => {
  test('descarta nulls y ceros de Yahoo antes de cualquier cuenta', () => {
    expect(cleanCloses([100, null, 102, 0, 104])).toEqual([100, 102, 104])
  })

  test('el cambio de la ventana mide exactamente `size` observaciones atrás', () => {
    const closes = [100, 101, 102, 103, 104, 110]
    // 5 atrás desde el último: 100 → 110
    expect(windowChangePct(closes, 5)).toBeCloseTo(10, 6)
  })

  test('sin serie suficiente devuelve null, nunca una ventana más corta', () => {
    expect(windowChangePct([100, 101, 102], 5)).toBeNull()
    expect(windowChangePct([], 5)).toBeNull()
  })

  test('las ventanas rodantes salen de la más reciente hacia atrás', () => {
    const closes = ramp(16, 100, 1) // +1 por día
    const chgs = trailingWindowChanges(closes, 5, 3)
    expect(chgs).toHaveLength(3)
    // La más reciente: de 110 a 115 = +4.545%
    expect(chgs[0]).toBeCloseTo((115 - 110) / 110 * 100, 4)
    // Cada ventana anterior mide sobre una base menor, así que da más %
    expect(chgs[1]).toBeGreaterThan(chgs[0])
  })
})

describe('marketBrief: solo afirma lo que la serie prueba', () => {
  test('reconoce el mayor movimiento de la ventana', () => {
    const move = describeBiggestMove([5, 1, -2, 0.5, 1.2, -3])
    expect(move).toEqual({ pct: 5, weeks: 6 })
  })

  test('calla si otra semana se movió igual o más', () => {
    expect(describeBiggestMove([2, 1, -3, 0.5, 1.2])).toBeNull()
  })

  test('calla sin historia suficiente: "el mayor en 2 semanas" no informa', () => {
    expect(describeBiggestMove([9, 1, 2])).toBeNull()
  })

  test('calla ante un movimiento inmaterial aunque sea el mayor de un trimestre plano', () => {
    expect(describeBiggestMove([0.3, 0.1, -0.2, 0.05, 0.02, -0.01])).toBeNull()
  })

  test('el nivel solo se describe en los extremos del rango', () => {
    const rising = ramp(30, 10, 0.5)
    expect(describeLevelExtreme(rising, { size: 5, count: 13 }).kind).toBe('high')
    const falling = ramp(30, 25, -0.5)
    expect(describeLevelExtreme(falling, { size: 5, count: 13 }).kind).toBe('low')
    // A media tabla no se dice nada.
    const middle = [...ramp(15, 10, 1), ...ramp(15, 25, -1)]
    expect(describeLevelExtreme(middle, { size: 5, count: 13 })).toBeNull()
  })

  // Un empate NO es un máximo: en una serie plana `last >= max` es cierto por
  // construcción y producía "su cierre más alto en 13 semanas" sobre un
  // trimestre sin movimiento.
  test('una serie plana no tiene extremos', () => {
    expect(describeLevelExtreme(Array(30).fill(100), { size: 5, count: 13 })).toBeNull()
  })

  test('un rango insignificante tampoco cuenta como extremo', () => {
    const almostFlat = [...Array(29).fill(100), 100.4] // rango de 0.4%
    expect(describeLevelExtreme(almostFlat, { size: 5, count: 13 })).toBeNull()
  })
})

describe('marketBrief: orquestador', () => {
  const okFetcher = async () => ({ closes: ramp(70, 100, 0.4) })

  test('arma una fila por instrumento con su último precio y su cambio', async () => {
    const brief = await buildMarketBrief({ fetchSeries: okFetcher })
    expect(brief.rows).toHaveLength(BRIEF_INSTRUMENTS.length)
    expect(brief.complete).toBe(true)
    const spx = brief.rows.find((r) => r.key === 'spx')
    expect(spx.label).toBe('S&P 500')
    expect(spx.changePct).toBeGreaterThan(0)
  })

  test('un instrumento caído se OMITE, nunca se imprime en cero', async () => {
    const partial = async (symbol) => (symbol === '^VIX' ? null : { closes: ramp(70, 100, 0.4) })
    const brief = await buildMarketBrief({ fetchSeries: partial })
    expect(brief.rows.find((r) => r.key === 'vix')).toBeUndefined()
    expect(brief.rows).toHaveLength(BRIEF_INSTRUMENTS.length - 1)
    expect(brief.complete).toBe(false)
  })

  test('un fetcher que revienta no tumba el brief entero', async () => {
    const flaky = async (symbol) => {
      if (symbol === 'BTC') throw new Error('CoinGecko down')
      return { closes: ramp(70, 100, 0.4) }
    }
    const brief = await buildMarketBrief({ fetchSeries: flaky })
    expect(brief.rows.find((r) => r.key === 'btc')).toBeUndefined()
    expect(brief.rows.length).toBeGreaterThan(0)
  })

  test('sin nada derivable, el contexto queda vacío en vez de inventar una frase', async () => {
    // Serie plana: ni movimiento material ni extremo de rango.
    const flat = async () => ({ closes: Array(70).fill(100) })
    const brief = await buildMarketBrief({ fetchSeries: flat })
    expect(brief.rows.length).toBeGreaterThan(0)
    expect(brief.context).toEqual([])
  })
})
