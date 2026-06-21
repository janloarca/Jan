import { isIBKRSectionedFormat, detectIBKRFile, isIBKRPerformanceReport, parseIBKRFile, formatIBKRFileResult } from '../parsers/ibkrFileParser'

describe('isIBKRSectionedFormat', () => {
  it('returns true for text containing ,Header,', () => {
    expect(isIBKRSectionedFormat('Statement,Header,Field1\nOpen Positions,Data,AAPL')).toBe(true)
  })

  it('returns true for text containing ,Data,', () => {
    expect(isIBKRSectionedFormat('Open Positions,Data,AAPL,100')).toBe(true)
  })

  it('returns false for plain CSV', () => {
    expect(isIBKRSectionedFormat('Symbol,Quantity,Price\nAAPL,100,150')).toBe(false)
  })

  it('returns false for non-string input', () => {
    expect(isIBKRSectionedFormat(123)).toBe(false)
    expect(isIBKRSectionedFormat(null)).toBe(false)
  })
})

describe('detectIBKRFile', () => {
  it('detects "interactive brokers" + "open pos"', () => {
    expect(detectIBKRFile('Interactive Brokers Activity Statement\nOpen Positions')).toBe(true)
  })

  it('detects "statement,header" + "open pos"', () => {
    expect(detectIBKRFile('Statement,Header,Field\nOpen Positions,Header,Symbol')).toBe(true)
  })

  it('rejects non-IBKR text', () => {
    expect(detectIBKRFile('Coinbase Transaction History\nBuy,BTC,0.1')).toBe(false)
  })

  it('rejects performance report', () => {
    const text = 'Portfolio Analyst\nBenchmark\nCumulative Returns'
    expect(detectIBKRFile(text)).toBe(false)
  })

  it('handles header array input', () => {
    expect(detectIBKRFile(['Interactive Brokers', 'Open Positions', 'Statement'])).toBe(true)
  })
})

describe('isIBKRPerformanceReport', () => {
  it('returns true for "portfolio analyst" + "benchmark" + "cumulative"', () => {
    expect(isIBKRPerformanceReport('Portfolio Analyst Report\nBenchmark Returns\nCumulative Performance')).toBe(true)
  })

  it('returns false when "open position" with symbol/quantity/header is present', () => {
    expect(isIBKRPerformanceReport('Portfolio Analyst\nOpen Position\nSymbol\nBenchmark\nCumulative')).toBe(false)
  })

  it('returns false when "allocation by financial instrument" is present', () => {
    expect(isIBKRPerformanceReport('Portfolio Analyst\nAllocation by Financial Instrument\nBenchmark\nCumulative')).toBe(false)
  })

  it('handles empty/non-string input', () => {
    expect(isIBKRPerformanceReport('')).toBe(false)
    expect(isIBKRPerformanceReport(null)).toBe(false)
    expect(isIBKRPerformanceReport(123)).toBe(false)
  })
})

