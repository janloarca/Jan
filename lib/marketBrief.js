// FASE HZ. El bloque de mercado de los correos periódicos.
//
// Decisión del usuario: la narrativa sale "de lo que tenemos", o sea de datos
// que la app ya sabe traer (Yahoo Finance y CoinGecko), NUNCA de un modelo que
// redacte noticias. Eso fija una regla dura para este módulo: cada frase de
// contexto tiene que ser DERIVABLE de las series de precios. Si no hay nada
// derivable, no se escribe nada: un brief con cinco números correctos y sin
// frase es honesto; uno con una frase inventada no lo es.
//
// Lo que sí se puede afirmar mirando solo precios:
//   - el cambio del período por instrumento (el dato duro),
//   - si el movimiento de esta semana es el mayor en N semanas,
//   - dónde quedó el VIX contra su propio rango reciente.
// Lo que NO se afirma nunca: por qué se movió el mercado.
//
// Las funciones de cálculo son puras y están testeadas; solo el orquestador
// toca la red, y recibe el fetcher por parámetro para poder probarlo.

// La ventana de mercado de cada cadencia, en UN solo lugar: la corrida real
// del cron y el botón de prueba arman el brief con estas mismas opciones, así
// que no pueden divergir. `fetcher` va a makeBriefFetcher, `brief` se esparce
// sobre buildMarketBrief.
export const MARKET_WINDOWS = {
  weekly: { fetcher: {}, brief: {} },
  monthly: {
    // 21 días hábiles por ventana, cripto a 30 días naturales, y 2 años de
    // historia de Yahoo para que el contexto tenga sus ~13 ventanas.
    fetcher: { cgWindow: '30d', yahooRange: '2y' },
    brief: { windowSize: 21, windowName: 'monthly', windowUnit: 'months' },
  },
  annual: {
    // 252 días hábiles por ventana (un año bursátil) y 10 años de historia,
    // para que "el mayor movimiento anual en N años" tenga contra qué medirse.
    // CoinGecko nombra esta ventana '1y', no '365d': la lista de valores que
    // acepta es cerrada (1h, 24h, 7d, 14d, 30d, 200d, 1y).
    fetcher: { cgWindow: '1y', yahooRange: '10y' },
    brief: { windowSize: 252, windowName: 'annual', windowUnit: 'years' },
  },
}

export const BRIEF_INSTRUMENTS = [
  { key: 'spx', symbol: '^GSPC', label: 'S&P 500', kind: 'index' },
  { key: 'ndx', symbol: '^IXIC', label: 'Nasdaq', kind: 'index' },
  { key: 'vix', symbol: '^VIX', label: 'VIX', kind: 'level' },
  { key: 'btc', symbol: 'BTC', label: 'Bitcoin', kind: 'crypto' },
  { key: 'eth', symbol: 'ETH', label: 'Ethereum', kind: 'crypto' },
]

// Cierres diarios válidos, en orden ascendente. Yahoo entrega `null` en días
// sin operación (feriados a media serie), y un null tratado como cero rompe
// cualquier porcentaje: se descartan antes de cualquier cuenta.
export function cleanCloses(closes) {
  return (closes || []).filter((c) => c != null && isFinite(c) && c > 0)
}

// Cambio porcentual sobre las últimas `size` observaciones (5 = una semana
// bursátil). Devuelve null si la serie no alcanza, en vez de un número que
// mediría una ventana más corta que la anunciada.
export function windowChangePct(closes, size = 5) {
  const c = cleanCloses(closes)
  if (c.length < size + 1) return null
  const start = c[c.length - 1 - size]
  const end = c[c.length - 1]
  if (!(start > 0)) return null
  return ((end - start) / start) * 100
}

// Los cambios de las últimas `count` ventanas, la más reciente primero. Es la
// base del único contexto que este módulo se permite afirmar.
export function trailingWindowChanges(closes, size = 5, count = 13) {
  const c = cleanCloses(closes)
  const out = []
  for (let i = 0; i < count; i++) {
    const endIdx = c.length - 1 - i * size
    const startIdx = endIdx - size
    if (startIdx < 0) break
    const a = c[startIdx]
    if (!(a > 0)) break
    out.push(((c[endIdx] - a) / a) * 100)
  }
  return out
}

