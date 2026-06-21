import { detectCoinbase, parseCoinbase } from '../parsers/coinbaseParser'

describe('detectCoinbase', () => {
  it('returns true for Coinbase CSV headers', () => {
    const headers = ['Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted', 'Spot Price at Transaction', 'Subtotal', 'Total (inclusive of fees and/or spread)', 'Fees and/or Spread', 'Notes']
    expect(detectCoinbase(headers)).toBe(true)
  })

  it('returns false for non-Coinbase headers', () => {
    expect(detectCoinbase(['date', 'symbol', 'amount'])).toBe(false)
    expect(detectCoinbase(['txid', 'pair', 'vol'])).toBe(false)
  })

  it('is case-insensitive', () => {
    const headers = ['timestamp', 'transaction type', 'asset', 'quantity transacted', 'spot price at transaction']
    expect(detectCoinbase(headers)).toBe(true)
  })
})

describe('parseCoinbase', () => {
  const headers = ['Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted', 'Spot Price at Transaction', 'Subtotal', 'Total (inclusive of fees)', 'Fees', 'Notes']

  it('aggregates buy transactions into a single position', () => {
    const rows = [
      ['2025-01-10', 'Buy', 'BTC', '0.01', '40000', '400', '410', '10', ''],
      ['2025-02-15', 'Buy', 'BTC', '0.02', '42000', '840', '860', '20', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('BTC')
    expect(items[0].name).toBe('Bitcoin')
    expect(items[0].quantity).toBeCloseTo(0.03)
    expect(items[0].institution).toBe('Coinbase')
    expect(items[0].type).toBe('Crypto')
    expect(items[0].currentPrice).toBe(42000)
  })

  it('sell transaction reduces quantity', () => {
    const rows = [
      ['2025-01-01', 'Buy', 'ETH', '2', '3000', '6000', '6100', '100', ''],
      ['2025-02-01', 'Sell', 'ETH', '0.5', '3500', '1750', '1700', '50', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBeCloseTo(1.5)
  })

  it('receive and rewards income add to quantity', () => {
    const rows = [
      ['2025-01-01', 'Buy', 'SOL', '10', '100', '1000', '1020', '20', ''],
      ['2025-02-01', 'Receive', 'SOL', '2', '110', '220', '220', '0', ''],
      ['2025-03-01', 'Rewards Income', 'SOL', '0.5', '115', '57.5', '57.5', '0', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBeCloseTo(12.5)
  })

  it('convert reduces source asset and adds target', () => {
    const rows = [
      ['2025-01-01', 'Buy', 'BTC', '0.1', '40000', '4000', '4100', '100', ''],
      ['2025-02-01', 'Convert', 'BTC', '0.05', '42000', '2100', '2100', '0', 'Converted 0.05 BTC to 1.5 ETH'],
    ]
    const items = parseCoinbase(rows, headers)
    const btc = items.find(i => i.symbol === 'BTC')
    const eth = items.find(i => i.symbol === 'ETH')
    expect(btc.quantity).toBeCloseTo(0.05)
    expect(eth).toBeDefined()
    expect(eth.quantity).toBeCloseTo(1.5)
  })

  it('filters out tiny positions (qty <= 0.00000001)', () => {
    const rows = [
      ['2025-01-01', 'Buy', 'DOGE', '100', '0.1', '10', '10.5', '0.5', ''],
      ['2025-02-01', 'Sell', 'DOGE', '100', '0.12', '12', '11.5', '0.5', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items).toHaveLength(0)
  })

  it('sets acquisitionDate from earliest timestamp', () => {
    const rows = [
      ['2025-03-15', 'Buy', 'ADA', '100', '0.5', '50', '51', '1', ''],
      ['2025-01-10', 'Buy', 'ADA', '50', '0.4', '20', '21', '1', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items[0].acquisitionDate).toBe('2025-01-10')
  })

  it('uses spot price as latestSpot and avgCost correctly', () => {
    const rows = [
      ['2025-01-01', 'Buy', 'ETH', '1', '3000', '3000', '3050', '50', ''],
      ['2025-02-01', 'Buy', 'ETH', '1', '3500', '3500', '3550', '50', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items[0].currentPrice).toBe(3500)
    expect(items[0].purchasePrice).toBeCloseTo(3250)
  })

  it('handles empty rows gracefully', () => {
    const rows = [
      ['', '', '', '', '', '', '', '', ''],
      ['2025-01-01', 'Buy', 'BTC', '0.01', '40000', '400', '410', '10', ''],
    ]
    const items = parseCoinbase(rows, headers)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('BTC')
  })

  it('defaults currency to USD', () => {
    const items = parseCoinbase(
      [['2025-01-01', 'Buy', 'BTC', '0.01', '40000', '400', '410', '10', '']],
      headers
    )
    expect(items[0].currency).toBe('USD')
  })
})
