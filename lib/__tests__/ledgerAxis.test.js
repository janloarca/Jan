// FASE SL2. Eje de la cuenta conciliada: etiquetas repartidas en el tiempo.
import { timeTickIndices } from '../ledgerSeries'

const DAY = 86400000
const t = (d) => Date.parse(`${d}T00:00:00Z`)

describe('timeTickIndices', () => {
  // AÑO: 31 dic + cierres de mes ene-jul + ~100 días diarios.
  const ts = [t('2025-12-31')]
  for (let m = 1; m <= 7; m++) ts.push(Date.UTC(2026, m, 0))
  for (let x = t('2026-08-11'); x <= t('2026-11-19'); x += DAY) ts.push(x)

  it('reparte las marcas en el tiempo, no en el índice', () => {
    const idx = [...timeTickIndices(ts, 6)].sort((a, b) => a - b)
    const months = idx.map((i) => new Date(ts[i]).toISOString().slice(0, 7))
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(ts.length - 1)
    // Antes: dic 25 y luego todo en ago-nov. Ahora hay marcas en el primer semestre.
    expect(months.filter((m) => m >= '2026-01' && m <= '2026-07').length).toBeGreaterThanOrEqual(3)
  })

  it('serie vacía o de un punto', () => {
    expect(timeTickIndices([], 6).size).toBe(0)
    expect([...timeTickIndices([5], 6)]).toEqual([0])
  })
})
