// Monthly income/expense engine for the finances tab: month completeness,
// group-level totals with month-over-month and year-over-year deltas, and
// actionable textual insights. Pure module (no React/Firestore) — callers pass
// financeTransactions and a convert(amount, from, to) helper.
//
// Date handling: transactions carry 'YYYY-MM-DD' strings; we compare string
// prefixes (never new Date()) so UTC-6 users don't see transactions shift
// months — same convention as app/finances/page.jsx.

import { groupOfCategory, EXPENSE_GROUPS, OTHER_GROUP } from '@/lib/financeCategories'

export const FINANCE_CURRENCY = 'GTQ'

export function monthKeyOf(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function txAmount(tx, convert, to = FINANCE_CURRENCY) {
  const amt = Number(tx.amount) || 0
  const cur = tx.currency || FINANCE_CURRENCY
  if (cur === to || typeof convert !== 'function') return amt
  const out = convert(amt, cur, to)
  return isFinite(out) ? out : amt
}

function txsOfMonth(transactions, key) {
  return (transactions || []).filter((tx) => typeof tx.date === 'string' && tx.date.startsWith(key))
}

// 'empty' | 'partial' | 'complete' — a month is unfilled when nothing was
// recorded; partial when income OR expenses are missing entirely.
export function getMonthStatus(transactions, key) {
  const txs = txsOfMonth(transactions, key)
  if (txs.length === 0) return 'empty'
  const hasIncome = txs.some((t) => t.type === 'INCOME')
  const hasExpense = txs.some((t) => t.type === 'EXPENSE')
  return hasIncome && hasExpense ? 'complete' : 'partial'
}

function summarizeMonth(transactions, key, convert) {
  const txs = txsOfMonth(transactions, key)
  let income = 0
  let expenses = 0
  const byGroup = {}
  let hormigaCount = 0
  let hormigaSum = 0
  for (const tx of txs) {
    const amt = txAmount(tx, convert)
    if (tx.type === 'INCOME') income += amt
    else if (tx.type === 'EXPENSE') {
      expenses += amt
      const g = groupOfCategory(tx.category)
      byGroup[g.key] = (byGroup[g.key] || 0) + amt
      // "Gastos hormiga": small unplanned spends that add up silently.
      if (amt > 0 && amt < 75) { hormigaCount += 1; hormigaSum += amt }
    }
  }
  return { income, expenses, savings: income - expenses, byGroup, txCount: txs.length, hormigaCount, hormigaSum }
}

function pctDelta(current, previous) {
  if (previous == null || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

// The full month view: totals + per-group breakdown with deltas vs previous
// month and vs the same month last year (null when there's no data to compare).
// `extras` folds read-only investment income (portfolio dividends) into each
// month's income/savings so the analysis and the summary cards tell the same
// story — a dividends-only month must not read as "you overspent".
export function computeMonthlyAnalysis(transactions, { month, year }, convert, extras = {}) {
  const { extraIncome = 0, prevExtraIncome = 0, yoyExtraIncome = 0 } = extras
  const key = monthKeyOf(year, month)
  const prevKey = month === 0 ? monthKeyOf(year - 1, 11) : monthKeyOf(year, month - 1)
  const yoyKey = monthKeyOf(year - 1, month)

  const withExtra = (s, x) => (x > 0 ? { ...s, income: s.income + x, savings: s.income + x - s.expenses } : s)
  const current = withExtra(summarizeMonth(transactions, key, convert), extraIncome)
  const prevSummary = withExtra(summarizeMonth(transactions, prevKey, convert), prevExtraIncome)
  const yoySummary = withExtra(summarizeMonth(transactions, yoyKey, convert), yoyExtraIncome)
  const hasPrev = prevSummary.txCount > 0
  const hasYoY = yoySummary.txCount > 0

  const groups = [...EXPENSE_GROUPS, OTHER_GROUP].map((g) => {
    const cur = current.byGroup[g.key] || 0
    const prev = hasPrev ? (prevSummary.byGroup[g.key] || 0) : null
    const yoy = hasYoY ? (yoySummary.byGroup[g.key] || 0) : null
    return {
      key: g.key, label: g.label, labelEn: g.labelEn, icon: g.icon, color: g.color,
      amount: cur,
      prevAmount: prev,
      yoyAmount: yoy,
      momPct: hasPrev ? pctDelta(cur, prev) : null,
      yoyPct: hasYoY ? pctDelta(cur, yoy) : null,
      pctOfExpenses: current.expenses > 0 ? (cur / current.expenses) * 100 : 0,
    }
  }).filter((g) => g.amount > 0 || (g.prevAmount || 0) > 0 || (g.yoyAmount || 0) > 0)

  return {
    key,
    status: getMonthStatus(transactions, key),
    income: current.income,
    expenses: current.expenses,
    savings: current.savings,
    savingsRate: current.income > 0 ? (current.savings / current.income) * 100 : null,
    txCount: current.txCount,
    hormigaCount: current.hormigaCount,
    hormigaSum: current.hormigaSum,
    groups,
    prev: hasPrev ? { key: prevKey, income: prevSummary.income, expenses: prevSummary.expenses, savings: prevSummary.savings } : null,
    yoy: hasYoY ? { key: yoyKey, income: yoySummary.income, expenses: yoySummary.expenses, savings: yoySummary.savings } : null,
    momExpensesPct: hasPrev ? pctDelta(current.expenses, prevSummary.expenses) : null,
    momIncomePct: hasPrev ? pctDelta(current.income, prevSummary.income) : null,
    yoyExpensesPct: hasYoY ? pctDelta(current.expenses, yoySummary.expenses) : null,
  }
}

// The sign goes OUTSIDE the currency mark: `Q${-1234}` reads "Q-1,234".
const fmtQ = (n) => {
  const v = Math.round(n) || 0
  return `${v < 0 ? '-' : ''}Q${Math.abs(v).toLocaleString()}`
}

// Actionable, plain-language insights out of the analysis. Ordered by impact;
// callers slice to taste.
export function buildFinanceInsights(analysis, lang = 'es') {
  const t = (es, en) => (lang === 'es' ? es : en)
  const out = []
  if (!analysis || analysis.txCount === 0) return out

  // Biggest group movement vs last month
  const movers = analysis.groups
    .filter((g) => g.momPct != null && Math.abs(g.momPct) >= 15 && (g.amount >= 200 || (g.prevAmount || 0) >= 200))
    .sort((a, b) => Math.abs(b.momPct) - Math.abs(a.momPct))
  for (const g of movers.slice(0, 2)) {
    const dir = g.momPct >= 0 ? t('subió', 'went up') : t('bajó', 'went down')
    out.push({
      severity: g.momPct >= 0 ? 'warn' : 'good',
      textEs: `${g.icon} ${g.label} ${dir} ${Math.abs(g.momPct).toFixed(0)}% vs el mes pasado (${fmtQ(g.prevAmount)} → ${fmtQ(g.amount)}).`,
      textEn: `${g.icon} ${g.labelEn} ${dir} ${Math.abs(g.momPct).toFixed(0)}% vs last month (${fmtQ(g.prevAmount)} → ${fmtQ(g.amount)}).`,
    })
  }

  // Year-over-year expenses
  if (analysis.yoyExpensesPct != null && Math.abs(analysis.yoyExpensesPct) >= 10) {
    const dir = analysis.yoyExpensesPct >= 0 ? t('más', 'more') : t('menos', 'less')
    out.push({
      severity: analysis.yoyExpensesPct >= 0 ? 'warn' : 'good',
      textEs: `Gastas ${Math.abs(analysis.yoyExpensesPct).toFixed(0)}% ${dir} que en ${analysis.yoy.key} (${fmtQ(analysis.yoy.expenses)} → ${fmtQ(analysis.expenses)}).`,
      textEn: `You spend ${Math.abs(analysis.yoyExpensesPct).toFixed(0)}% ${dir} than in ${analysis.yoy.key} (${fmtQ(analysis.yoy.expenses)} → ${fmtQ(analysis.expenses)}).`,
    })
  }

  // Savings rate
  if (analysis.savingsRate != null) {
    if (analysis.savingsRate < 0) {
      out.push({
        severity: 'warn',
        textEs: `Este mes gastaste ${fmtQ(-analysis.savings)} más de lo que ingresó.`,
        textEn: `This month you spent ${fmtQ(-analysis.savings)} more than you earned.`,
      })
    } else if (analysis.savingsRate >= 25) {
      out.push({
        severity: 'good',
        textEs: `Tasa de ahorro del ${analysis.savingsRate.toFixed(0)}%: sólida.`,
        textEn: `Savings rate of ${analysis.savingsRate.toFixed(0)}%: solid.`,
      })
    }
  }

  // Ant expenses
  if (analysis.hormigaCount >= 10 && analysis.expenses > 0 && analysis.hormigaSum / analysis.expenses >= 0.08) {
    out.push({
      severity: 'info',
      textEs: `${analysis.hormigaCount} gastos hormiga (< Q75) suman ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% del gasto del mes.`,
      textEn: `${analysis.hormigaCount} small spends (< Q75) add up to ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% of the month.`,
    })
  }

  // Concentration: one group dominating
  const top = [...analysis.groups].sort((a, b) => b.amount - a.amount)[0]
  if (top && top.pctOfExpenses >= 45 && analysis.expenses > 0) {
    out.push({
      severity: 'info',
      textEs: `${top.icon} ${top.label} se lleva el ${top.pctOfExpenses.toFixed(0)}% de tus gastos del mes.`,
      textEn: `${top.icon} ${top.labelEn} takes ${top.pctOfExpenses.toFixed(0)}% of this month's spending.`,
    })
  }

  return out
}

// Investment income of the month, READ-ONLY from portfolio DIVIDEND
// transactions (cash only — reinvested payments never hit the user's pocket).
// Same aggregation as the dashboard's DividendIncome card, converted to GTQ.
export function investmentIncomeOfMonth(portfolioTransactions, { month, year }, convert) {
  const key = monthKeyOf(year, month)
  let total = 0
  let count = 0
  for (const tx of portfolioTransactions || []) {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND' || tx._reinvested) continue
    if (typeof tx.date !== 'string' || !tx.date.startsWith(key)) continue
    const amt = Number(tx.totalAmount ?? tx.amount) || 0
    if (!(amt > 0)) continue
    total += txAmount({ amount: amt, currency: tx.currency || 'USD' }, convert)
    count += 1
  }
  return { total, count }
}