describe('parseIBKRFile — activity statement (sectioned format)', () => {
  it('parses open positions with all columns', () => {
    const csv = [
      'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Description,Quantity,Cost Price,Close Price,Value',
      'Open Positions,Data,Summary,STK,USD,AAPL,Apple Inc,100,145.50,182.30,18230',
      'Open Positions,Data,Summary,STK,USD,MSFT,Microsoft Corp,50,280.00,380.00,19000',
    ].join('\n')
    const result = parseIBKRFile(csv)
    expect(result.positions).toHaveLength(2)

    const aapl = result.positions.find(p => p.symbol === 'AAPL')
    expect(aapl.quantity).toBe(100)
    expect(aapl.currentPrice).toBe(182.30)
    expect(aapl.currency).toBe('USD')
    expect(aapl.type).toBe('Stock')
    expect(aapl._source).toBe('ibkr')
    expect(aapl.institution).toBe('Interactive Brokers')
  })

  it('skips total/subtotal rows', () => {
    const csv = [
      'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Description,Quantity,Cost Price,Close Price,Value',
      'Open Positions,Data,Summary,STK,USD,AAPL,Apple Inc,100,145,182,18200',
      'Open Positions,Data,Total,,,,,200,,,37200',
    ].join('\n')
    const result = parseIBKRFile(csv)
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].symbol).toBe('AAPL')
  })

  it('skips zero-quantity positions', () => {
    const csv = [
      'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Description,Quantity,Cost Price,Close Price,Value',
      'Open Positions,Data,Summary,STK,USD,AAPL,Apple Inc,0,145,182,0',
    ].join('\n')
    const result = parseIBKRFile(csv)
    expect(result.positions).toHaveLength(0)
  })

  it('parses trades section with BUY/SELL distinction', () => {
    const csv = [
      'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Buy/Sell,Realized P/L',
      'Trades,Data,Order,STK,USD,AAPL,2025-01-15,50,150,-7500,-1,BUY,0',
      'Trades,Data,Order,STK,USD,MSFT,2025-02-10,-20,380,7600,-1,SELL,500',
    ].join('\n')
    const result = parseIBKRFile(csv)
    expect(result.trades).toHaveLength(2)
    expect(result.trades[0].type).toBe('BUY')
    expect(result.trades[0].symbol).toBe('AAPL')
    expect(result.trades[1].type).toBe('SELL')
  })

  it('parses cash report section', () => {
    const csv = [
      'Cash Report,Header,DataDiscriminator,Currency,Ending Cash',
      'Cash Report,Data,Starting Cash,USD,10000',
      'Cash Report,Data,Ending Cash,USD,12500',
      'Cash Report,Data,Ending Cash,EUR,3000',
    ].join('\n')
    const result = parseIBKRFile(csv)
    const usdCash = result.cashPositions.find(p => p.symbol === 'CASH-USD')
    const eurCash = result.cashPositions.find(p => p.symbol === 'CASH-EUR')
    expect(usdCash).toBeDefined()
    expect(eurCash).toBeDefined()
    expect(eurCash.currentPrice).toBe(3000)
  })

  it('parses deposits and withdrawals', () => {
    const csv = [
      'Deposits & Withdrawals,Header,Date,Type,Description,Amount',
      'Deposits & Withdrawals,Data,2025-01-10,DEPOSIT,Electronic Fund Transfer,5000',
      'Deposits & Withdrawals,Data,2025-03-15,WITHDRAWAL,Wire Transfer,-2000',
    ].join('\n')
    const result = parseIBKRFile(csv)
    const deposits = result.trades.filter(t => t.type === 'DEPOSIT')
    const withdrawals = result.trades.filter(t => t.type === 'WITHDRAWAL')
    expect(deposits).toHaveLength(1)
    expect(deposits[0].totalAmount).toBe(5000)
    expect(withdrawals).toHaveLength(1)
    expect(withdrawals[0].totalAmount).toBe(2000)
  })

  it('extracts NAV from equity history section', () => {
    const csv = [
      'Net Asset Value,Header,Date,Net Asset Value',
      'Net Asset Value,Data,2025-01-31,50000',
      'Net Asset Value,Data,2025-02-28,52000',
    ].join('\n')
    const result = parseIBKRFile(csv)
    expect(result.equityHistory).toHaveLength(2)
    expect(result.equityHistory[0].netWorthUSD).toBe(50000)
    expect(result.equityHistory[0]._source).toBe('ibkr')
  })
})

describe('parseIBKRFile — flat CSV format', () => {
  it('parses flat row/header arrays', () => {
    const headers = ['Symbol', 'Description', 'Quantity', 'Close Price', 'Currency', 'Asset Category']
    const rows = [
      ['AAPL', 'Apple Inc', '100', '182.30', 'USD', 'STK'],
      ['MSFT', 'Microsoft Corp', '50', '380.00', 'USD', 'STK'],
    ]
    const result = parseIBKRFile(rows, headers)
    expect(result.positions).toHaveLength(2)
    expect(result.positions[0].symbol).toBe('AAPL')
    expect(result.positions[0]._source).toBe('ibkr')
  })

  it('parses plain CSV string without sectioned format', () => {
    const csv = 'Symbol,Description,Quantity,Close Price,Currency\nAAPL,Apple Inc,100,182.30,USD\nTSLA,Tesla Inc,25,250.00,USD'
    const result = parseIBKRFile(csv)
    expect(result.positions).toHaveLength(2)
  })

  it('skips zero-quantity rows', () => {
    const headers = ['Symbol', 'Description', 'Quantity', 'Close Price', 'Currency']
    const rows = [
      ['AAPL', 'Apple Inc', '100', '182.30', 'USD'],
      ['SOLD', 'Sold Position', '0', '50.00', 'USD'],
    ]
    const result = parseIBKRFile(rows, headers)
    expect(result.positions).toHaveLength(1)
  })
})

