import {
  classifyError, mapAssetCategory, formatDate,
  parseFlexPositions, parseTrades, parseCashTransactions,
  parseBaseCurrency, parseXmlToData,
} from '../parsers/ibkrFlex'

describe('classifyError', () => {
  it('maps IBKR numeric codes (more stable than the English text)', () => {
    expect(classifyError('', '1019').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('', '1018').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('', '1020').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('', '1021').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('', '1003').errorCode).toBe('INVALID_QUERY')
    expect(classifyError('', '1015').errorCode).toBe('TOKEN_EXPIRED')
    expect(classifyError('', '1017').errorCode).toBe('TOKEN_EXPIRED')
  })

  it('lets the numeric code win over an unrecognized message', () => {
    // The whole point: IBKR rewording its prose must not degrade us to UNKNOWN.
    expect(classifyError('Some brand new wording nobody matched', '1019').errorCode).toBe('RATE_LIMITED')
  })

  it('falls back to text matching when there is no code', () => {
    expect(classifyError('Too many failed attempts').errorCode).toBe('LOCKED')
    expect(classifyError('Invalid token supplied').errorCode).toBe('TOKEN_EXPIRED')
    expect(classifyError('Invalid query id').errorCode).toBe('INVALID_QUERY')
    expect(classifyError('Statement could not be generated, please try again').errorCode).toBe('RATE_LIMITED')
    expect(classifyError('request timed out').errorCode).toBe('TIMEOUT')
  })

  it('LOCKED is detected so retries never refresh the lockout', () => {
    expect(classifyError('Please review your configuration').errorCode).toBe('LOCKED')
  })

  it('defaults to UNKNOWN and preserves the raw message', () => {
    const r = classifyError('something odd')
    expect(r.errorCode).toBe('UNKNOWN')
    expect(r.error).toBe('something odd')
  })
})

describe('mapAssetCategory', () => {
  it('maps the IBKR asset classes', () => {
    expect(mapAssetCategory('STK')).toBe('Stock')
    expect(mapAssetCategory('BOND')).toBe('Bond')
    expect(mapAssetCategory('BILL')).toBe('Bond')
    expect(mapAssetCategory('FUND')).toBe('ETF')
    expect(mapAssetCategory('CASH')).toBe('Bank')
    expect(mapAssetCategory('CRYPTO')).toBe('Crypto')
    expect(mapAssetCategory('OPT', 'C')).toBe('Option (C)')
    expect(mapAssetCategory('OPT')).toBe('Option')
  })
  it('defaults to Stock when the Asset Class column is missing', () => {
    // This is why the UI insists on ticking "Asset Class" in Open Positions.
    expect(mapAssetCategory('')).toBe('Stock')
  })
})

describe('formatDate', () => {
  it('normalizes YYYYMMDD and ISO, rejects junk', () => {
    expect(formatDate('20260115')).toBe('2026-01-15')
    expect(formatDate('2026-01-15T10:30:00')).toBe('2026-01-15')
    expect(formatDate('2026-01-15 10:30:00')).toBe('2026-01-15')
    expect(formatDate('not a date')).toBeUndefined()
    expect(formatDate('')).toBeUndefined()
  })

  it('handles the IBKR "date;time" shape (rows used to be dropped)', () => {
    // Regression: stripping the ";" glued time onto the date and returned
    // undefined, so every caller silently discarded the row.
    expect(formatDate('20260115;103000')).toBe('2026-01-15')
    expect(formatDate('2026-01-15;10:30:00')).toBe('2026-01-15')
  })
})

describe('parseFlexPositions', () => {
  it('parses SELF-CLOSING tags', () => {
    const xml = '<OpenPosition symbol="AAPL" description="Apple" position="10" costBasisPrice="150" markPrice="180" currency="USD" assetCategory="STK" accountId="U1" conid="265598" />'
    const r = parseFlexPositions(xml)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ symbol: 'AAPL', quantity: 10, purchasePrice: 150, currentPrice: 180, type: 'Stock', _ibkrAccountId: 'U1' })
  })

  it('parses PAIRED tags (the regression that appeared 4 times)', () => {
    const xml = '<OpenPosition symbol="msft" position="5" markPrice="400" assetCategory="STK"></OpenPosition>'
    const r = parseFlexPositions(xml)
    expect(r).toHaveLength(1)
    expect(r[0].symbol).toBe('MSFT')
  })

  it('does not match the <OpenPositions> container', () => {
    const xml = '<OpenPositions><OpenPosition symbol="AAPL" position="1" /></OpenPositions>'
    expect(parseFlexPositions(xml)).toHaveLength(1)
  })

  it('skips rows with no symbol or zero quantity', () => {
    const xml = '<OpenPosition symbol="" position="10" /><OpenPosition symbol="X" position="0" />'
    expect(parseFlexPositions(xml)).toHaveLength(0)
  })

  it('flags a short position as debt and keeps quantity absolute', () => {
    const r = parseFlexPositions('<OpenPosition symbol="TSLA" position="-3" />')
    expect(r[0].isDebt).toBe(true)
    expect(r[0].quantity).toBe(3)
  })

  it('handles multiple accounts', () => {
    const xml = '<OpenPosition symbol="A" position="1" accountId="U1" /><OpenPosition symbol="B" position="2" accountId="U2" />'
    expect(parseFlexPositions(xml).map((p) => p._ibkrAccountId)).toEqual(['U1', 'U2'])
  })
})

