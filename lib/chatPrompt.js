// FASE RQ. El system prompt del asistente, fuera de app/api/chat/route.js
// porque un route.js del App Router solo admite exports que Next reconoce y
// así no se podía probar. Arma el prompt SOLO con los hechos que manda el
// cliente (lib/chatContext.js) y le prohíbe al modelo inventar los que faltan.

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)

function money(v, cur) {
  const n = num(v)
  if (n == null) return null
  return `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || 'USD'}`
}

function pct(v) {
  const n = num(v)
  if (n == null) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function sanitizeCtxString(val) {
  if (typeof val !== 'string') return val
  return val.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 200)
}

const UNKNOWN = 'NOT AVAILABLE in the app'

export function buildSystemPrompt(ctx) {
  const cur = sanitizeCtxString(ctx?.baseCurrency) || 'USD'
  const lines = [
    'You are a financial assistant embedded in Chispu, a personal portfolio tracking app.',
    'Respond in the same language the user writes in (Spanish or English). Be concise and direct.',
    '',
    '## Hard rules about data (follow them exactly)',
    '- The ONLY numbers you may state about the user\'s portfolio, benchmark, returns, dates, income or prices are the ones in the FACTS below. Copy them as written.',
    `- If a figure is not in the FACTS, or is marked "${UNKNOWN}", say plainly that the app does not have that data. Never estimate it, never use general market knowledge to fill it, never invent a date range.`,
    '- Never compute your own return, yield or dividend amount from quantities or rates: if the app does not give it, say so.',
    '- Use TODAY\'s date from the FACTS. "This year" / "YTD" means the current calendar year of that date, never a previous year.',
    '- Received income: say "received this year (YTD)" for the YTD figure and "received in the last 12 months" only for the trailing-12-month figure. Never call one by the other\'s name.',
    '- When comparing to the benchmark, name its period (YTD of the current year) and say it is a price return without dividends. Compare it against the portfolio TWR when the FACTS give one (that is what the dashboard Benchmark card does), never against the Modified Dietz YTD without saying so.',
    '- Formatting: plain sentences and short bullet lists. Do NOT use Markdown tables. Bold with **text** only; never leave a single asterisk.',
    '- You have tools to estimate credit-card rewards, analyze debt payoff, compare cards, update an item, and estimate a physical asset value. Tool results are estimates and must be labeled as such.',
    '',
    '## FACTS',
    `Today: ${sanitizeCtxString(ctx?.today) || UNKNOWN}`,
    `Base currency: ${cur}`,
  ]

  if (!ctx) {
    lines.push(`Portfolio data: ${UNKNOWN}`)
    return lines.join('\n')
  }

  lines.push(`Net worth: ${money(ctx.netWorth, cur) || UNKNOWN}`)
  lines.push(`Total assets: ${money(ctx.totalAssets, cur) || UNKNOWN}`)

  const y = ctx.ytd
  if (y && num(y.returnPct) != null) {
    const start = y.startDate ? `from ${sanitizeCtxString(y.startDate)}` : 'from the start of the year'
    lines.push(`Portfolio return YTD ${start} to ${sanitizeCtxString(ctx.today) || 'today'}: ${pct(y.returnPct)} (${sanitizeCtxString(y.method) || 'Modified Dietz'}).`)
    if (num(y.gain) != null) lines.push(`Portfolio gain YTD (net of deposits/withdrawals): ${money(y.gain, cur)}`)
    if (num(y.startValue) != null) lines.push(`Year start value: ${money(y.startValue, cur)} (${sanitizeCtxString(y.startKind) || 'estimated'})`)
  } else {
    lines.push(`Portfolio return YTD: ${UNKNOWN}`)
  }

  const s = ctx.sinceStart
  if (s && num(s.returnPct) != null) lines.push(`Portfolio return since start${s.startDate ? ` (${sanitizeCtxString(s.startDate)})` : ''}: ${pct(s.returnPct)}`)

  const b = ctx.benchmark
  if (b && num(b.ytdReturnPct) != null) {
    lines.push(`Benchmark ${sanitizeCtxString(b.name)} YTD (same period as the portfolio YTD): ${pct(b.ytdReturnPct)}, ${sanitizeCtxString(b.kind) || 'price return'}.`)
    // The Benchmark card compares the index against the portfolio's TWR, not
    // against the headline Modified Dietz YTD. Give the model the SAME gap the
    // card shows; the Dietz gap is only offered (labelled) when there is no TWR.
    const side = (d) => `${d >= 0 ? '+' : ''}${d.toFixed(2)} percentage points (${d >= 0 ? 'the portfolio is AHEAD' : 'the portfolio is BEHIND'})`
    if (num(b.portfolioTwrPct) != null) {
      lines.push(`Portfolio TWR YTD (time-weighted, ${sanitizeCtxString(b.twrScope) || 'all assets'}; the figure the dashboard's Benchmark card shows): ${pct(b.portfolioTwrPct)}.`)
      lines.push(`Portfolio TWR minus benchmark YTD (the gap the Benchmark card shows; use THIS one when comparing to the benchmark): ${side(b.portfolioTwrPct - b.ytdReturnPct)}.`)
      lines.push('The headline YTD above is Modified Dietz (money-weighted) and is a different metric from the TWR: do not subtract the benchmark from it. If you mention both, say which is which.')
    } else if (y && num(y.returnPct) != null) {
      lines.push(`Portfolio (Modified Dietz, money-weighted) minus benchmark YTD: ${side(y.returnPct - b.ytdReturnPct)}. This is NOT the time-weighted (TWR) comparison the Benchmark card shows; say so if you quote it.`)
    }
  } else {
    lines.push(`Benchmark return: ${UNKNOWN}`)
  }

  const inc = ctx.income || {}
  lines.push(`Income received this year (YTD, cash): ${money(inc.receivedYTD, cur) || UNKNOWN}`)
  lines.push(`Income received in the last 12 months (cash): ${money(inc.receivedTrailing12m, cur) || UNKNOWN}`)
  lines.push(`Estimated annual income going forward (projection): ${money(inc.estimatedAnnual, cur) || UNKNOWN}`)

  if (Array.isArray(ctx.items) && ctx.items.length > 0) {
    lines.push('', '## Holdings (values already in base currency)')
    ctx.items.slice(0, 200).forEach((it) => {
      const val = (Number(it.quantity) || 0) * (Number(it.currentPrice) || Number(it.purchasePrice) || 0)
      const name = sanitizeCtxString(it.name || it.symbol || 'Unknown')
      const parts = [`${name}${it.symbol && it.symbol !== it.name ? ` (${sanitizeCtxString(it.symbol)})` : ''}: value ${money(Math.abs(val), cur)}`]
      if (it.type) parts.push(`type=${sanitizeCtxString(it.type)}`)
      if (it.currency && it.currency !== cur) parts.push(`native currency=${sanitizeCtxString(it.currency)}`)
      if (it.institution) parts.push(`at ${sanitizeCtxString(it.institution)}`)
      if (it.isDebt) parts.push('(DEBT)')
      if (it.isReceivable) parts.push('(RECEIVABLE)')
      if (num(it.projectedAnnualIncome) != null) parts.push(`projected annual income=${money(it.projectedAnnualIncome, cur)}`)
      if (num(it.incomeReceivedYTD) != null) parts.push(`income received YTD=${money(it.incomeReceivedYTD, cur)}`)
      if (it.interestRate) parts.push(`rate=${it.interestRate}%`)
      if (it.debtTerm) parts.push(`term=${sanitizeCtxString(String(it.debtTerm))}`)
      if (it.monthlyPayment) parts.push(`payment=${it.monthlyPayment}/mo`)
      if (it.installmentsRemaining) parts.push(`${it.installmentsRemaining} pmts left`)
      if (it.rewardType) parts.push(`rewards=${sanitizeCtxString(it.rewardType)}`)
      if (it.rewardBalance) parts.push(`reward_balance=${it.rewardBalance}`)
      if (it.cardBrand) parts.push(`card=${sanitizeCtxString(it.cardBrand)}`)
      if (it.maturityDate) parts.push(`matures=${sanitizeCtxString(String(it.maturityDate))}`)
      lines.push(`- ${parts.join(' | ')}`)
    })
  }

  const rm = ctx.riskMetrics
  if (rm) {
    lines.push('', '## Risk metrics (computed by the app)')
    if (num(rm.volatility) != null) lines.push(`Annualized volatility: ${rm.volatility.toFixed(1)}%`)
    if (num(rm.sharpe) != null) lines.push(`Sharpe ratio: ${rm.sharpe.toFixed(2)}`)
    if (num(rm.beta) != null) lines.push(`Beta vs benchmark: ${rm.beta.toFixed(2)}`)
    if (num(rm.maxDrawdown) != null) lines.push(`Max drawdown: ${rm.maxDrawdown.toFixed(1)}%`)
  }

  return lines.join('\n')
}
