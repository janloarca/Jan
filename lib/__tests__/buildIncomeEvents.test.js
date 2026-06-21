import { buildIncomeEvents } from '@/components/dashboard/utils'

const id = (x) => x

describe('buildIncomeEvents — dividend destination routing', () => {
  const vitali = { id: 'vitali', symbol: 'VITALI', name: 'Vitali', type: 'inversion', dividendAction: 'cash', incomeDestination: 'fondo' }
  const fondo = { id: 'fondo', symbol: 'IDC-CASH', name: 'Fondo liquido', type: 'Bank' }
  const items = [vitali, fondo]

  it('routes a cash dividend to its destination account, not the source', () => {
    const txs = [{
      type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240,
      currency: 'USD', _source: 'auto', _linkedItemId: 'vitali',
    }]
    const events = buildIncomeEvents(txs, items, id, 'USD')
    expect(events).toHaveLength(1)
    expect(events[0].itemId).toBe('fondo')
    expect(events[0].amount).toBe(240)
    // Must be kept (the API drops reinvested === false)
    expect(events[0].reinvested).toBe(true)
  })

  it('resolves the destination by symbol when incomeDestination is a symbol', () => {
    const srcBySym = { ...vitali, incomeDestination: 'IDC-CASH' }
    const txs = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240, _linkedItemId: 'vitali' }]
    const events = buildIncomeEvents(txs, [srcBySym, fondo], id, 'USD')
    expect(events[0].itemId).toBe('fondo')
  })

  it('keeps a reinvested dividend attributed to the source symbol', () => {
    const reinvestSrc = { ...vitali, dividendAction: 'reinvest', incomeDestination: null }
    const txs = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240, _linkedItemId: 'vitali', _reinvested: true }]
    const events = buildIncomeEvents(txs, [reinvestSrc], id, 'USD')
    expect(events[0].itemId).toBe('vitali')
    expect(events[0].reinvested).toBe(true)
  })

  it('marks a cash dividend with no destination as not-reinvested (excluded downstream)', () => {
    const noDestSrc = { ...vitali, incomeDestination: null }
    const txs = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 240, _linkedItemId: 'vitali' }]
    const events = buildIncomeEvents(txs, [noDestSrc], id, 'USD')
    expect(events[0].itemId).toBe('vitali')
    expect(events[0].reinvested).toBe(false)
  })

  it('converts the amount to the target currency', () => {
    const convert = (v, from, to) => (from === 'EUR' && to === 'USD' ? v * 1.1 : v)
    const txs = [{ type: 'DIVIDEND', date: '2026-05-01', symbol: 'VITALI', totalAmount: 100, currency: 'EUR', _linkedItemId: 'vitali' }]
    const events = buildIncomeEvents(txs, items, convert, 'USD')
    expect(events[0].amount).toBeCloseTo(110)
  })
})
