import { parseCashPositions } from '../parsers/ibkrCashReport'

describe('parseCashPositions', () => {
  it('parses self-closing CashReportCurrency rows', () => {
    const xml = `<CashReportCurrency currency="USD" endingCash="1234.56" />`
    const out = parseCashPositions(xml)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      symbol: 'CASH-USD', name: 'Cash (USD)', quantity: 1,
      currentPrice: 1234.56, currency: 'USD', type: 'Bank',
      institution: 'Interactive Brokers', isDebt: false,
    })
  })

  it('parses PAIRED rows: the shape a /> regex dropped entirely', () => {
    const xml = `<CashReportCurrency currency="USD" endingCash="500"></CashReportCurrency>`
    const out = parseCashPositions(xml)
    expect(out).toHaveLength(1)
    expect(out[0].currentPrice).toBe(500)
  })

  it('ignores the bare <CashReport> container and BASE_SUMMARY rows', () => {
    const xml = `
      <CashReport>
        <CashReportCurrency currency="BASE_SUMMARY" endingCash="999" />
        <CashReportCurrency currency="USD" endingCash="100" />
      </CashReport>
    `
    const out = parseCashPositions(xml)
    expect(out).toHaveLength(1)
    expect(out[0].symbol).toBe('CASH-USD')
  })

  it('skips zero balances and falls back to endingSettledCash', () => {
    const xml = `
      <CashReportCurrency currency="EUR" endingCash="0" />
      <CashReportCurrency currency="GBP" endingSettledCash="42" />
    `
    const out = parseCashPositions(xml)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ symbol: 'CASH-GBP', currentPrice: 42 })
  })

  it('marks negative balances as debt with absolute value', () => {
    const xml = `<CashReportCurrency currency="USD" endingCash="-250.5" />`
    const out = parseCashPositions(xml)
    expect(out[0]).toMatchObject({ isDebt: true, currentPrice: 250.5 })
  })

  it('handles multi-currency and dedupes repeated account+currency rows', () => {
    const xml = `
      <CashReportCurrency accountId="U111" currency="USD" endingCash="100" />
      <CashReportCurrency accountId="U111" currency="USD" endingCash="100" />
      <CashReportCurrency accountId="U111" currency="EUR" endingCash="50" />
      <CashReportCurrency accountId="U222" currency="USD" endingCash="75" />
    `
    const out = parseCashPositions(xml)
    expect(out).toHaveLength(3)
    expect(out.map((p) => p.currentPrice)).toEqual([100, 50, 75])
  })

  it('returns [] for empty input', () => {
    expect(parseCashPositions('')).toEqual([])
    expect(parseCashPositions(null)).toEqual([])
  })
})
