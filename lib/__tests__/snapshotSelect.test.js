import { hasRealObservationAt } from '@/lib/snapshotSelect'

// ⛔ FASE JV. La calibración GLOBAL se guarda en el id PLANO de la fecha, así
// que este predicado es lo único que impide que haga merge encima de un doc
// real: pisar netWorthUSD, estampar _calibrated/_source:'manual' y dejar el
// totalActivosUSD viejo al lado (un doc con dos totales distintos), más
// congelar esa fecha contra el backfill para siempre.
describe('hasRealObservationAt', () => {
  const at = (s) => hasRealObservationAt(s, '2026-01-01')

  it('protege backfill, que es casi todo el historico desde FASE GD/HN', () => {
    // Regresion NEGATIVA: la lista literal vieja ('ibkr' | 'daily') lo dejaba
    // pasar, y el 1 de enero (el ancla del YTD) cae justo ahi.
    expect(at([{ date: '2026-01-01', _source: 'backfill', netWorthUSD: 11819.14 }])).toBeTruthy()
  })

  it('protege tambien manual, quarterly y los docs viejos sin _source', () => {
    expect(at([{ date: '2026-01-01', _source: 'manual', netWorthUSD: 100 }])).toBeTruthy()
    expect(at([{ date: '2026-01-01', _source: 'ibkr_quarterly', netWorthUSD: 100 }])).toBeTruthy()
    expect(at([{ date: '2026-01-01', totalActivosUSD: 100 }])).toBeTruthy()
  })

  it('sigue protegiendo lo que ya protegia', () => {
    expect(at([{ date: '2026-01-01', _source: 'ibkr', netWorthUSD: 100 }])).toBeTruthy()
    expect(at([{ date: '2026-01-01', _source: 'daily', netWorthUSD: 100 }])).toBeTruthy()
  })

  it('una calibracion propia NO protege: recalibrar el mismo dia se permite', () => {
    expect(at([{ date: '2026-01-01', _source: 'manual', _calibrated: true, netWorthUSD: 100 }])).toBeNull()
  })

  it('un ancla por cuenta tampoco: vive en su propio id compuesto', () => {
    expect(at([{ date: '2026-01-01', _source: 'manual', _account: 'ibkr', netWorthUSD: 100 }])).toBeNull()
  })

  it('un doc sin valor usable no es una observacion', () => {
    expect(at([{ date: '2026-01-01', _source: 'daily' }])).toBeNull()
    expect(at([{ date: '2026-01-01', _source: 'daily', netWorthUSD: 0 }])).toBeNull()
  })

  it('otra fecha, lista vacia y basura no protegen nada', () => {
    expect(at([{ date: '2026-01-02', _source: 'daily', netWorthUSD: 100 }])).toBeNull()
    expect(at([])).toBeNull()
    expect(hasRealObservationAt(null, '2026-01-01')).toBeNull()
    expect(hasRealObservationAt([{ date: '2026-01-01', netWorthUSD: 1 }], null)).toBeNull()
  })
})
