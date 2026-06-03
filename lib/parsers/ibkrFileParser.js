function parseNum(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return isFinite(val) ? val : 0
  const cleaned = val.toString().replace(/[$€£,\s]/g, '').replace(/\((.+)\)/, '-$1')
  const num = parseFloat(cleaned)
  return isFinite(num) ? num : 0
}

function parseDate(val) {
  if (!val) return undefined
  const s = val.toString().trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-')
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [m, d, y] = s.split('/')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return undefined
}

function findCol(headers, ...patterns) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  for (const p of patterns) {
    const idx = lower.findIndex(h => h === p || h.includes(p))
    if (idx !== -1) return idx
  }
  return -1
}

function mapAssetCategory(cat) {
  const c = (cat || '').toUpperCase()
  if (c === 'STK' || c === 'STOCK' || c.includes('STOCK')) return 'Stock'
  if (c === 'BOND' || c === 'BILL' || c.includes('BOND')) return 'Bond'
  if (c === 'FUND' || c === 'ETF' || c.includes('ETF') || c.includes('FUND')) return 'ETF'
  if (c === 'CASH' || c.includes('CASH')) return 'Bank'
  if (c === 'OPT' || c === 'FOP' || c.includes('OPTION')) return 'Option'
  if (c === 'FUT' || c.includes('FUTURE')) return 'Futures'
  if (c === 'CRYPTO' || c.includes('CRYPTO')) return 'Crypto'
  if (c === 'WAR' || c.includes('WARRANT')) return 'Warrant'
  return 'Stock'
}

