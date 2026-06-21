import { detectKraken, detectKrakenLedger, parseKraken } from '../parsers/krakenParser'

describe('detectKraken', () => {
  it('returns true when headers contain txid, pair, vol, ordertxid', () => {
    const headers = ['txid', 'ordertxid', 'pair', 'time', 'type', 'ordertype', 'price', 'cost', 'fee', 'vol']
    expect(detectKraken(headers)).toBe(true)
  })

  it('returns false when required columns are missing', () => {
    expect(detectKraken(['txid', 'pair', 'vol'])).toBe(false)
    expect(detectKraken(['date', 'symbol', 'amount'])).toBe(false)
  })

  it('is case-insensitive', () => {
    const headers = ['TxId', 'OrderTxId', 'Pair', 'Time', 'Type', 'OrderType', 'Price', 'Cost', 'Fee', 'Vol']
    expect(detectKraken(headers)).toBe(true)
  })

  it('handles null/undefined values in headers', () => {
    const headers = [null, undefined, 'txid', 'ordertxid', 'pair', 'vol']
    expect(detectKraken(headers)).toBe(true)
  })
})

describe('detectKrakenLedger', () => {
  it('returns true for ledger headers', () => {
    const headers = ['txid', 'refid', 'time', 'type', 'subtype', 'aclass', 'asset', 'amount', 'fee', 'balance']
    expect(detectKrakenLedger(headers)).toBe(true)
  })

  it('returns false for trade headers', () => {
    const headers = ['txid', 'ordertxid', 'pair', 'time', 'type', 'vol']
    expect(detectKrakenLedger(headers)).toBe(false)
  })
})

describe('parseKraken — trades format', () => {
  const tradeHeaders = ['txid', 'ordertxid', 'pair', 'time', 'type', 'ordertype', 'price', 'cost', 'fee', 'vol']

  it('aggregates multiple buys into a single position', () => {
    const rows = [
      ['tx1', 'o1', 'XXBTZUSD', '2025-01-15', 'buy', 'limit', '40000', '4000', '1', '0.1'],
      ['tx2', 'o2', 'XXBTZUSD', '2025-02-10', 'buy', 'limit', '42000', '4200', '1', '0.1'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('BTC')
    expect(items[0].name).toBe('Bitcoin')
    expect(items[0].quantity).toBeCloseTo(0.2)
    expect(items[0].purchasePrice).toBeCloseTo(41000)
    expect(items[0].institution).toBe('Kraken')
    expect(items[0].type).toBe('Crypto')
  })

  it('handles buy then sell — net position', () => {
    const rows = [
      ['tx1', 'o1', 'XETHZUSD', '2025-01-01', 'buy', 'market', '3000', '3000', '0', '1'],
      ['tx2', 'o2', 'XETHZUSD', '2025-03-01', 'sell', 'market', '3500', '3500', '0', '0.5'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('ETH')
    expect(items[0].quantity).toBeCloseTo(0.5)
  })

  it('normalizes Kraken asset names (XXBT→BTC, XETH→ETH)', () => {
    const rows = [
      ['tx1', 'o1', 'XXBTZUSD', '2025-01-01', 'buy', 'market', '40000', '4000', '0', '0.1'],
      ['tx2', 'o2', 'XETHZUSD', '2025-01-01', 'buy', 'market', '3000', '3000', '0', '1'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    const symbols = items.map(i => i.symbol).sort()
    expect(symbols).toEqual(['BTC', 'ETH'])
  })

  it('filters out fiat-only pairs', () => {
    const rows = [
      ['tx1', 'o1', 'XETHZUSD', '2025-01-01', 'buy', 'market', '3000', '3000', '0', '1'],
      ['tx2', 'o2', 'USDCUSD', '2025-01-01', 'buy', 'market', '1', '100', '0', '100'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    const symbols = items.map(i => i.symbol)
    expect(symbols).toContain('ETH')
    expect(symbols).not.toContain('USD')
  })

  it('sets acquisitionDate from the earliest buy', () => {
    const rows = [
      ['tx1', 'o1', 'XXBTZUSD', '2025-03-10', 'buy', 'market', '40000', '4000', '0', '0.1'],
      ['tx2', 'o2', 'XXBTZUSD', '2025-01-05', 'buy', 'market', '38000', '3800', '0', '0.1'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    expect(items[0].acquisitionDate).toBe('2025-01-05')
  })

  it('excludes positions that were fully sold', () => {
    const rows = [
      ['tx1', 'o1', 'XXBTZUSD', '2025-01-01', 'buy', 'market', '40000', '4000', '0', '0.1'],
      ['tx2', 'o2', 'XXBTZUSD', '2025-02-01', 'sell', 'market', '42000', '4200', '0', '0.1'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    expect(items).toHaveLength(0)
  })

  it('uses latestPrice as currentPrice', () => {
    const rows = [
      ['tx1', 'o1', 'XXBTZUSD', '2025-01-01', 'buy', 'market', '40000', '4000', '0', '0.1'],
      ['tx2', 'o2', 'XXBTZUSD', '2025-03-01', 'buy', 'market', '45000', '4500', '0', '0.1'],
    ]
    const items = parseKraken(rows, tradeHeaders)
    expect(items[0].currentPrice).toBe(45000)
  })
})

describe('parseKraken — ledger format', () => {
  const ledgerHeaders = ['txid', 'refid', 'time', 'type', 'subtype', 'aclass', 'asset', 'amount', 'fee', 'balance']

  it('reads final balance from ledger rows', () => {
    const rows = [
      ['L1', 'R1', '2025-01-01', 'deposit', '', 'currency', 'XXBT', '0.5', '0', '0.5'],
      ['L2', 'R2', '2025-02-01', 'trade', '', 'currency', 'XXBT', '0.3', '0', '0.8'],
    ]
    const items = parseKraken(rows, ledgerHeaders)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('BTC')
    expect(items[0].quantity).toBe(0.8)
  })

  it('uses last row per asset (overwrites)', () => {
    const rows = [
      ['L1', 'R1', '2025-01-01', 'trade', '', 'currency', 'XETH', '5', '0', '5'],
      ['L2', 'R2', '2025-02-01', 'trade', '', 'currency', 'XETH', '2', '0', '7'],
      ['L3', 'R3', '2025-03-01', 'trade', '', 'currency', 'XETH', '-1', '0', '6'],
    ]
    const items = parseKraken(rows, ledgerHeaders)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(6)
  })

  it('filters out fiat assets', () => {
    const rows = [
      ['L1', 'R1', '2025-01-01', 'deposit', '', 'currency', 'ZUSD', '1000', '0', '1000'],
      ['L2', 'R2', '2025-01-01', 'trade', '', 'currency', 'XXBT', '0.05', '0', '0.05'],
    ]
    const items = parseKraken(rows, ledgerHeaders)
    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe('BTC')
  })

  it('sets purchasePrice and currentPrice to 0 for ledger items', () => {
    const rows = [
      ['L1', 'R1', '2025-01-01', 'trade', '', 'currency', 'XETH', '2', '0', '2'],
    ]
    const items = parseKraken(rows, ledgerHeaders)
    expect(items[0].purchasePrice).toBe(0)
    expect(items[0].currentPrice).toBe(0)
  })

  it('returns empty array when headers don\'t match any format', () => {
    const items = parseKraken([['a', 'b']], ['col1', 'col2'])
    expect(items).toEqual([])
  })
})
