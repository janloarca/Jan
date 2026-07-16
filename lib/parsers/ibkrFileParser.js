function sanitize(val) {
  if (typeof val !== 'string') return val
  return val.replace(/^[\t\r\n=+\-@|]+/, '').trim()
}

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
  let out
  if (/^\d{8}$/.test(s)) out = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  else if (/^\d{6}$/.test(s)) out = `${s.slice(0, 4)}-${s.slice(4, 6)}-01`
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) out = s.slice(0, 10)
  else if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) out = s.slice(0, 10).replace(/\//g, '-')
  else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [m, d, y] = s.split('/')
    out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  } else if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) {
    const [m, d, y] = s.split('/')
    const fullYear = parseInt(y) < 50 ? `20${y}` : `19${y}`
    out = `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  } else {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      // Anchor to the UTC calendar date to avoid local-vs-UTC off-by-one drift downstream.
      out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().split('T')[0]
    }
  }
  if (!out) return undefined
  // Reject implausible years: a 6-digit id misread as YYYYMM (→ e.g. 1982),
  // epoch noise, or a far-future date. These corrupt the chart's start.
  const year = parseInt(out.slice(0, 4), 10)
  if (year < 1990 || year > new Date().getFullYear() + 1) return undefined
  return out
}

function findCol(headers, ...patterns) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  for (const p of patterns) {
    const idx = lower.findIndex(h => h === p || h.includes(p))
    if (idx !== -1) return idx
  }
  const noSpace = lower.map(h => h.replace(/\s+/g, ''))
  for (const p of patterns) {
    const pClean = p.replace(/\s+/g, '')
    const idx = noSpace.findIndex(h => h === pClean || h.includes(pClean))
    if (idx !== -1) return idx
  }
  return -1
}

function findSection(sections, ...names) {
  for (const name of names) {
    if (sections[name]) return sections[name]
  }
  const keys = Object.keys(sections)
  for (const name of names) {
    const lower = name.toLowerCase()
    for (const key of keys) {
      const keyLower = key.toLowerCase()
      if (keyLower.startsWith(lower) || lower.startsWith(keyLower)) {
        return sections[key]
      }
    }
  }
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const name of names) {
    const normName = norm(name)
    for (const key of keys) {
      const normKey = norm(key)
      if (normKey.startsWith(normName) || normName.startsWith(normKey)) {
        return sections[key]
      }
    }
  }
  return null
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
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
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

export function isIBKRSectionedFormat(text) {
  return typeof text === 'string' && (/,Header,/m.test(text) || /,Data,/m.test(text))
}

export function detectIBKRFile(textOrHeaders) {
  const text = Array.isArray(textOrHeaders) ? textOrHeaders.join(',') : textOrHeaders
  const lower = text.toLowerCase()
  if (isIBKRPerformanceReport(text)) return false
  return (
    (lower.includes('interactive brokers') && (lower.includes('open pos') || lower.includes('trades') || lower.includes('statement'))) ||
    (lower.includes('ibkr') && lower.includes('header') && lower.includes('data')) ||
    (/statement,header/i.test(text) && /open pos/i.test(text)) ||
    (lower.includes('open pos') && lower.includes('header') && lower.includes('closeprice'))
  )
}

export function isIBKRPerformanceReport(text) {
  const lower = (typeof text === 'string' ? text : '').toLowerCase()
  const hasPA = lower.includes('portfolio analyst')
  const hasBenchmark = lower.includes('benchmark') && lower.includes('cumulative')
  const hasKeyStats = lower.includes('key stat') && lower.includes('beginningnav')
  const hasPositions = lower.includes('open position') && (lower.includes('symbol') || lower.includes('quantity') || lower.includes('header'))
  const hasAllocByInstrument = lower.includes('allocation by financial instrument')
  const hasPerfBySymbol = lower.includes('performance by symbol')
  if (hasPositions || hasAllocByInstrument || hasPerfBySymbol) return false
  if (hasPA || hasBenchmark || hasKeyStats) return true
  return false
}

function parseActivityStatementSections(sections) {
  const positions = []
  const trades = []
  const cashPositions = []
  const equityHistory = []

  const openPosKey = Object.keys(sections).find(k => /^open pos/i.test(k))
  if (openPosKey) {
    const { headers, rows } = sections[openPosKey]
    const symIdx = findCol(headers, 'symbol')
    const descIdx = findCol(headers, 'description')
    const catIdx = findCol(headers, 'asset category')
    const qtyIdx = findCol(headers, 'quantity', 'position')
    const costIdx = findCol(headers, 'cost price', 'cost basis price', 'avg cost', 'cost basis', 'cost')
    const priceIdx = findCol(headers, 'close price', 'mark price', 'mark-to-market', 'current price')
    const valueIdx = findCol(headers, 'value', 'market value')
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
      const rawCost = parseNum(costIdx >= 0 ? row[costIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'
      const costPerShare = (rawCost !== 0 && qty !== 0 && Math.abs(rawCost) > Math.abs(price) * Math.abs(qty) * 0.5) ? Math.abs(rawCost / qty) : rawCost

      positions.push({
        symbol,
        name: descIdx >= 0 ? (row[descIdx] || '').trim() || symbol : symbol,
        type: mapAssetCategory(cat),
        quantity: Math.abs(qty),
        purchasePrice: costPerShare || price,
        currentPrice: price || costPerShare,
        currency,
        institution: 'Interactive Brokers',
        isDebt: qty < 0,
        _source: 'ibkr',
      })
    }
  }

  const tradesKey = Object.keys(sections).find(k => /^trade/i.test(k) && !/summary/i.test(k)) || Object.keys(sections).find(k => /^trade/i.test(k))
  if (tradesKey) {
    const section = sections[tradesKey]
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
        description: `${descIdx >= 0 ? sanitize((row[descIdx] || '').trim()) : symbol} — ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(qty)} @ ${price}`,
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

  const depKey = Object.keys(sections).find(k => /^deposit/i.test(k))
  if (depKey) {
    const { headers, rows } = sections[depKey]
    const dateIdx = findCol(headers, 'date')
    const typeIdx = findCol(headers, 'type')
    const descIdx = findCol(headers, 'description')
    const amtIdx = findCol(headers, 'amount')
    const curIdx = findCol(headers, 'currency')

    for (const row of rows) {
      const rawType = typeIdx >= 0 ? (row[typeIdx] || '').trim().toUpperCase() : ''
      const amount = parseNum(amtIdx >= 0 ? row[amtIdx] : 0)
      if (amount === 0) continue

      let txType
      if (rawType === 'DEPOSIT') txType = 'DEPOSIT'
      else if (rawType === 'WITHDRAWAL') txType = 'WITHDRAWAL'
      else if (amount > 0) txType = 'DEPOSIT'
      else if (amount < 0) txType = 'WITHDRAWAL'
      else continue

      const dateStr = dateIdx >= 0 ? (row[dateIdx] || '').trim() : ''
      const desc = descIdx >= 0 ? sanitize((row[descIdx] || '').trim()) : ''
      const curr = curIdx >= 0 ? (row[curIdx] || '').trim().toUpperCase() : ''

      trades.push({
        type: txType,
        symbol: 'CASH',
        description: desc || (txType === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'),
        date: parseDate(dateStr) || new Date().toISOString().split('T')[0],
        quantity: 1,
        pricePerUnit: Math.abs(amount),
        totalAmount: Math.abs(amount),
        commission: 0,
        currency: curr || 'USD',
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

  // Open Positions (PA format: Symbol, Description, Sector, Quantity, ClosePrice, Value, Cost Basis)
  const openPosSection = findSection(sections, 'Open Positions', 'Open Position Summary')
  if (openPosSection) {
    const { headers, rows } = openPosSection
    const symIdx = findCol(headers, 'symbol', 'ticker')
    const descIdx = findCol(headers, 'description', 'financial instrument', 'name')
    const sectorIdx = findCol(headers, 'sector', 'asset class', 'asset category')
    const qtyIdx = findCol(headers, 'quantity', 'position', 'shares')
    const priceIdx = findCol(headers, 'close price', 'closeprice', 'price', 'mark price')
    const valueIdx = findCol(headers, 'value', 'market value')
    const costIdx = findCol(headers, 'cost basis', 'cost')
    const curIdx = findCol(headers, 'currency')

    for (const row of rows) {
      const symbol = symIdx >= 0 ? (row[symIdx] || '').trim().toUpperCase() : ''
      if (!symbol) continue
      const lower = symbol.toLowerCase()
      if (lower === 'total' || lower === 'subtotal' || lower.includes('total')) continue

      const qty = parseNum(qtyIdx >= 0 ? row[qtyIdx] : 0)
      const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
      const value = parseNum(valueIdx >= 0 ? row[valueIdx] : 0)
      const totalCost = parseNum(costIdx >= 0 ? row[costIdx] : 0)
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'
      const costPerShare = qty !== 0 ? Math.abs(totalCost / qty) : 0

      if (qty === 0 && value === 0) continue

      if (qty === 0 && value !== 0) {
        cashPositions.push({
          symbol: `CASH-${currency}`,
          name: `Cash (${currency})`,
          type: 'Bank',
          quantity: 1,
          purchasePrice: Math.abs(value),
          currentPrice: Math.abs(value),
          currency,
          institution: 'Interactive Brokers',
          isDebt: value < 0,
          _source: 'ibkr',
        })
        continue
      }

      positions.push({
        symbol,
        name: descIdx >= 0 ? (row[descIdx] || '').trim() || symbol : symbol,
        type: mapAssetCategory(sectorIdx >= 0 ? (row[sectorIdx] || '').trim() : ''),
        quantity: Math.abs(qty),
        purchasePrice: costPerShare || price,
        currentPrice: price || costPerShare,
        currency,
        institution: 'Interactive Brokers',
        isDebt: qty < 0 || value < 0,
        _source: 'ibkr',
      })
    }
  }

  // Key Statistics — extract NAV values
  const keyStatsSection = findSection(sections, 'Key Statistics')
  if (keyStatsSection) {
    const { headers, rows } = keyStatsSection
    const metricIdx = findCol(headers, 'metric', 'key', 'statistic', 'field', 'name')
    const valueIdx = findCol(headers, 'value', 'amount', 'result')

    if (metricIdx >= 0 && valueIdx >= 0) {
      const stats = {}
      for (const row of rows) {
        const key = (row[metricIdx] || '').trim()
        const val = (row[valueIdx] || '').trim()
        if (key) stats[key] = val
      }
      extractKeyStatistics(stats, equityHistory)
    } else {
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

  // Allocation — detect if it's equity history (Date+NAV) or position allocation (Symbol+Value)
  const allocSection = findSection(sections, 'Allocation by Asset Class', 'Allocation by Sector',
    'Allocation by Financial Instrument', 'Allocation', 'Positions', 'Holdings')
  if (allocSection) {
    const { headers, rows } = allocSection
    const dateIdx = findCol(headers, 'date')
    const navIdx = findCol(headers, 'nav', 'net asset value')
    const symIdx = findCol(headers, 'symbol', 'ticker', 'financial instrument', 'instrument', 'security')

    if (dateIdx >= 0 && navIdx >= 0 && symIdx < 0) {
      // Monthly NAV equity history (PA "Allocation" section with YYYYMM dates)
      for (const row of rows) {
        const rawDate = (row[dateIdx] || '').trim()
        const nav = parseNum(row[navIdx])
        if (!rawDate || nav === 0) continue
        const date = parseDate(rawDate)
        if (date) {
          equityHistory.push({ date, netWorthUSD: nav, totalActivosUSD: nav, _source: 'ibkr' })
        }
      }
    } else if (symIdx >= 0) {
      // Position allocation data
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
  }

  // Dividends — extract dividend transactions
  const divSection = findSection(sections, 'Dividends', 'Dividend Income', 'Income')
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
      const desc = descIdx >= 0 ? sanitize((row[descIdx] || '').trim()) : ''
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

  // Historical / Benchmark — monthly returns (Date, BenchmarkName1, BenchmarkName2, ...)
  const benchSection = findSection(sections, 'Benchmark Historical Returns', 'Historical Returns',
    'Benchmark Comparison', 'Historical', 'Performance', 'Returns')
  if (benchSection) {
    const { headers, rows } = benchSection
    const dateIdx = findCol(headers, 'date')

    if (dateIdx >= 0 && rows.length > 3) {
      // Monthly format: each column is a benchmark/account with monthly return values
      for (let i = 0; i < headers.length; i++) {
        if (i === dateIdx) continue
        const name = (headers[i] || '').trim()
        if (!name) continue

        const monthly = []
        for (const row of rows) {
          const rawDate = (row[dateIdx] || '').trim()
          const value = parseNum(row[i])
          const date = parseDate(rawDate)
          if (date) monthly.push({ date, return: value })
        }

        if (monthly.length > 0) {
          benchmarks.push({ name, monthly })
        }
      }
    } else {
      // Summary format: Name, MTD, QTD, YTD, Since Inception
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
  }

  // Concentration — individual holdings with weights (fallback if no positions from Open Pos)
  const concSection = findSection(sections, 'Concentration', 'Top Holdings', 'Top Positions')
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

  // Fee Summary
  const feeSection = findSection(sections, 'Fee Summary', 'Fee Sum', 'Fees')
  if (feeSection) {
    const { headers, rows } = feeSection
    const descIdx = findCol(headers, 'description', 'fee type', 'type', 'name')
    const amtIdx = findCol(headers, 'amount', 'total', 'fee', 'value')
    const dateIdx = findCol(headers, 'date', 'period')
    const curIdx = findCol(headers, 'currency')

    for (const row of rows) {
      const desc = descIdx >= 0 ? sanitize((row[descIdx] || '').trim()) : 'Fee'
      const amount = parseNum(amtIdx >= 0 ? row[amtIdx] : 0)
      if (amount === 0) continue
      const lower = desc.toLowerCase()
      if (lower === 'total' || lower === 'subtotal' || lower.includes('total')) continue

      const dateStr = dateIdx >= 0 ? (row[dateIdx] || '').trim() : ''
      const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'

      trades.push({
        type: 'FEE',
        symbol: 'FEE',
        description: desc,
        date: parseDate(dateStr) || new Date().toISOString().split('T')[0],
        quantity: 1,
        pricePerUnit: Math.abs(amount),
        totalAmount: Math.abs(amount),
        commission: 0,
        currency,
        _source: 'ibkr',
      })
    }
  }

  const SKIP_SECTIONS = new Set([
    'key statistics', 'cumulative performance', 'benchmark historical returns',
    'historical returns', 'benchmark comparison', 'performance', 'returns',
    'fee summary', 'fee sum', 'fees', 'introduction', 'account information',
    'statement', 'notes', 'codes',
  ])

  if (positions.length === 0) {
    for (const [sectionName, section] of Object.entries(sections)) {
      if (SKIP_SECTIONS.has(sectionName.toLowerCase())) continue
      const { headers, rows } = section
      if (!headers || !rows || rows.length === 0) continue
      const symIdx = findCol(headers, 'symbol', 'ticker')
      const qtyIdx = findCol(headers, 'quantity', 'shares', 'position')
      if (symIdx < 0 || qtyIdx < 0) continue

      const descIdx = findCol(headers, 'description', 'financial instrument', 'name')
      const sectorIdx = findCol(headers, 'sector', 'asset class', 'asset category')
      const priceIdx = findCol(headers, 'close price', 'closeprice', 'price', 'mark price')
      const valueIdx = findCol(headers, 'value', 'market value')
      const costIdx = findCol(headers, 'cost basis', 'cost')
      const curIdx = findCol(headers, 'currency')

      for (const row of rows) {
        const symbol = (row[symIdx] || '').trim().toUpperCase()
        if (!symbol) continue
        const lower = symbol.toLowerCase()
        if (lower === 'total' || lower === 'subtotal' || lower.includes('total')) continue

        const qty = parseNum(row[qtyIdx])
        const price = parseNum(priceIdx >= 0 ? row[priceIdx] : 0)
        const value = parseNum(valueIdx >= 0 ? row[valueIdx] : 0)
        const totalCost = parseNum(costIdx >= 0 ? row[costIdx] : 0)
        const currency = curIdx >= 0 ? (row[curIdx] || 'USD').trim() : 'USD'
        const costPerShare = qty !== 0 ? Math.abs(totalCost / qty) : 0

        if (qty === 0 && value === 0) continue

        if (qty === 0 && value !== 0) {
          cashPositions.push({
            symbol: `CASH-${currency}`, name: `Cash (${currency})`, type: 'Bank',
            quantity: 1, purchasePrice: Math.abs(value), currentPrice: Math.abs(value),
            currency, institution: 'Interactive Brokers', isDebt: value < 0, _source: 'ibkr',
          })
          continue
        }

        positions.push({
          symbol,
          name: descIdx >= 0 ? (row[descIdx] || '').trim() || symbol : symbol,
          type: mapAssetCategory(sectorIdx >= 0 ? (row[sectorIdx] || '').trim() : ''),
          quantity: Math.abs(qty), purchasePrice: costPerShare || price,
          currentPrice: price || costPerShare, currency,
          institution: 'Interactive Brokers', isDebt: qty < 0 || value < 0, _source: 'ibkr',
        })
      }
      if (positions.length > 0) break
    }
  }

  // Fallback: if only ≤1 NAV entry, scan ALL sections for Date+NAV columns
  if (equityHistory.length <= 1) {
    for (const [, section] of Object.entries(sections)) {
      const { headers, rows } = section
      if (!headers || !rows || rows.length < 3) continue
      const dateIdx = findCol(headers, 'date')
      const navIdx = findCol(headers, 'nav', 'net asset value')
      if (dateIdx < 0 || navIdx < 0) continue

      for (const row of rows) {
        const rawDate = (row[dateIdx] || '').trim()
        const nav = parseNum(row[navIdx])
        if (!rawDate || nav === 0) continue
        const date = parseDate(rawDate)
        if (date) equityHistory.push({ date, netWorthUSD: nav, totalActivosUSD: nav, _source: 'ibkr' })
      }
      if (equityHistory.length > 1) break
    }
  }

  // Prefer the REAL purchase date: the earliest BUY trade for each symbol. This
  // keeps historical share counts accurate (qtyAtMonth/qtyAtTime) instead of
  // collapsing every position to the import date and zeroing out past months.
  if (trades.length > 0 && positions.length > 0) {
    const earliestBuy = {}
    for (const tr of trades) {
      if (tr.type !== 'BUY' || !tr.date) continue
      const sym = (tr.symbol || '').toUpperCase()
      if (!sym) continue
      const t = new Date(tr.date).getTime()
      if (!Number.isFinite(t)) continue
      if (earliestBuy[sym] == null || t < earliestBuy[sym].t) earliestBuy[sym] = { t, date: tr.date }
    }
    for (const pos of positions) {
      const sym = (pos.symbol || '').toUpperCase()
      if (!pos.acquisitionDate && earliestBuy[sym]) pos.acquisitionDate = earliestBuy[sym].date
    }
  }

  // Set acquisitionDate on positions from the earliest equityHistory date.
  // Sort by time, not lexically, so a malformed date can't be picked as "earliest".
  if (equityHistory.length > 0 && positions.length > 0) {
    const earliest = equityHistory
      .map(e => e.date).filter(Boolean)
      .map(d => ({ d, t: new Date(d).getTime() }))
      .filter(x => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t)[0]?.d
    if (earliest) {
      for (const pos of positions) {
        if (!pos.acquisitionDate) pos.acquisitionDate = earliest
      }
    }
  }

  return { positions, trades, cashPositions, equityHistory, benchmarks }
}

function extractKeyStatistics(stats, equityHistory) {
  const today = new Date().toISOString().split('T')[0]

  const normalized = {}
  for (const [k, v] of Object.entries(stats)) {
    normalized[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v
  }

  const endingNAV = parseNum(
    normalized['endingnav'] || normalized['endingvalue'] || normalized['endingnetassetvalue'] ||
    normalized['endvalue'] || normalized['closingvalue'] || normalized['nav'] ||
    normalized['ending'] || normalized['endingna'] || 0
  )
  const beginningNAV = parseNum(
    normalized['beginningnav'] || normalized['beginningvalue'] || normalized['startingvalue'] ||
    normalized['openingvalue'] || normalized['startvalue'] || normalized['beginning'] || 0
  )

  // Only stamp the ending NAV at today. The beginning NAV has no real date
  // (stamping it at "today" too would collide with the ending entry on the same
  // date-keyed snapshot doc and clobber the real value).
  if (endingNAV > 0) {
    equityHistory.push({ date: today, netWorthUSD: endingNAV, totalActivosUSD: endingNAV, _source: 'ibkr' })
  }
}

export function parseIBKRFile(textOrData, headers) {
  if (typeof textOrData === 'string') {
    if (/,Header,/.test(textOrData) || /,Data,/.test(textOrData)) {
      const sections = parseSectionedCSV(textOrData)
      const sectionNames = Object.keys(sections)

      const activity = parseActivityStatementSections(sections)

      const hasOpenPositions = sectionNames.some(k => /^open pos/i.test(k))
      const hasTrades = sectionNames.some(k => /^trade/i.test(k))
      const hasAllocInstrument = sectionNames.some(k => /allocation by financial instrument/i.test(k))
      const hasPerfBySymbol = sectionNames.some(k => /performance by symbol/i.test(k))

      let pa = { positions: [], trades: [], cashPositions: [], equityHistory: [], benchmarks: [] }
      if (hasOpenPositions || hasTrades || hasAllocInstrument || hasPerfBySymbol || activity.positions.length > 0) {
        pa = parsePortfolioAnalystSections(sections)
      }

      const allPositions = [...activity.positions, ...pa.positions]
      const posMap = new Map()
      for (const p of allPositions) {
        const existing = posMap.get(p.symbol)
        if (!existing || (existing.purchasePrice === 0 && p.purchasePrice !== 0)) {
          posMap.set(p.symbol, p)
        }
      }
      const positions = [...posMap.values()]

      const allCash = [...activity.cashPositions, ...pa.cashPositions]
      const seenCash = new Set()
      const cashPositions = allCash.filter(p => {
        if (seenCash.has(p.symbol)) return false
        seenCash.add(p.symbol)
        return true
      })

      const isPerformanceReport = !hasOpenPositions && !hasTrades && !hasAllocInstrument && !hasPerfBySymbol && positions.length === 0

      // Dedupe equityHistory by date so colliding dates don't silently overwrite
      // each other once written to date-keyed Firestore snapshot docs. Real NAV
      // entries (no _type) beat 'beginning'/derived stubs for the same date.
      const mergedEquity = (() => {
        const byDate = new Map()
        for (const e of [...pa.equityHistory, ...activity.equityHistory]) {
          if (!e || !e.date) continue
          const prev = byDate.get(e.date)
          if (!prev || (prev._type === 'beginning' && !e._type)) byDate.set(e.date, e)
        }
        return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      })()

      return {
        positions,
        trades: [...activity.trades, ...pa.trades],
        cashPositions,
        equityHistory: mergedEquity,
        benchmarks: pa.benchmarks || [],
        _sectionNames: sectionNames,
        _isPerformanceReport: isPerformanceReport,
      }
    }
    const lines = textOrData.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
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
    .map(p => {
      const item = {
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
      }
      if (p.acquisitionDate) item.acquisitionDate = p.acquisitionDate
      if (p.conid) item.conid = p.conid
      if (p._ibkrAccountId) item._ibkrAccountId = p._ibkrAccountId
      return item
    })

  return {
    items,
    transactions: parsed.trades,
    equityHistory: parsed.equityHistory,
    benchmarks: parsed.benchmarks || [],
    accounts: [...new Set(allPositions.map(p => p._ibkrAccountId).filter(Boolean))],
    _sectionNames: parsed._sectionNames || [],
    syncedAt: new Date().toISOString(),
  }
}