function parseSectionedCSV(text) {
  const lines = text.split(/\r?\n/)
  const sections = {}
  let currentSection = null
  let currentHeaders = null

  for (const line of lines) {
    if (!line.trim()) continue
    const parts = parseCSVLine(line)
    if (parts.length < 2) continue

    const sectionName = parts[0].trim()
    const rowType = parts[1].trim()

    if (rowType === 'Header') {
      currentSection = sectionName
      currentHeaders = parts.slice(2)
      if (!sections[currentSection]) sections[currentSection] = { headers: currentHeaders, rows: [] }
      else sections[currentSection].headers = currentHeaders
    } else if (rowType === 'Data' && currentSection && currentHeaders) {
      const values = parts.slice(2)
      if (!sections[currentSection]) sections[currentSection] = { headers: currentHeaders, rows: [] }
      sections[currentSection].rows.push(values)
    } else if (rowType === 'MetaInfo') {
      if (!sections[sectionName]) sections[sectionName] = { headers: [], rows: [], meta: {} }
      if (!sections[sectionName].meta) sections[sectionName].meta = {}
      const key = (parts[2] || '').trim()
      const val = (parts[3] || '').trim()
      if (key) sections[sectionName].meta[key] = val
    }
  }
  return sections
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

export function detectIBKRFile(textOrHeaders) {
  const text = Array.isArray(textOrHeaders) ? textOrHeaders.join(',') : textOrHeaders
  const lower = text.toLowerCase()
  return (
    (lower.includes('interactive brokers') && (lower.includes('open positions') || lower.includes('trades') || lower.includes('statement'))) ||
    (lower.includes('ibkr') && lower.includes('header') && lower.includes('data')) ||
    (/statement,header/i.test(text) && /open positions/i.test(text)) ||
    (lower.includes('portfolio analyst') && lower.includes('header')) ||
    (lower.includes('key statistics') && lower.includes('header')) ||
    (lower.includes('benchmark') && lower.includes('cumulative') && lower.includes('header')) ||
    (lower.includes('allocation by') && lower.includes('header'))
  )
}

function parseActivityStatementSections(sections) {
  const positions = []
  const trades = []
  const cashPositions = []
  const equityHistory = []

  if (sections['Open Positions']) {
    const { headers, rows } = sections['Open Positions']
    const symIdx = findCol(headers, 'symbol')
    const descIdx = findCol(headers, 'description')
    const catIdx = findCol(headers, 'asset category')
    const qtyIdx = findCol(headers, 'quantity', 'position')
    const costIdx = findCol(headers, 'cost price', 'cost basis price', 'avg cost')
    const priceIdx = findCol(headers, 'close price', 'mark price', 'mark-to-market', 'current price')
    const curIdx = findCol(headers, 'currency')
    const discIdx = findCol(headers, 'datadiscriminator')

    for (const row of rows) {
      const disc = discIdx >= 0 ? (row[discIdx] || '').trim().toLowerCase() : ''
      if (disc === 'total' || disc === 'subtotal') continue

      const symbol = symIdx >= 0 ? (row[symIdx] || '').trim().toUpperCase() : ''
      if (!symbol) continue

      const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
      if (qty === 0) continue

      const cat = catIdx >= 0 ? (row[catIdx] || '').trim() : ''
      const cost = parseNum(costIdx >= 0 ? row[costIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'

      positions.push({
        symbol,
        name: descIdx >= 0 ? (row[descIdx] || '').trim() || symbol : symbol,
        type: mapAssetCategory(cat),
        quantity: Math.abs(qty),
        purchasePrice: cost,
        currentPrice: price || cost,
        currency,
        institution: 'Interactive Brokers',
        isDebt: qty < 0,
        _source: 'ibkr',
      })
    }
  }

  if (sections['Trades'] || sections['Trades - Realized P/L']) {
    const section = sections['Trades'] || sections['Trades - Realized P/L']
    const { headers, rows } = section
    const symIdx = findCol(headers, 'symbol')
    const descIdx = findCol(headers, 'description')
    const dateIdx = findCol(headers, 'date/time', 'date', 'trade date')
    const qtyIdx = findCol(headers, 'quantity')
    const priceIdx = findCol(headers, 't. price', 'trade price', 'price')
    const proceedsIdx = findCol(headers, 'proceeds')
    const commIdx = findCol(headers, 'comm/fee', 'commission', 'ibcommission')
    const curIdx = findCol(headers, 'currency')
    const buySellIdx = findCol(headers, 'buy/sell', 'buysell', 'side')
    const plIdx = findCol(headers, 'realized p/l', 'realized p&l', 'fifopnlrealized')
    const costIdx = findCol(headers, 'cost', 'basis', 'cost basis')
    const discIdx = findCol(headers, 'datadiscriminator')

    for (const row of rows) {
      const disc = discIdx >= 0 ? (row[discIdx] || '').trim().toLowerCase() : ''
      if (disc === 'total' || disc === 'subtotal') continue

      const symbol = symIdx >= 0 ? (row[symIdx] || '').trim().toUpperCase() : ''
      if (!symbol) continue

      const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      const proceeds = parseNum(proceedsIdx >= 0 ? row[proceedsIdx] : 0)
      const commission = parseNum(commIdx >= 0 ? row[commIdx] : 0)
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'
      const dateStr = dateIdx >= 0 ? (row[dateIdx] || '').trim() : ''
      const buySell = buySellIdx >= 0 ? (row[buySellIdx] || '').trim().toUpperCase() : (qty > 0 ? 'BUY' : 'SELL')
      const isBuy = buySell.includes('BUY') || buySell === 'B'

      trades.push({
        type: isBuy ? 'BUY' : 'SELL',
        symbol,
        description: `${descIdx >= 0 ? (row[descIdx] || '').trim() : symbol} — ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(qty)} @ ${price}`,
        date: parseDate(dateStr) || new Date().toISOString().split('T')[0],
        quantity: Math.abs(qty),
        pricePerUnit: price,
        totalAmount: Math.abs(proceeds || qty * price),
        commission: Math.abs(commission),
        currency,
        _ibkrRealizedPL: parseNum(plIdx >= 0 ? row[plIdx] : 0),
        _ibkrCostBasis: parseNum(costIdx >= 0 ? row[costIdx] : 0),
        _source: 'ibkr',
      })
    }
  }

  if (sections['Cash Report']) {
    const { headers, rows } = sections['Cash Report']
    const curIdx = findCol(headers, 'currency')
    const balIdx = findCol(headers, 'ending cash', 'ending settled cash', 'total')
    const discIdx = findCol(headers, 'datadiscriminator')

    for (const row of rows) {
      const disc = discIdx >= 0 ? (row[discIdx] || '').trim().toLowerCase() : ''
      if (disc === 'total' || disc === 'subtotal') continue

      const currency = curIdx >= 0 ? (row[curIdx] || '').trim() : ''
      if (!currency || currency === 'BASE_SUMMARY') continue

      const balance = parseNum(balIdx >= 0 ? row[balIdx] : 0)
      if (balance === 0) continue

      cashPositions.push({
        symbol: `CASH-${currency}`,
        name: `Cash (${currency})`,
        type: 'Bank',
        quantity: 1,
        purchasePrice: Math.abs(balance),
        currentPrice: Math.abs(balance),
        currency,
        institution: 'Interactive Brokers',
        isDebt: balance < 0,
        _source: 'ibkr',
      })
    }
  }

  const navSection = sections['Mark-to-Market Performance Summary'] || sections['Change in NAV'] || sections['Net Asset Value']
  if (navSection) {
    const { headers, rows } = navSection
    const dateIdx = findCol(headers, 'date', 'report date')
    const totalIdx = findCol(headers, 'total', 'ending value', 'net asset value', 'nav')

    for (const row of rows) {
      const date = parseDate(dateIdx >= 0 ? row[dateIdx] : '')
      const total = parseNum(totalIdx >= 0 ? row[totalIdx] : 0)
      if (!date || total === 0) continue
      equityHistory.push({ date, netWorthUSD: total, totalActivosUSD: total, _source: 'ibkr' })
    }
  }

  return { positions, trades, cashPositions, equityHistory }
}

function parsePortfolioAnalystSections(sections) {
  const positions = []
  const trades = []
  const cashPositions = []
  const equityHistory = []
  const benchmarks = []

  // Key Statistics — extract NAV values
  if (sections['Key Statistics']) {
    const { headers, rows } = sections['Key Statistics']
    const metricIdx = findCol(headers, 'metric', 'key', 'statistic', 'field', 'name')
    const valueIdx = findCol(headers, 'value', 'amount', 'result')

    // If it's a simple 2-column metric/value layout
    if (metricIdx >= 0 && valueIdx >= 0) {
      const stats = {}
      for (const row of rows) {
        const key = (row[metricIdx] || '').trim()
        const val = (row[valueIdx] || '').trim()
        if (key) stats[key] = val
      }
      extractKeyStatistics(stats, equityHistory)
    } else {
      // Try treating each header as a metric name with corresponding values
      const stats = {}
      for (const row of rows) {
        for (let i = 0; i < headers.length; i++) {
          const key = (headers[i] || '').trim()
          const val = (row[i] || '').trim()
          if (key && val) stats[key] = val
        }
      }
      extractKeyStatistics(stats, equityHistory)
    }
  }

  // Allocation by Asset Class — extract positions by asset type
  const allocSection = sections['Allocation by Asset Class'] || sections['Allocation by Sector'] ||
    sections['Allocation by Financial Instrument'] || sections['Positions'] || sections['Holdings']
  if (allocSection) {
    const { headers, rows } = allocSection
    const symIdx = findCol(headers, 'symbol', 'ticker', 'financial instrument', 'instrument', 'name', 'security')
    const catIdx = findCol(headers, 'asset class', 'asset category', 'type', 'sector')
    const valueIdx = findCol(headers, 'market value', 'value', 'position value', 'ending value', 'amount')
    const weightIdx = findCol(headers, 'weight', 'allocation', 'percent', '%')
    const qtyIdx = findCol(headers, 'quantity', 'shares', 'position', 'qty')
    const priceIdx = findCol(headers, 'price', 'close price', 'mark price', 'current price')
    const curIdx = findCol(headers, 'currency')
    const descIdx = findCol(headers, 'description', 'name', 'security name')

    for (const row of rows) {
      const rawSym = symIdx >= 0 ? (row[symIdx] || '').trim() : ''
      if (!rawSym) continue
      const symbol = rawSym.toUpperCase()

      // Skip total/subtotal rows
      const lower = symbol.toLowerCase()
      if (lower === 'total' || lower === 'subtotal' || lower === 'grand total' || lower.includes('total')) continue

      const value = parseNum(valueIdx >= 0 ? row[valueIdx] : 0)
      const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'

      if (value === 0 && qty === 0 && price === 0) continue

      positions.push({
        symbol,
        name: descIdx >= 0 ? (row[descIdx] || '').trim() || symbol : symbol,
        type: mapAssetCategory(catIdx >= 0 ? (row[catIdx] || '').trim() : ''),
        quantity: qty || (price > 0 ? Math.abs(value / price) : 1),
        purchasePrice: price || Math.abs(value / (qty || 1)),
        currentPrice: price || Math.abs(value / (qty || 1)),
        currency,
        institution: 'Interactive Brokers',
        isDebt: value < 0,
        _source: 'ibkr',
        _weight: parseNum(weightIdx >= 0 ? row[weightIdx] : 0),
      })
    }
  }

  // Dividends — extract dividend transactions
  const divSection = sections['Dividends'] || sections['Dividend Income'] || sections['Income']
  if (divSection) {
    const { headers, rows } = divSection
    const symIdx = findCol(headers, 'symbol', 'ticker', 'financial instrument', 'instrument', 'security')
    const dateIdx = findCol(headers, 'pay date', 'date', 'ex-date', 'ex date', 'payment date')
    const amtIdx = findCol(headers, 'amount', 'total', 'net amount', 'gross amount', 'value', 'income')
    const descIdx = findCol(headers, 'description', 'name', 'security name')
    const curIdx = findCol(headers, 'currency')
    const perShareIdx = findCol(headers, 'per share', 'dividend per share', 'rate', 'div/share')

    for (const row of rows) {
      const rawSym = symIdx >= 0 ? (row[symIdx] || '').trim() : ''
      if (!rawSym) continue
      const symbol = rawSym.toUpperCase()

      const lower = symbol.toLowerCase()
      if (lower === 'total' || lower === 'subtotal' || lower.includes('total')) continue

      const amount = parseNum(amtIdx >= 0 ? row[amtIdx] : 0)
      if (amount === 0) continue

      const dateStr = dateIdx >= 0 ? (row[dateIdx] || '').trim() : ''
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'
      const desc = descIdx >= 0 ? (row[descIdx] || '').trim() : ''
      const perShare = parseNum(perShareIdx >= 0 ? row[perShareIdx] : 0)

      trades.push({
        type: 'DIVIDEND',
        symbol,
        description: desc || `${symbol} — Dividend`,
        date: parseDate(dateStr) || new Date().toISOString().split('T')[0],
        quantity: perShare > 0 ? Math.abs(amount / perShare) : 0,
        pricePerUnit: perShare || Math.abs(amount),
        totalAmount: Math.abs(amount),
        commission: 0,
        currency,
        _source: 'ibkr',
      })
    }
  }

  // Benchmark Historical Returns — extract performance comparison
  const benchSection = sections['Benchmark Historical Returns'] || sections['Historical Returns'] ||
    sections['Benchmark Comparison'] || sections['Performance'] || sections['Returns']
  if (benchSection) {
    const { headers, rows } = benchSection
    const nameIdx = findCol(headers, 'name', 'benchmark', 'index', 'portfolio')
    const mtdIdx = findCol(headers, 'mtd', 'month to date', 'monthly')
    const qtdIdx = findCol(headers, 'qtd', 'quarter to date', 'quarterly')
    const ytdIdx = findCol(headers, 'ytd', 'year to date', 'annual')
    const siIdx = findCol(headers, 'since inception', 'cumulative', 'total', 'inception')

    for (const row of rows) {
      const name = nameIdx >= 0 ? (row[nameIdx] || '').trim() : ''
      if (!name) continue
      benchmarks.push({
        name,
        mtd: parseNum(mtdIdx >= 0 ? row[mtdIdx] : 0),
        qtd: parseNum(qtdIdx >= 0 ? row[qtdIdx] : 0),
        ytd: parseNum(ytdIdx >= 0 ? row[ytdIdx] : 0),
        sinceInception: parseNum(siIdx >= 0 ? row[siIdx] : 0),
      })
    }
  }

  // Concentration — might have individual holdings with weights
  const concSection = sections['Concentration'] || sections['Top Holdings'] || sections['Top Positions']
  if (concSection && positions.length === 0) {
    const { headers, rows } = concSection
    const symIdx = findCol(headers, 'symbol', 'ticker', 'financial instrument', 'instrument', 'name', 'security')
    const valueIdx = findCol(headers, 'market value', 'value', 'amount')
    const weightIdx = findCol(headers, 'weight', 'allocation', 'percent', '%')
    const qtyIdx = findCol(headers, 'quantity', 'shares', 'position')
    const priceIdx = findCol(headers, 'price', 'close price')
    const curIdx = findCol(headers, 'currency')

    for (const row of rows) {
      const rawSym = symIdx >= 0 ? (row[symIdx] || '').trim() : ''
      if (!rawSym) continue
      const symbol = rawSym.toUpperCase()
      const lower = symbol.toLowerCase()
      if (lower === 'total' || lower === 'subtotal' || lower.includes('total')) continue

      const value = parseNum(valueIdx >= 0 ? row[valueIdx] : 0)
      const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      if (value === 0 && qty === 0) continue

      positions.push({
        symbol,
        name: symbol,
        type: 'Stock',
        quantity: qty || (price > 0 ? Math.abs(value / price) : 1),
        purchasePrice: price || Math.abs(value / (qty || 1)),
        currentPrice: price || Math.abs(value / (qty || 1)),
        currency: curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD',
        institution: 'Interactive Brokers',
        isDebt: value < 0,
        _source: 'ibkr',
        _weight: parseNum(weightIdx >= 0 ? row[weightIdx] : 0),
      })
    }
  }

  return { positions, trades, cashPositions, equityHistory, benchmarks }
}

function extractKeyStatistics(stats, equityHistory) {
  const today = new Date().toISOString().split('T')[0]

  // Look for NAV/value fields (case-insensitive key matching)
  const normalized = {}
  for (const [k, v] of Object.entries(stats)) {
    normalized[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v
  }

  const endingNAV = parseNum(
    normalized['endingnav'] || normalized['endingvalue'] || normalized['endingnetassetvalue'] ||
    normalized['endvalue'] || normalized['closingvalue'] || normalized['nav'] || 0
  )
  const beginningNAV = parseNum(
    normalized['beginningnav'] || normalized['beginningvalue'] || normalized['startingvalue'] ||
    normalized['openingvalue'] || normalized['startvalue'] || 0
  )

  if (endingNAV > 0) {
    equityHistory.push({ date: today, netWorthUSD: endingNAV, totalActivosUSD: endingNAV, _source: 'ibkr' })
  }
  if (beginningNAV > 0) {
    equityHistory.unshift({ date: today, netWorthUSD: beginningNAV, totalActivosUSD: beginningNAV, _source: 'ibkr', _type: 'beginning' })
  }
}

export function parseIBKRFile(textOrData, headers) {
  if (typeof textOrData === 'string') {
    if (/,Header,/.test(textOrData) || /,Data,/.test(textOrData)) {
      const sections = parseSectionedCSV(textOrData)

      // Try both Activity Statement and Portfolio Analyst sections
      const activity = parseActivityStatementSections(sections)
      const pa = parsePortfolioAnalystSections(sections)

      return {
        positions: [...activity.positions, ...pa.positions],
        trades: [...activity.trades, ...pa.trades],
        cashPositions: [...activity.cashPositions, ...pa.cashPositions],
        equityHistory: [...activity.equityHistory, ...pa.equityHistory],
        benchmarks: pa.benchmarks || [],
      }
    }
    const lines = textOrData.split(/\r?\n/).filter(l => l.trim())
    const hdrs = parseCSVLine(lines[0])
    const rows = lines.slice(1).map(l => parseCSVLine(l))
    return parseFlatCSV(rows, hdrs)
  }

  if (Array.isArray(textOrData) && Array.isArray(headers)) {
    return parseFlatCSV(textOrData, headers)
  }

  return { positions: [], trades: [], cashPositions: [], equityHistory: [] }
}

function parseFlatCSV(rows, headers) {
  const positions = []
  const symIdx = findCol(headers, 'symbol', 'ticker')
  const descIdx = findCol(headers, 'description', 'financial instrument', 'name', 'instrument')
  const qtyIdx = findCol(headers, 'quantity', 'position', 'shares', 'qty')
  const costIdx = findCol(headers, 'cost price', 'cost basis', 'avg cost', 'purchase price', 'cost basis price')
  const priceIdx = findCol(headers, 'close price', 'mark price', 'market price', 'current price', 'price', 'mark-to-market')
  const valueIdx = findCol(headers, 'market value', 'value', 'position value')
  const curIdx = findCol(headers, 'currency')
  const catIdx = findCol(headers, 'asset category', 'asset class', 'type', 'category')

  for (const row of rows) {
    const symbol = symIdx >= 0 ? (row[symIdx] || '').toString().trim().toUpperCase() : ''
    if (!symbol) continue

    const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
    if (qty === 0) continue

    positions.push({
      symbol,
      name: descIdx >= 0 ? (row[descIdx] || '').toString().trim() || symbol : symbol,
      type: mapAssetCategory(catIdx >= 0 ? (row[catIdx] || '').toString().trim() : ''),
      quantity: Math.abs(qty),
      purchasePrice: parseNum(costIdx >= 0 ? row[costIdx] : 0),
      currentPrice: parseNum(priceIdx >= 0 ? row[priceIdx] : 0),
      currency: curIdx >= 0 ? (row[curIdx] || 'USD').toString().trim() : 'USD',
      institution: 'Interactive Brokers',
      isDebt: qty < 0,
      _source: 'ibkr',
    })
  }

  return { positions, trades: [], cashPositions: [], equityHistory: [] }
}

export function formatIBKRFileResult(parsed) {
  const allPositions = [...parsed.positions, ...parsed.cashPositions]

  const items = allPositions
    .filter(p => p.quantity !== 0)
    .map(p => ({
      symbol: p.symbol,
      name: p.name,
      type: p.type,
      quantity: p.quantity,
      purchasePrice: p.purchasePrice,
      currentPrice: p.currentPrice,
      institution: p.institution,
      currency: p.currency,
      isDebt: p.isDebt,
      _source: 'ibkr',
    }))

  return {
    items,
    transactions: parsed.trades,
    equityHistory: parsed.equityHistory,
    benchmarks: parsed.benchmarks || [],
    accounts: [],
    syncedAt: new Date().toISOString(),
  }
}
