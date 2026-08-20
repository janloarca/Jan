// FASE II. Casos REALES del diagnóstico del 14 ago 2026: 6 acciones de 5
// mercados verificadas contra fuentes públicas (SEC, sitios de dividendos y
// las páginas oficiales de las empresas).

import { ttmAnnualDividend, projectNextDate } from '../dividendSchedule'

const d = (iso) => new Date(`${iso}T00:00:00Z`)
const NOW = d('2026-08-14').getTime()

describe('ttmAnnualDividend', () => {
  it('Novo Nordisk: interino chico + final grande suman el año real, nunca el doble del último', () => {
    // DKK 3.75 (interino ago 2025) + 7.95 (final mar 2026) + 3.75 (interino
    // ago 2026, ex 14-ago). La app daba 2.53% (2×3.75) en Copenhague y 5.55%
    // (2×7.95) en Nueva York PARA LA MISMA EMPRESA; la verdad es ~11.70/año.
    const hist = [
      { date: d('2024-08-16'), amount: 3.5 },
      { date: d('2025-03-24'), amount: 7.4 },
      { date: d('2025-08-15'), amount: 3.75 },
      { date: d('2026-03-27'), amount: 7.95 },
    ]
    expect(ttmAnnualDividend(hist, NOW)).toBeCloseTo(3.75 + 7.95, 9)
    // Regresión negativa explícita: ni la mitad ni el doble.
    expect(ttmAnnualDividend(hist, NOW)).not.toBeCloseTo(2 * 3.75, 1)
    expect(ttmAnnualDividend(hist, NOW)).not.toBeCloseTo(2 * 7.95, 1)
  })

  it('un pagador parejo (Microsoft) da lo mismo que la extrapolación: los 4 de 6 que ya estaban bien no se mueven', () => {
    const hist = [
      { date: d('2025-08-21'), amount: 0.83 },
      { date: d('2025-11-20'), amount: 0.91 },
      { date: d('2026-02-19'), amount: 0.91 },
      { date: d('2026-05-21'), amount: 0.91 },
    ]
    // TTM = 0.83 + 0.91×3 = 3.56, contra 3.64 extrapolado: la diferencia real
    // es solo la subida de tarifa de noviembre, no un artefacto del método.
    expect(ttmAnnualDividend(hist, NOW)).toBeCloseTo(3.56, 9)
  })

  it('historial más joven que ~11 meses devuelve null: ahí extrapolar es el mejor estimado', () => {
    const hist = [
      { date: d('2026-03-10'), amount: 0.5 },
      { date: d('2026-06-10'), amount: 0.5 },
    ]
    expect(ttmAnnualDividend(hist, NOW)).toBeNull()
  })

  it('sin pagos dentro de la ventana devuelve null (dejó de pagar): el caller decide', () => {
    const hist = [
      { date: d('2023-05-01'), amount: 1 },
      { date: d('2024-05-01'), amount: 1 },
    ]
    expect(ttmAnnualDividend(hist, NOW)).toBeNull()
  })

  it('entradas vacías o malformadas devuelven null, nunca un número inventado', () => {
    expect(ttmAnnualDividend([], NOW)).toBeNull()
    expect(ttmAnnualDividend(null, NOW)).toBeNull()
    expect(ttmAnnualDividend([{ date: 'no-date', amount: 1 }], NOW)).toBeNull()
  })
})

describe('projectNextDate', () => {
  it('el desborde de fin de mes, reproducido y corregido: 30 nov + 3 meses cae el 30 ago, no el 2 sep', () => {
    // Comportamiento viejo (setMonth): 30-nov → "30-feb" → 2-mar → ... → 2-sep.
    expect(projectNextDate(d('2025-11-30').getTime(), 3, NOW)).toBe('2026-08-30')
  })

  it('día 31 significa fin de mes en el destino, sin corrimiento permanente', () => {
    expect(projectNextDate(d('2026-05-31').getTime(), 3, NOW)).toBe('2026-08-31')
    // Y el siguiente paso desde ahí vuelve a caer en día 30, no en día 1.
    expect(projectNextDate(d('2026-08-31').getTime(), 3, NOW)).toBe('2026-08-31')
  })

  it('las fechas que no desbordan quedan idénticas a la proyección de siempre', () => {
    expect(projectNextDate(d('2026-05-21').getTime(), 3, NOW)).toBe('2026-08-21')
    expect(projectNextDate(d('2026-06-15').getTime(), 3, NOW)).toBe('2026-09-15')
  })

  it('basura no cuelga el loop: guard y null', () => {
    expect(projectNextDate(NaN, 3, NOW)).toBeNull()
    expect(projectNextDate(d('1900-01-01').getTime(), 3, NOW)).not.toBeNull()
  })
})
