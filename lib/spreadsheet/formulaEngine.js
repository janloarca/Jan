const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function colToIndex(col) {
  let idx = 0
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64)
  }
  return idx - 1
}

function parseRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 }
}

function parseRange(range) {
  const [startRef, endRef] = range.split(':')
  const start = parseRef(startRef)
  const end = parseRef(endRef)
  if (!start || !end) return []
  const cells = []
  for (let r = start.row; r <= end.row; r++) {
    for (let c = start.col; c <= end.col; c++) {
      cells.push({ row: r, col: c })
    }
  }
  return cells
}

function getCellValue(rows, row, col) {
  if (!rows[row]) return 0
  const colLetter = COL_LETTERS[col] || COL_LETTERS[0]
  const raw = rows[row][colLetter]
  if (raw == null || raw === '') return 0
  const num = Number(raw)
  return isNaN(num) ? raw : num
}

function getRangeValues(rows, range) {
  const cells = parseRange(range)
  return cells.map(c => {
    const val = getCellValue(rows, c.row, c.col)
    return typeof val === 'number' ? val : 0
  })
}

const BUILTIN_FUNCTIONS = {
  SUM: (args) => args.reduce((s, v) => s + (Number(v) || 0), 0),
  AVG: (args) => args.length > 0 ? args.reduce((s, v) => s + (Number(v) || 0), 0) / args.length : 0,
  AVERAGE: (args) => BUILTIN_FUNCTIONS.AVG(args),
  MIN: (args) => args.length > 0 ? Math.min(...args.map(Number).filter(isFinite)) : 0,
  MAX: (args) => args.length > 0 ? Math.max(...args.map(Number).filter(isFinite)) : 0,
  COUNT: (args) => args.filter(v => v !== 0 && v !== '' && v != null).length,
  ABS: (args) => Math.abs(Number(args[0]) || 0),
  ROUND: (args) => {
    const val = Number(args[0]) || 0
    const decimals = Number(args[1]) || 0
    return Number(val.toFixed(decimals))
  },
  IF: (args) => args[0] ? args[1] : (args[2] ?? 0),
  CONCAT: (args) => args.join(''),
}

export function evaluateFormula(formula, rows, context, visited = new Set()) {
  if (!formula || typeof formula !== 'string') return formula
  const trimmed = formula.trim()
  if (!trimmed.startsWith('=')) return trimmed

  const expr = trimmed.slice(1).trim()

  // Context formulas (portfolio data)
  if (context) {
    const upper = expr.toUpperCase()

    if (upper === 'NETWORTH') return context.netWorth ?? 0
    if (upper === 'TOTAL_STOCKS') return context.totalStocks ?? 0
    if (upper === 'TOTAL_CRYPTO') return context.totalCrypto ?? 0
    if (upper === 'TOTAL_BONDS') return context.totalBonds ?? 0
    if (upper === 'TOTAL_CASH') return context.totalCash ?? 0
    if (upper === 'TOTAL_FUNDS') return context.totalFunds ?? 0
    if (upper === 'TOTAL_DEBT') return context.totalDebt ?? 0
    if (upper === 'INCOME_MONTHLY') return context.incomeMonthly ?? 0
    if (upper === 'EXPENSES_MONTHLY') return context.expensesMonthly ?? 0
    if (upper === 'SAVINGS_RATE') return context.savingsRate ?? 0
    if (upper === 'PORTFOLIO_RETURN') return context.portfolioReturn ?? 0
    if (upper === 'DIVIDEND_YIELD') return context.dividendYield ?? 0
    if (upper === 'NUM_POSITIONS') return context.numPositions ?? 0

    // =ITEM("AAPL").value / .qty / .price / .pct
    const itemMatch = expr.match(/^ITEM\s*\(\s*"([^"]+)"\s*\)\s*\.\s*(\w+)$/i)
    if (itemMatch) {
      const sym = itemMatch[1].toUpperCase()
      const prop = itemMatch[2].toLowerCase()
      const item = context.items?.find(it =>
        (it.symbol || '').toUpperCase() === sym || (it.name || '').toUpperCase() === sym
      )
      if (!item) return 0
      if (prop === 'value') return (item.quantity || 0) * (item.currentPrice || item.purchasePrice || 0)
      if (prop === 'qty' || prop === 'quantity') return item.quantity || 0
      if (prop === 'price') return item.currentPrice || item.purchasePrice || 0
      if (prop === 'cost') return item.purchasePrice || 0
      if (prop === 'pct') {
        const val = (item.quantity || 0) * (item.currentPrice || item.purchasePrice || 0)
        return context.netWorth > 0 ? (val / context.netWorth) * 100 : 0
      }
      return 0
    }
  }

  // Function calls: SUM(A1:A10), AVG(B1:B5), etc.
  const fnMatch = expr.match(/^(\w+)\s*\((.+)\)$/)
  if (fnMatch) {
    const fnName = fnMatch[1].toUpperCase()
    const argsStr = fnMatch[2].trim()
    const fn = BUILTIN_FUNCTIONS[fnName]
    if (fn) {
      // Check if arg is a range
      if (argsStr.match(/^[A-Z]+\d+:[A-Z]+\d+$/)) {
        const values = getRangeValues(rows, argsStr)
        return fn(values)
      }
      // Multiple args separated by comma
      const args = argsStr.split(',').map(a => {
        const trimA = a.trim()
        if (trimA.match(/^[A-Z]+\d+$/)) {
          const ref = parseRef(trimA)
          if (ref) return getCellValue(rows, ref.row, ref.col)
        }
        if (trimA.startsWith('"') && trimA.endsWith('"')) return trimA.slice(1, -1)
        const num = Number(trimA)
        return isNaN(num) ? trimA : num
      })
      return fn(args)
    }
  }

  // Cell reference: A1, B5, etc.
  const cellRef = parseRef(expr)
  if (cellRef) {
    const key = `${cellRef.row},${cellRef.col}`
    if (visited.has(key)) return '#REF!'
    visited.add(key)
    const raw = getCellValue(rows, cellRef.row, cellRef.col)
    if (typeof raw === 'string' && raw.startsWith('=')) {
      return evaluateFormula(raw, rows, context, visited)
    }
    return raw
  }

  // Simple arithmetic: number +/- number
  const arithMatch = expr.match(/^([A-Z]+\d+|\d+(?:\.\d+)?)\s*([+\-*/])\s*([A-Z]+\d+|\d+(?:\.\d+)?)$/)
  if (arithMatch) {
    let left = arithMatch[1]
    const op = arithMatch[2]
    let right = arithMatch[3]

    const leftRef = parseRef(left)
    if (leftRef) left = getCellValue(rows, leftRef.row, leftRef.col)
    else left = Number(left) || 0

    const rightRef = parseRef(right)
    if (rightRef) right = getCellValue(rows, rightRef.row, rightRef.col)
    else right = Number(right) || 0

    left = Number(left) || 0
    right = Number(right) || 0

    if (op === '+') return left + right
    if (op === '-') return left - right
    if (op === '*') return left * right
    if (op === '/') return right !== 0 ? left / right : '#DIV/0!'
  }

  // Plain number
  const num = Number(expr)
  if (!isNaN(num)) return num

  return expr
}

export function evaluateAllCells(rows, context) {
  return rows.map((row, rowIdx) => {
    const evaluated = {}
    for (const [col, val] of Object.entries(row || {})) {
      if (typeof val === 'string' && val.startsWith('=')) {
        evaluated[col] = evaluateFormula(val, rows, context)
      } else {
        evaluated[col] = val
      }
    }
    return evaluated
  })
}

export { COL_LETTERS, parseRef, parseRange }
