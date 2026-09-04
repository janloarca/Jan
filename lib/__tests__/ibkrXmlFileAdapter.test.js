// The file-import entry points (FileImportModal, IBKRSyncModal) used to reject
// the very file the app tells IBKR users to download: the Activity Flex Query
// in XML. This adapter is what lets that XML into the same import pipeline the
// sectioned CSV uses, so these tests pin its output shape to what
// formatIBKRFileResult produces (items / transactions / equityHistory /
// cashPositions / baseCurrency) using the REAL parseXmlToData underneath.

import { parseIBKRXmlFile } from '../parsers/ibkrXmlFileAdapter'

// A realistic Activity Flex Query response: every section the instructions ask
// for, self-closing AND paired tags, Lots detail, all five supported
// CashTransaction kinds, and a BASE_SUMMARY cash row that must be ignored.
const FULL_XML = `
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="2024-01-01" toDate="2024-12-31" period="Custom">
      <AccountInformation accountId="U1234567" currency="EUR" name="Jane Doe" />
      <EquitySummaryInBase>
        <EquitySummaryByReportDateInBase accountId="U1234567" reportDate="20240102" total="10000" totalLong="9500" totalShort="0" cash="500" />
        <EquitySummaryByReportDateInBase accountId="U1234567" reportDate="20240103" total="10100" totalLong="9580" totalShort="0" cash="520"></EquitySummaryByReportDateInBase>
        <EquitySummaryByReportDateInBase accountId="U1234567" reportDate="20240103" total="10100" totalLong="9580" totalShort="0" cash="520" />
      </EquitySummaryInBase>
      <OpenPositions>
        <OpenPosition accountId="U1234567" conid="265598" symbol="AAPL" description="APPLE INC" position="100"
          costBasisPrice="145.50" markPrice="182.30" currency="USD" assetCategory="STK"
          levelOfDetail="SUMMARY" openDateTime="20240101;120000" />
        <OpenPosition accountId="U1234567" conid="265598" symbol="AAPL" description="APPLE INC" position="60"
          costBasisPrice="140.00" markPrice="182.30" currency="USD" assetCategory="STK"
          levelOfDetail="LOT" openDateTime="20230311;093000" />
        <OpenPosition accountId="U1234567" conid="265598" symbol="AAPL" description="APPLE INC" position="40"
          costBasisPrice="153.75" markPrice="182.30" currency="USD" assetCategory="STK"
          levelOfDetail="LOT" openDateTime="20230602;101500" />
      </OpenPositions>
      <Trades>
        <Trade accountId="U1234567" symbol="AAPL" description="APPLE INC" buySell="BUY" quantity="60"
          tradePrice="140.00" proceeds="-8400" ibCommission="-1.25" currency="USD" tradeDate="20230311"
          assetCategory="STK" cost="8400" fifoPnlRealized="0" tradeID="T1001" />
        <Trade accountId="U1234567" symbol="AAPL" description="APPLE INC" buySell="BUY" quantity="40"
          tradePrice="153.75" proceeds="-6150" ibCommission="-1.00" currency="USD" tradeDate="20230602"
          assetCategory="STK" cost="6150" fifoPnlRealized="0" tradeID="T1002"></Trade>
      </Trades>
      <CashTransactions>
        <CashTransaction accountId="U1234567" type="Deposits/Withdrawals" amount="15000" currency="EUR"
          dateTime="20230102;081500" transactionID="D1" description="Wire In" />
        <CashTransaction accountId="U1234567" type="Deposits/Withdrawals" amount="-2000" currency="EUR"
          dateTime="20231115" transactionID="W1" description="Wire Out" />
        <CashTransaction accountId="U1234567" type="Dividends" amount="25.40" currency="USD" symbol="aapl"
          dateTime="20230810" transactionID="DV1" description="AAPL(US0378331005) Cash Dividend" />
        <CashTransaction accountId="U1234567" type="Withholding Tax" amount="-3.81" currency="USD"
          dateTime="20230810" transactionID="TX1" description="AAPL(US0378331005) Cash Dividend - US Tax" />
        <CashTransaction accountId="U1234567" type="Broker Interest Received" amount="2.10" currency="EUR"
          dateTime="20231002" transactionID="IN1" description="Broker Interest Received" />
        <CashTransaction accountId="U1234567" type="Other Fees" amount="-1.50" currency="USD"
          dateTime="20231201" transactionID="F1" description="Market Data Fee" />
      </CashTransactions>
      <CashReport>
        <CashReportCurrency accountId="U1234567" currency="USD" endingCash="1234.56" />
        <CashReportCurrency accountId="U1234567" currency="EUR" endingCash="-50.25"></CashReportCurrency>
        <CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="1180.00" />
      </CashReport>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`

