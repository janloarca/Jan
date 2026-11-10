import { isInvestable, investableValue, snapshotsWithoutRealEstate, ytdTwrFromSnapshots } from '../investable'
import { computePeriodicReturns } from '../../components/dashboard/analytics'

const items = [
  { id: 'voo', type: 'ETF', quantity: 10, currentPrice: 100 },
  { id: 'casa', type: 'Real Estate', quantity: 1, currentPrice: 5000, acquisitionDate: '2025-06-01' },
  { id: 'hip', type: 'Debt', isDebt: true, quantity: 1, currentPrice: 3000 },
]

describe('lo invertible (FASE RQ)', () => {
  test('sin vivienda ni deudas', () => {
    expect(isInvestable(items[0])).toBe(true)
    expect(isInvestable(items[1])).toBe(false)
    expect(isInvestable(items[2])).toBe(false)
    expect(investableValue(items)).toBe(1000)
  })

  test('la serie sin vivienda resta la casa solo desde que existe', () => {
    const snaps = [
      { date: '2025-05-01', netWorthUSD: 1000, totalActivosUSD: 1000, totalDebtUSD: 0 },
      { date: '2025-07-01', netWorthUSD: 6000, totalActivosUSD: 6000, totalDebtUSD: 0 },
    ]
    const out = snapshotsWithoutRealEstate(snaps, items)
    expect(out[0].totalActivosUSD).toBe(1000)
    expect(out[1].totalActivosUSD).toBe(1000)
  })

  test('TWR del año encadena tramos y netea el aporte', () => {
    const snaps = [
      { date: '2025-12-31', netWorthUSD: 1000, totalActivosUSD: 1000, totalDebtUSD: 0 },
      { date: '2026-06-01', netWorthUSD: 1100, totalActivosUSD: 1100, totalDebtUSD: 0 },
      { date: '2026-06-02', netWorthUSD: 2100, totalActivosUSD: 2100, totalDebtUSD: 0 },
      { date: '2026-11-01', netWorthUSD: 2310, totalActivosUSD: 2310, totalDebtUSD: 0 },
    ]
    const txs = [{ type: 'DEPOSIT', totalAmount: 1000, currency: 'USD', date: '2026-06-02' }]
    const twr = ytdTwrFromSnapshots(snaps, txs, (v) => v, computePeriodicReturns, new Date('2026-11-10T12:00:00Z'))
    expect(twr).toBeCloseTo(21, 0)
  })
})