// "El mayor movimiento semanal en N semanas", pero solo cuando es verdad y
// además vale decirlo. Tres guardas, cada una porque su ausencia produce una
// frase falsa o vacía:
//   - hace falta historia suficiente (>= 5 ventanas) o "en 2 semanas" no dice nada,
//   - el movimiento tiene que ser el mayor en magnitud de toda la ventana,
//   - y tiene que ser material (>= 1%), porque un +0.3% que resulta ser el
//     mayor de un trimestre plano describe calma, no un movimiento.
export function describeBiggestMove(changes, { minPct = 1 } = {}) {
  if (!Array.isArray(changes) || changes.length < 5) return null
  const latest = changes[0]
  if (latest == null || !isFinite(latest) || Math.abs(latest) < minPct) return null
  const rest = changes.slice(1)
  if (rest.some((c) => Math.abs(c) >= Math.abs(latest))) return null
  return { pct: latest, weeks: changes.length }
}

// Dónde quedó un nivel (el VIX) contra su propio rango reciente. Solo se
// afirma en los extremos: decir "está en el medio de su rango" es ruido.
//
// El piso de rango (`minRangePct`) no es cosmético: en una serie plana el
// último cierre empata con el máximo y la comparación `last >= max` es
// literalmente cierta, así que sin esta guarda un trimestre sin movimiento
// producía "su cierre más alto en 13 semanas". Un empate no es un máximo, y
// un rango de 0.1% tampoco: para llamar a algo extremo, tiene que haber un
// rango real contra el cual serlo.
export function describeLevelExtreme(closes, { size = 5, count = 13, minRangePct = 2 } = {}) {
  const c = cleanCloses(closes)
  if (c.length < size * 4) return null
  const window = c.slice(-size * count)
  const last = window[window.length - 1]
  const max = Math.max(...window)
  const min = Math.min(...window)
  const range = max - min
  if (!(range > 0) || !(last > 0)) return null
  if ((range / last) * 100 < minRangePct) return null
  const weeks = Math.floor(window.length / size)
  if (last >= max) return { kind: 'high', value: last, weeks }
  if (last <= min) return { kind: 'low', value: last, weeks }
  return null
}

// Orquestador. `fetchSeries(symbol, kind)` debe devolver { closes: number[] }
// con cierres diarios ascendentes (o null si el símbolo falló). Un instrumento
// que falla se OMITE de la tabla en vez de imprimirse en cero: el brief sale
// más corto, nunca mentiroso.
//
// FASE IE: `windowSize`/`windowName`/`windowUnit` parametrizan la ventana
// para el brief mensual (21 días hábiles, "monthly move in N months") sin
// tocar el semanal, que conserva sus defaults exactos.
export async function buildMarketBrief({ fetchSeries, windowSize = 5, windowName = 'weekly', windowUnit = 'weeks' }) {
  const rows = []
  const results = await Promise.all(
    BRIEF_INSTRUMENTS.map(async (inst) => {
      try {
        const series = await fetchSeries(inst.symbol, inst.kind)
        return { inst, closes: series?.closes || null }
      } catch {
        return { inst, closes: null }
      }
    })
  )

  const context = []
  for (const { inst, closes } of results) {
    const c = cleanCloses(closes)
    if (c.length === 0) continue
    const last = c[c.length - 1]
    const changePct = windowChangePct(c, windowSize)
    rows.push({ key: inst.key, label: inst.label, kind: inst.kind, last, changePct })

    if (inst.key === 'spx') {
      const move = describeBiggestMove(trailingWindowChanges(c, windowSize))
      if (move) {
        context.push(`S&P 500 ${move.pct >= 0 ? 'up' : 'down'} ${Math.abs(move.pct).toFixed(1)}%, its biggest ${windowName} move in ${move.weeks} ${windowUnit}.`)
      }
    }
    if (inst.key === 'vix') {
      const extreme = describeLevelExtreme(c, { size: windowSize })
      if (extreme) {
        context.push(`VIX at ${extreme.value.toFixed(1)}, its ${extreme.kind === 'high' ? 'highest' : 'lowest'} close in ${extreme.weeks} ${windowUnit}.`)
      }
    }
  }

  return { rows, context, complete: rows.length === BRIEF_INSTRUMENTS.length }
}