describe('parseIBKRXmlFile · full report', () => {
  const r = parseIBKRXmlFile(FULL_XML)

  it('is not empty and reports the raw section counts', () => {
    expect(r.empty).toBe(false)
    expect(r.sections).toMatchObject({ openPositions: 3, trades: 2, cashTransactions: 6, equitySummary: 3, cashReport: 3 })
  })

  it('reads the base currency from AccountInformation', () => {
    expect(r.baseCurrency).toBe('EUR')
  })

  it('maps security positions and cash rows into items, without double counting lots', () => {
    const aapl = r.items.find((i) => i.symbol === 'AAPL')
    expect(aapl).toMatchObject({
      name: 'APPLE INC',
      type: 'Stock',
      quantity: 100,
      purchasePrice: 145.50,
      currentPrice: 182.30,
      institution: 'Interactive Brokers',
      currency: 'USD',
      _source: 'ibkr',
      _origin: 'file',
      _ibkrAccountId: 'U1234567',
      conid: '265598',
    })
    // Cash Report rows become CASH-<currency> items; BASE_SUMMARY is ignored.
    const cash = r.items.filter((i) => i.symbol.startsWith('CASH-')).map((i) => i.symbol).sort()
    expect(cash).toEqual(['CASH-EUR', 'CASH-USD'])
    expect(r.cashPositions).toHaveLength(2)
  })

  it('takes the earliest LOT open date as the real acquisition date', () => {
    const aapl = r.items.find((i) => i.symbol === 'AAPL')
    expect(aapl.acquisitionDate).toBe('2023-03-11')
  })

  it('maps trades to BUY/SELL transactions with _ibkrTxnId from tradeID', () => {
    const buys = r.transactions.filter((t) => t.type === 'BUY')
    expect(buys).toHaveLength(2)
    expect(buys[0]).toMatchObject({
      symbol: 'AAPL',
      date: '2023-03-11',
      quantity: 60,
      pricePerUnit: 140,
      totalAmount: 8400,
      commission: 1.25,
      currency: 'USD',
      _ibkrAccountId: 'U1234567',
      _ibkrTxnId: 'T1001',
      _source: 'ibkr',
    })
    expect(buys[1].date).toBe('2023-06-02')
    expect(buys[1]._ibkrTxnId).toBe('T1002')
  })

  it('maps the five cash-transaction kinds to canonical transaction types', () => {
    const byType = {}
    for (const t of r.transactions) byType[t.type] = (byType[t.type] || 0) + 1
    expect(byType).toMatchObject({ BUY: 2, DEPOSIT: 1, WITHDRAWAL: 1, DIVIDEND: 1, TAX: 1, INTEREST: 1, FEE: 1 })

    const dep = r.transactions.find((t) => t.type === 'DEPOSIT')
    expect(dep).toMatchObject({ symbol: 'CASH', date: '2023-01-02', totalAmount: 15000, currency: 'EUR', _ibkrTxnId: 'D1' })
    const wd = r.transactions.find((t) => t.type === 'WITHDRAWAL')
    expect(wd.totalAmount).toBe(2000)
    const div = r.transactions.find((t) => t.type === 'DIVIDEND')
    expect(div.symbol).toBe('AAPL')
    const fee = r.transactions.find((t) => t.type === 'FEE')
    expect(fee._signedAmount).toBe(-1.5)
  })

  it('maps the NAV rows to a deduped, sorted equityHistory tagged with base currency', () => {
    expect(r.equityHistory).toHaveLength(2)
    expect(r.equityHistory.map((e) => e.date)).toEqual(['2024-01-02', '2024-01-03'])
    expect(r.equityHistory[0]).toMatchObject({ netWorthUSD: 10000, _source: 'ibkr', _equityCurrency: 'EUR' })
  })

  it('collects the account ids', () => {
    expect(r.accounts).toContain('U1234567')
  })

  it('exposes the sections found for empty-file error messages', () => {
    expect(r._sectionNames).toEqual(expect.arrayContaining(['Open Positions', 'Trades', 'Net Asset Value (NAV) in Base']))
  })

  it('does not warn about a missing NAV section when it is present', () => {
    expect(r.warnings).not.toContain('missing-nav-section')
  })
})