describe('parseTrades', () => {
  it('parses self-closing and paired trades, preferring ibCommission', () => {
    const xml = '<Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" ibCommission="1.25" tradeDate="20260115" accountId="U1" />'
      + '<Trade symbol="msft" buySell="SELL" quantity="-5" tradePrice="400" proceeds="2000"></Trade>'
    const r = parseTrades(xml)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ symbol: 'AAPL', buySell: 'BUY', commission: 1.25, tradeDate: '20260115' })
    expect(r[1].symbol).toBe('MSFT')
  })

  it('skips trades with no symbol', () => {
    expect(parseTrades('<Trade buySell="BUY" quantity="1" />')).toHaveLength(0)
  })
})

describe('parseCashTransactions', () => {
  it('classifies the five kinds', () => {
    const xml = [
      '<CashTransaction type="Deposits/Withdrawals" amount="1000" dateTime="20260110" currency="USD" />',
      '<CashTransaction type="Dividends" amount="25" dateTime="20260112" symbol="aapl" />',
      '<CashTransaction type="Withholding Tax" amount="-3.75" dateTime="20260112" />',
      '<CashTransaction type="Broker Interest Received" amount="2" dateTime="20260113" />',
      '<CashTransaction type="Other Fees" amount="-1.5" dateTime="20260114" />',
    ].join('')
    const r = parseCashTransactions(xml)
    expect(r.map((t) => t.kind)).toEqual(['flow', 'dividend', 'tax', 'interest', 'fee'])
    expect(r[1].symbol).toBe('AAPL')
  })

  it('routes "Payment In Lieu Of Dividends" to dividend, never to fee', () => {
    const r = parseCashTransactions('<CashTransaction type="Payment In Lieu Of Dividends" amount="10" dateTime="20260112" />')
    expect(r[0].kind).toBe('dividend')
  })

  it('parses PAIRED cash transaction tags', () => {
    const r = parseCashTransactions('<CashTransaction type="Deposits/Withdrawals" amount="500" dateTime="20260110"></CashTransaction>')
    expect(r).toHaveLength(1)
  })

  it('drops unknown types, zero amounts and undated rows', () => {
    const xml = '<CashTransaction type="Something Else" amount="10" dateTime="20260110" />'
      + '<CashTransaction type="Dividends" amount="0" dateTime="20260110" />'
      + '<CashTransaction type="Dividends" amount="5" dateTime="bogus" />'
    expect(parseCashTransactions(xml)).toHaveLength(0)
  })

  it('keeps rows whose dateTime uses the "date;time" shape', () => {
    // End-to-end guard for the formatDate fix: these rows were dropped entirely.
    const r = parseCashTransactions('<CashTransaction type="Deposits/Withdrawals" amount="1000" dateTime="20260110;162000" />')
    expect(r).toHaveLength(1)
    expect(r[0].date).toBe('2026-01-10')
  })

  it('keeps the signed amount so withdrawals stay negative', () => {
    const r = parseCashTransactions('<CashTransaction type="Deposits/Withdrawals" amount="-250" dateTime="20260110" />')
    expect(r[0].amount).toBe(-250)
  })
})

describe('parseBaseCurrency', () => {
  it('reads the account base currency, defaulting to USD', () => {
    expect(parseBaseCurrency('<AccountInformation accountId="U1" currency="eur" />')).toBe('EUR')
    expect(parseBaseCurrency('<FlexStatement />')).toBe('USD')
  })
})