describe('parseIBKRFile — combined activity + PA deduplication', () => {
  it('deduplicates positions from activity and PA sections', () => {
    const csv = [
      'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Description,Quantity,Cost Price,Close Price,Value',
      'Open Positions,Data,Summary,STK,USD,AAPL,Apple Inc,100,145,182,18200',
    ].join('\n')
    const result = parseIBKRFile(csv)
    const aaplPositions = result.positions.filter(p => p.symbol === 'AAPL')
    expect(aaplPositions).toHaveLength(1)
  })
})

describe('formatIBKRFileResult', () => {
  it('combines positions + cashPositions and filters zero-qty', () => {
    const parsed = {
      positions: [
        { symbol: 'AAPL', name: 'Apple', type: 'Stock', quantity: 100, purchasePrice: 145, currentPrice: 182, currency: 'USD', institution: 'Interactive Brokers', _source: 'ibkr' },
        { symbol: 'ZERO', name: 'Zero', type: 'Stock', quantity: 0, purchasePrice: 50, currentPrice: 55, currency: 'USD', institution: 'Interactive Brokers', _source: 'ibkr' },
      ],
      cashPositions: [
        { symbol: 'CASH-USD', name: 'Cash (USD)', type: 'Bank', quantity: 1, purchasePrice: 5000, currentPrice: 5000, currency: 'USD', institution: 'Interactive Brokers', _source: 'ibkr' },
      ],
      trades: [],
      equityHistory: [],
      benchmarks: [],
    }
    const result = formatIBKRFileResult(parsed)
    expect(result.items).toHaveLength(2)
    expect(result.items.find(i => i.symbol === 'ZERO')).toBeUndefined()
    expect(result.items.find(i => i.symbol === 'CASH-USD')).toBeDefined()
  })

  it('preserves acquisitionDate, conid, _ibkrAccountId', () => {
    const parsed = {
      positions: [
        { symbol: 'AAPL', name: 'Apple', type: 'Stock', quantity: 100, purchasePrice: 145, currentPrice: 182, currency: 'USD', institution: 'IB', _source: 'ibkr', acquisitionDate: '2024-01-15', conid: '265598', _ibkrAccountId: 'U1234567' },
      ],
      cashPositions: [],
      trades: [],
      equityHistory: [],
    }
    const result = formatIBKRFileResult(parsed)
    expect(result.items[0].acquisitionDate).toBe('2024-01-15')
    expect(result.items[0].conid).toBe('265598')
    expect(result.items[0]._ibkrAccountId).toBe('U1234567')
  })

  it('extracts unique accounts', () => {
    const parsed = {
      positions: [
        { symbol: 'AAPL', name: 'Apple', type: 'Stock', quantity: 100, purchasePrice: 145, currentPrice: 182, currency: 'USD', institution: 'IB', _source: 'ibkr', _ibkrAccountId: 'U1234567' },
        { symbol: 'MSFT', name: 'Microsoft', type: 'Stock', quantity: 50, purchasePrice: 280, currentPrice: 380, currency: 'USD', institution: 'IB', _source: 'ibkr', _ibkrAccountId: 'U1234567' },
        { symbol: 'TSLA', name: 'Tesla', type: 'Stock', quantity: 25, purchasePrice: 200, currentPrice: 250, currency: 'USD', institution: 'IB', _source: 'ibkr', _ibkrAccountId: 'U7654321' },
      ],
      cashPositions: [],
      trades: [],
      equityHistory: [],
    }
    const result = formatIBKRFileResult(parsed)
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts).toContain('U1234567')
    expect(result.accounts).toContain('U7654321')
  })

  it('returns transactions and equityHistory from parsed input', () => {
    const parsed = {
      positions: [],
      cashPositions: [],
      trades: [{ type: 'BUY', symbol: 'AAPL', totalAmount: 1500 }],
      equityHistory: [{ date: '2025-01-31', netWorthUSD: 50000 }],
      benchmarks: [{ name: 'S&P 500' }],
    }
    const result = formatIBKRFileResult(parsed)
    expect(result.transactions).toHaveLength(1)
    expect(result.equityHistory).toHaveLength(1)
    expect(result.benchmarks).toHaveLength(1)
  })
})

describe('parseIBKRFile — empty/invalid input', () => {
  it('returns empty arrays for non-string non-array input', () => {
    const result = parseIBKRFile(123)
    expect(result.positions).toEqual([])
    expect(result.trades).toEqual([])
  })

  it('handles BOM in CSV text', () => {
    const csv = '﻿Symbol,Quantity,Close Price,Currency\nAAPL,100,182.30,USD'
    const result = parseIBKRFile(csv)
    expect(result.positions).toHaveLength(1)
  })
})