describe('parseIBKRXmlFile · dedupe', () => {
  it('drops repeated trade rows (same tradeID or same composite key)', () => {
    const xml = `
      <Trades>
        <Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" tradeDate="20240115" tradeID="X1" />
        <Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" tradeDate="20240115" tradeID="X1" />
        <Trade symbol="MSFT" buySell="BUY" quantity="5" tradePrice="400" proceeds="-2000" tradeDate="20240115" />
        <Trade symbol="MSFT" buySell="BUY" quantity="5" tradePrice="400" proceeds="-2000" tradeDate="20240115" />
      </Trades>`
    const r = parseIBKRXmlFile(xml)
    expect(r.transactions).toHaveLength(2)
  })

  it('keeps two genuinely different same-day/same-amount trades when tradeIDs differ', () => {
    // This is exactly why _ibkrTxnId exists: without it both rows share the
    // deterministic doc id in bulkImport and one of them silently vanishes.
    const xml = `
      <Trades>
        <Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" tradeDate="20240115" tradeID="X1" />
        <Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" tradeDate="20240115" tradeID="X2" />
      </Trades>`
    const r = parseIBKRXmlFile(xml)
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions.map((t) => t._ibkrTxnId).sort()).toEqual(['X1', 'X2'])
  })

  it('keeps two same-day same-amount deposits made to DIFFERENT accounts', () => {
    // El caso de una asesora con la personal y un fideicomiso bajo el mismo
    // login. Sin transactionID en la query (perfectamente valido: los campos se
    // eligen a mano) la llave cae al composite, y la copia local que vivia aqui
    // omitia la cuenta: los dos aportes de 10.000 colapsaban en uno y el
    // segundo se descartaba EN EL PARSER, aguas arriba de transactionDocId, que
    // si los separa. Un deposito tragado se lee despues como ganancia.
    const xml = `
      <CashTransactions>
        <CashTransaction accountId="U111" type="Deposits/Withdrawals" amount="10000" currency="USD" dateTime="20240115" />
        <CashTransaction accountId="U222" type="Deposits/Withdrawals" amount="10000" currency="USD" dateTime="20240115" />
      </CashTransactions>`
    const r = parseIBKRXmlFile(xml)
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions.map((t) => t._ibkrAccountId).sort()).toEqual(['U111', 'U222'])
  })

  it('still drops a row repeated across pages within the SAME account', () => {
    // El control que le da sentido al de arriba: si la cuenta bastara para
    // separar cualquier cosa, el dedupe habria dejado de existir. La misma
    // fila de la misma cuenta sigue contando una vez.
    const xml = `
      <CashTransactions>
        <CashTransaction accountId="U111" type="Deposits/Withdrawals" amount="10000" currency="USD" dateTime="20240115" />
        <CashTransaction accountId="U111" type="Deposits/Withdrawals" amount="10000" currency="USD" dateTime="20240115" />
      </CashTransactions>`
    const r = parseIBKRXmlFile(xml)
    expect(r.transactions).toHaveLength(1)
  })

  it('falls back to no _ibkrTxnId when the query lacks the Trade ID column', () => {
    const xml = '<Trades><Trade symbol="AAPL" buySell="BUY" quantity="1" tradePrice="10" proceeds="-10" tradeDate="20240115" /></Trades>'
    const r = parseIBKRXmlFile(xml)
    expect(r.transactions[0]._ibkrTxnId).toBeUndefined()
  })
})