describe('parseXmlToData', () => {
  it('counts raw sections independently of what parsed (the forensic layer)', () => {
    const xml = '<OpenPosition symbol="AAPL" position="1" /><Trade symbol="AAPL" /><CashTransaction type="Dividends" amount="1" dateTime="20260101" />'
    const d = parseXmlToData(xml)
    expect(d.sections).toMatchObject({ openPositions: 1, trades: 1, cashTransactions: 1 })
  })

  it('reports empty ONLY when nothing at all arrived', () => {
    expect(parseXmlToData('<FlexStatement></FlexStatement>').empty).toBe(true)
  })

  it('does NOT report empty for a NAV-only report (history-only query)', () => {
    // Regression guard for the BC3 fix: a liquidated / history-only account still
    // delivers real value history and must not be discarded as EMPTY_REPORT.
    const xml = '<EquitySummaryByReportDateInBase reportDate="20260115" total="10000" />'
    const d = parseXmlToData(xml)
    expect(d.empty).toBeUndefined()
    expect(d.equityHistory.length).toBeGreaterThan(0)
  })

  it('tags equity history with the account base currency', () => {
    const xml = '<AccountInformation currency="EUR" /><EquitySummaryByReportDateInBase reportDate="20260115" total="5000" />'
    expect(parseXmlToData(xml).equityHistory[0]._equityCurrency).toBe('EUR')
  })
})

describe('Open Positions at "Lots" level of detail', () => {
  // Turning Lots on is what makes IBKR ship a real purchase date with every
  // CURRENT position, regardless of how short the query period is. But it also
  // makes IBKR emit a SUMMARY row AND one LOT row per parcel for the same
  // holding: counting both would double the portfolio.
  const xml = `
    <OpenPositions>
      <OpenPosition accountId="U1" conid="265598" symbol="AAPL" description="APPLE INC" position="100"
        costBasisPrice="145.50" markPrice="182.30" currency="USD" assetCategory="STK"
        levelOfDetail="SUMMARY" openDateTime="20260101;120000" />
      <OpenPosition accountId="U1" conid="265598" symbol="AAPL" description="APPLE INC" position="60"
        costBasisPrice="140.00" markPrice="182.30" currency="USD" assetCategory="STK"
        levelOfDetail="LOT" openDateTime="20240311;093000" />
      <OpenPosition accountId="U1" conid="265598" symbol="AAPL" description="APPLE INC" position="40"
        costBasisPrice="153.75" markPrice="182.30" currency="USD" assetCategory="STK"
        levelOfDetail="LOT" openDateTime="20250602;101500" />
    </OpenPositions>`

  it('does NOT double count: one holding, the summary quantity', () => {
    const positions = parseFlexPositions(xml)
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity).toBe(100)
  })

  it('takes the EARLIEST lot as the real acquisition date', () => {
    expect(parseFlexPositions(xml)[0].acquisitionDate).toBe('2024-03-11')
  })

  it('rebuilds the holding by summing parcels when no summary row is present', () => {
    const lotsOnly = `
      <OpenPositions>
        <OpenPosition accountId="U1" conid="265598" symbol="AAPL" position="60" costBasisPrice="140"
          markPrice="182.30" currency="USD" assetCategory="STK" levelOfDetail="LOT" openDateTime="20240311;093000" />
        <OpenPosition accountId="U1" conid="265598" symbol="AAPL" position="40" costBasisPrice="153.75"
          markPrice="182.30" currency="USD" assetCategory="STK" levelOfDetail="LOT" openDateTime="20250602;101500" />
      </OpenPositions>`
    const positions = parseFlexPositions(lotsOnly)
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity).toBe(100)
    expect(positions[0].acquisitionDate).toBe('2024-03-11')
  })

  it('keeps the same symbol in two accounts separate', () => {
    const twoAccounts = `
      <OpenPositions>
        <OpenPosition accountId="U1" conid="265598" symbol="AAPL" position="10" markPrice="182" currency="USD"
          assetCategory="STK" levelOfDetail="LOT" openDateTime="20240311;093000" />
        <OpenPosition accountId="U2" conid="265598" symbol="AAPL" position="5" markPrice="182" currency="USD"
          assetCategory="STK" levelOfDetail="LOT" openDateTime="20250101;093000" />
      </OpenPositions>`
    const positions = parseFlexPositions(twoAccounts)
    expect(positions).toHaveLength(2)
    expect(positions.reduce((s, p) => s + p.quantity, 0)).toBe(15)
  })

  it('leaves a plain summary-only query untouched', () => {
    const summaryOnly = `
      <OpenPositions>
        <OpenPosition accountId="U1" symbol="AAPL" position="100" costBasisPrice="145.50" markPrice="182.30"
          currency="USD" assetCategory="STK" levelOfDetail="SUMMARY" />
        <OpenPosition accountId="U1" symbol="MSFT" position="50" costBasisPrice="280" markPrice="380"
          currency="USD" assetCategory="STK" levelOfDetail="SUMMARY" />
      </OpenPositions>`
    const positions = parseFlexPositions(summaryOnly)
    expect(positions).toHaveLength(2)
    expect(positions.map(p => p.quantity)).toEqual([100, 50])
  })
})
