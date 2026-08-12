import { getScheduledPayDates, estimateIncomeAmount, clampPayDay, payDateFor, impossiblePayDateFixes } from '../incomeSchedule'

describe('getScheduledPayDates', () => {
  it('returns past pay dates that already fell due since acquisition', () => {
    // Bought in January, pays May + December, "today" is August: only May
    // has fallen due.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-15', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-05-15'])
  })

  it('excludes the current month if the pay day has not arrived yet', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 20, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('includes the current month once the pay day has passed', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [7], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual(['2026-08-01'])
  })

  it('never returns dates before acquisition', () => {
    // Bought in June; the only configured months (Jan-Apr) are all before
    // acquisition, so none of them ever fell due for this holder.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-06-01', incomeMonths: [0, 1, 2, 3], incomePayDay: 1, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing for continuous compounding (no discrete pay dates)', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-01-01', incomeMonths: [], incomePayDay: 1, rateType: 'continuous' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('returns nothing when the acquisition date is in the future', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2027-01-01', incomeMonths: [4, 11], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )
    expect(dates).toEqual([])
  })

  it('handles a missing/invalid acquisition date without throwing', () => {
    expect(() => getScheduledPayDates(
      { acquisitionDate: '', incomeMonths: [4], incomePayDay: 15, rateType: 'fixed' },
      new Date('2026-08-05T12:00:00Z')
    )).not.toThrow()
  })
})

describe('estimateIncomeAmount', () => {
  it('computes a percent-of-balance payment split across pay months', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'percent', incomeRate: 8 }, 2)
    expect(amt).toBeCloseTo(400) // 10000 * 8% / 2 payments
  })

  it('computes a fixed per-payment amount regardless of balance', () => {
    const amt = estimateIncomeAmount({ balance: 10000, incomeMode: 'fixed', incomeAmount: 50 })
    expect(amt).toBe(50)
  })

  it('multiplies fixed amount by quantity for per-share assets', () => {
    const amt = estimateIncomeAmount({ incomeMode: 'fixed', incomeAmount: 2, isPerShare: true, qty: 10 })
    expect(amt).toBe(20)
  })

  it('averages a variable rate range', () => {
    const amt = estimateIncomeAmount({ balance: 10000, rateType: 'variable', rateMin: 4, rateMax: 6 }, 12)
    expect(amt).toBeCloseTo((10000 * 0.05) / 12)
  })

  it('returns 0 when nothing is configured', () => {
    expect(estimateIncomeAmount({ balance: 10000 })).toBe(0)
  })
})

// FASE HV2. El día de pago que no cabe en el mes. El usuario lo reportó con la
// captura de un movimiento fechado "2026-02-31", un día que no existe: la fecha
// se armaba pegando el número tal cual, y JavaScript lo DESBORDA en silencio al
// 3 de marzo, así que el pago terminaba en un mes y su registro en otro.

describe('clampPayDay / payDateFor', () => {
  it('31 significa el último día del mes, sea cual sea ese mes', () => {
    expect(payDateFor(2026, 0, 31)).toBe('2026-01-31')  // enero: 31
    expect(payDateFor(2026, 1, 31)).toBe('2026-02-28')  // febrero
    expect(payDateFor(2026, 3, 31)).toBe('2026-04-30')  // abril: 30
    expect(payDateFor(2024, 1, 31)).toBe('2024-02-29')  // bisiesto
  })

  it('un día normal no se toca', () => {
    expect(payDateFor(2026, 1, 15)).toBe('2026-02-15')
    expect(clampPayDay(15, 2026, 1)).toBe(15)
  })

  it('un valor fuera de rango o basura no produce una fecha imposible', () => {
    expect(payDateFor(2026, 1, 45)).toBe('2026-02-28')
    expect(payDateFor(2026, 1, 0)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, -3)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, undefined)).toBe('2026-02-01')
    expect(payDateFor(2026, 1, 'abc')).toBe('2026-02-01')
  })

  it('la fecha que produce SIEMPRE es real: nunca desborda de mes', () => {
    for (let m = 0; m < 12; m++) {
      const iso = payDateFor(2026, m, 31)
      expect(new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10)).toBe(iso)
    }
  })
})

describe('getScheduledPayDates con día 31', () => {
  it('no propone ninguna fecha inexistente', () => {
    const dates = getScheduledPayDates(
      { acquisitionDate: '2025-01-01', incomeMonths: [0,1,2,3,4,5,6,7,8,9,10,11], incomePayDay: 31 },
      new Date('2026-08-11T00:00:00Z')
    )
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) {
      expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d)
    }
    expect(dates).toContain('2026-02-28')
    expect(dates).toContain('2026-04-30')
    expect(dates).not.toContain('2026-02-31')
  })

  it('el mes en curso paga cuando ya pasó su último día recortado', () => {
    // El 31 de septiembre no existe: el pago de septiembre cae el 30, así que
    // el 30 ya cuenta como vencido. Antes, `todayDay < 31` lo bloqueaba siempre.
    const dates = getScheduledPayDates(
      { acquisitionDate: '2026-09-01', incomeMonths: [8], incomePayDay: 31 },
      new Date('2026-09-30T00:00:00Z')
    )
    expect(dates).toContain('2026-09-30')
  })
})

describe('impossiblePayDateFixes', () => {
  it('corrige lo que la app escribió con un día que no existe', () => {
    const txs = [
      { id: 'a', date: '2026-02-31', _source: 'auto' },
      { id: 'b', date: '2026-04-31', _source: 'auto' },
      { id: 'c', date: '2026-01-31', _source: 'auto' },
    ]
    expect(impossiblePayDateFixes(txs)).toEqual([
      { id: 'a', date: '2026-02-28' },
      { id: 'b', date: '2026-04-30' },
    ])
  })

  it('no toca filas del usuario ni fechas con otro formato', () => {
    const txs = [
      { id: 'm', date: '2026-02-31' },
      { id: 'n', date: '2026-02-31', _source: 'manual_new_account' },
      { id: 'o', date: '2026-02-31T00:00:00Z', _source: 'auto' },
      { id: 'p', _source: 'auto' },
    ]
    expect(impossiblePayDateFixes(txs)).toEqual([])
  })
})