describe('parseIBKRXmlFile · acquisitionDate inference from trades', () => {
  it('stamps the earliest BUY when the file explains every share held', () => {
    const xml = `
      <OpenPositions>
        <OpenPosition accountId="U1" symbol="MSFT" position="15" costBasisPrice="300" markPrice="400" currency="USD" assetCategory="STK" />
      </OpenPositions>
      <Trades>
        <Trade accountId="U1" symbol="MSFT" buySell="BUY" quantity="10" tradePrice="280" proceeds="-2800" tradeDate="20240110" />
        <Trade accountId="U1" symbol="MSFT" buySell="BUY" quantity="5" tradePrice="340" proceeds="-1700" tradeDate="20240205" />
      </Trades>`
    const r = parseIBKRXmlFile(xml)
    expect(r.items[0].acquisitionDate).toBe('2024-01-10')
    expect(r.items[0]._historyIncomplete).toBeUndefined()
  })

  it('flags _historyIncomplete when the window cannot explain the holding', () => {
    const xml = `
      <OpenPositions>
        <OpenPosition accountId="U1" symbol="MSFT" position="100" costBasisPrice="300" markPrice="400" currency="USD" assetCategory="STK" />
      </OpenPositions>
      <Trades>
        <Trade accountId="U1" symbol="MSFT" buySell="BUY" quantity="5" tradePrice="340" proceeds="-1700" tradeDate="20240205" />
      </Trades>`
    const r = parseIBKRXmlFile(xml)
    expect(r.items[0]._historyIncomplete).toBe(true)
  })
})

describe('parseIBKRXmlFile · empty and NAV-missing behavior', () => {
  it('reports empty for a report with no usable data at all', () => {
    const r = parseIBKRXmlFile('<FlexQueryResponse><FlexStatements><FlexStatement></FlexStatement></FlexStatements></FlexQueryResponse>')
    expect(r.empty).toBe(true)
    expect(r.items).toEqual([])
    expect(r.transactions).toEqual([])
    expect(r.equityHistory).toEqual([])
  })

  it('warns when the NAV section is missing (the silent zero-history case)', () => {
    const xml = '<OpenPositions><OpenPosition symbol="AAPL" position="1" markPrice="180" currency="USD" assetCategory="STK" /></OpenPositions>'
    const r = parseIBKRXmlFile(xml)
    expect(r.empty).toBe(false)
    expect(r.warnings).toContain('missing-nav-section')
    expect(r.equityHistory).toEqual([])
  })

  it('accepts a NAV-only report (history backfill with no current positions)', () => {
    const xml = '<EquitySummaryInBase><EquitySummaryByReportDateInBase reportDate="20240115" total="10000" /></EquitySummaryInBase>'
    const r = parseIBKRXmlFile(xml)
    expect(r.empty).toBe(false)
    expect(r.items).toEqual([])
    expect(r.equityHistory).toHaveLength(1)
  })

  it('defaults baseCurrency to USD without AccountInformation', () => {
    const r = parseIBKRXmlFile('<Trades><Trade symbol="AAPL" buySell="BUY" quantity="1" tradePrice="10" proceeds="-10" tradeDate="20240115" /></Trades>')
    expect(r.baseCurrency).toBe('USD')
  })
})
