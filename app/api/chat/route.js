import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error: authError } = await verifyAuth(request)
  if (authError) return authError

  try {
    const { messages, portfolioContext, apiKey } = await request.json()

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 })
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 })
    }

    const systemPrompt = buildSystemPrompt(portfolioContext)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      if (response.status === 401) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
      }
      return NextResponse.json(
        { error: err.error?.message || 'Claude API error' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : ''

    return NextResponse.json({ message: text, usage: data.usage })
  } catch (err) {
    console.error('[api/chat]', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function buildSystemPrompt(ctx) {
  const lines = [
    'You are a financial advisor AI embedded in Chispudo, a personal portfolio tracking app.',
    'You have access to the user\'s real portfolio data below. Answer questions about their finances, suggest optimizations, estimate values, and provide actionable advice.',
    'Be concise and direct. Use numbers and percentages. Respond in the same language the user writes in (Spanish or English).',
    'When estimating credit card reward values, use these rates: Amex MR points ~$0.02/pt, Visa points ~$0.01/pt, Mastercard cashback is 1:1 USD, airline miles ~$0.012/mile.',
    'Never make up data the user hasn\'t provided. If you need more info, ask.',
    '',
  ]

  if (!ctx) return lines.join('\n')

  if (ctx.netWorth != null) lines.push(`Net worth: $${ctx.netWorth.toLocaleString()}`)
  if (ctx.totalAssets != null) lines.push(`Total assets: $${ctx.totalAssets.toLocaleString()}`)
  if (ctx.returnYTD != null) lines.push(`Return YTD: ${ctx.returnYTD.toFixed(2)}%`)
  if (ctx.annualDividends) lines.push(`Annual dividends: $${ctx.annualDividends.toLocaleString()}`)
  if (ctx.baseCurrency) lines.push(`Base currency: ${ctx.baseCurrency}`)

  if (ctx.items?.length > 0) {
    lines.push('', '## Portfolio Holdings')
    ctx.items.forEach(it => {
      const val = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
      const parts = [`${it.name || it.symbol}: $${Math.abs(val).toLocaleString(undefined, { maximumFractionDigits: 0 })}`]
      if (it.type) parts.push(`type=${it.type}`)
      if (it.currency && it.currency !== 'USD') parts.push(`cur=${it.currency}`)
      if (it.institution) parts.push(`at ${it.institution}`)
      if (it.isDebt) parts.push('(DEBT)')
      if (it.isReceivable) parts.push('(RECEIVABLE)')
      if (it.interestRate) parts.push(`rate=${it.interestRate}%`)
      if (it.debtTerm) parts.push(`term=${it.debtTerm}`)
      if (it.monthlyPayment) parts.push(`payment=$${it.monthlyPayment}/mo`)
      if (it.installmentsRemaining) parts.push(`${it.installmentsRemaining} pmts left`)
      if (it.rewardType) parts.push(`rewards=${it.rewardType}`)
      if (it.rewardBalance) parts.push(`reward_balance=${it.rewardBalance}`)
      if (it.cardBrand) parts.push(`card=${it.cardBrand}`)
      if (it.incomeRate) parts.push(`yield=${it.incomeRate}%`)
      if (it.maturityDate) parts.push(`matures=${it.maturityDate}`)
      lines.push(`- ${parts.join(' | ')}`)
    })
  }

  if (ctx.riskMetrics) {
    const rm = ctx.riskMetrics
    lines.push('', '## Risk Metrics')
    if (rm.volatility != null) lines.push(`Volatility: ${rm.volatility.toFixed(1)}%`)
    if (rm.sharpe != null) lines.push(`Sharpe ratio: ${rm.sharpe.toFixed(2)}`)
    if (rm.maxDrawdown != null) lines.push(`Max drawdown: ${rm.maxDrawdown.toFixed(1)}%`)
    if (rm.hhi != null) lines.push(`Concentration (HHI): ${rm.hhi.toFixed(0)}`)
  }

  return lines.join('\n')
}
