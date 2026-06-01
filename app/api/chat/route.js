import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const TOOLS = [
  {
    name: 'update_item',
    description: 'Update a portfolio item field (e.g. change quantity, price, notes). Use when the user asks you to modify an item.',
    input_schema: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: 'Name or symbol of the item to update' },
        fields: {
          type: 'object',
          description: 'Fields to update. Valid keys: quantity, currentPrice, notes, rewardBalance, installmentsRemaining, monthlyPayment',
        },
      },
      required: ['item_name', 'fields'],
    },
  },
  {
    name: 'estimate_rewards',
    description: 'Estimate the USD value of credit card rewards. Use when user asks about reward values.',
    input_schema: {
      type: 'object',
      properties: {
        card_brand: { type: 'string', enum: ['amex', 'visa', 'mastercard'] },
        reward_type: { type: 'string', enum: ['miles', 'cashback', 'points'] },
        balance: { type: 'number', description: 'Number of points/miles/cashback accumulated' },
      },
      required: ['reward_type', 'balance'],
    },
  },
  {
    name: 'debt_payoff_analysis',
    description: 'Analyze which debt to pay off first using avalanche or snowball method. Use when user asks about debt strategy.',
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['avalanche', 'snowball'], description: 'avalanche = highest interest first, snowball = smallest balance first' },
      },
      required: ['method'],
    },
  },
  {
    name: 'compare_cards',
    description: 'Compare user credit cards to find which gives the best rewards. Use when user asks which card to use, which card is better, or asks about reward optimization.',
    input_schema: {
      type: 'object',
      properties: {
        spending_category: {
          type: 'string',
          enum: ['travel', 'dining', 'groceries', 'gas', 'online', 'general'],
          description: 'Spending category to optimize for. Use "general" if no specific category.',
        },
        monthly_spend: { type: 'number', description: 'Estimated monthly spend in USD for this category (optional)' },
      },
      required: ['spending_category'],
    },
  },
  {
    name: 'estimate_asset_value',
    description: 'Estimate the current market value of a physical asset (real estate, vehicle, collectible). Use when user asks "how much is my X worth?" or asks to update the value of a property, car, etc. Provide your best estimate based on the information available.',
    input_schema: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: 'Name of the asset to value' },
        asset_type: { type: 'string', enum: ['real_estate', 'vehicle', 'collectible', 'other'], description: 'Type of physical asset' },
        estimated_value: { type: 'number', description: 'Your estimated current market value in USD' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Your confidence in the estimate' },
        reasoning: { type: 'string', description: 'Brief explanation of how you arrived at the estimate' },
      },
      required: ['item_name', 'asset_type', 'estimated_value', 'confidence', 'reasoning'],
    },
  },
]

const REWARD_VALUES = {
  amex: { miles: 0.02, points: 0.02, cashback: 1.0 },
  visa: { miles: 0.012, points: 0.01, cashback: 1.0 },
  mastercard: { miles: 0.012, points: 0.01, cashback: 1.0 },
}

const CATEGORY_MULTIPLIERS = {
  amex: { travel: 3, dining: 2, groceries: 2, gas: 1, online: 1.5, general: 1 },
  visa: { travel: 2, dining: 2, groceries: 1.5, gas: 2, online: 1.5, general: 1 },
  mastercard: { travel: 1.5, dining: 2, groceries: 2, gas: 1.5, online: 2, general: 1.5 },
}

function executeToolCall(tool, input, ctx) {
  if (tool === 'estimate_rewards') {
    const brand = input.card_brand || 'visa'
    const rate = REWARD_VALUES[brand]?.[input.reward_type] || 0.01
    const value = input.balance * rate
    return JSON.stringify({
      reward_type: input.reward_type,
      balance: input.balance,
      rate_per_unit: rate,
      estimated_usd: value.toFixed(2),
      brand,
    })
  }

  if (tool === 'update_item') {
    return JSON.stringify({
      action: 'update_item',
      item_name: input.item_name,
      fields: input.fields,
    })
  }

  if (tool === 'debt_payoff_analysis') {
    const debts = (ctx?.items || [])
      .filter(it => it.isDebt && !it.isReceivable)
      .map(it => ({
        name: it.name || it.symbol,
        balance: (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0),
        rate: it.interestRate || 0,
        payment: it.monthlyPayment || it.minimumPayment || 0,
      }))
      .filter(d => d.balance > 0)

    if (debts.length === 0) return JSON.stringify({ result: 'No debts found in portfolio' })

    const sorted = input.method === 'avalanche'
      ? debts.sort((a, b) => b.rate - a.rate)
      : debts.sort((a, b) => a.balance - b.balance)

    return JSON.stringify({
      method: input.method,
      order: sorted.map((d, i) => ({
        priority: i + 1,
        name: d.name,
        balance: d.balance,
        rate: d.rate,
        payment: d.payment,
      })),
    })
  }

  if (tool === 'estimate_asset_value') {
    return JSON.stringify({
      action: 'update_item',
      item_name: input.item_name,
      fields: { currentPrice: input.estimated_value, quantity: 1 },
      estimate: {
        asset_type: input.asset_type,
        estimated_value: input.estimated_value,
        confidence: input.confidence,
        reasoning: input.reasoning,
      },
    })
  }

  if (tool === 'compare_cards') {
    const cards = (ctx?.items || [])
      .filter(it => it.cardBrand && it.rewardType)
      .map(it => {
        const brand = it.cardBrand.toLowerCase()
        const rewardType = it.rewardType
        const baseRate = it.rewardRate || 1
        const categoryMult = CATEGORY_MULTIPLIERS[brand]?.[input.spending_category] || 1
        const effectiveRate = baseRate * categoryMult
        const rewardValue = REWARD_VALUES[brand]?.[rewardType] || 0.01
        const cashbackPerDollar = (effectiveRate / 100) * rewardValue
        const monthlyValue = input.monthly_spend ? (input.monthly_spend * cashbackPerDollar) : null
        return {
          name: it.name || it.symbol,
          brand,
          rewardType,
          baseRate,
          categoryMultiplier: categoryMult,
          effectiveRate,
          valuePerPoint: rewardValue,
          cashbackPerDollar: (cashbackPerDollar * 100).toFixed(3) + '%',
          monthlyRewardValue: monthlyValue ? `$${monthlyValue.toFixed(2)}` : null,
          currentBalance: it.rewardBalance || 0,
          currentBalanceValue: `$${((it.rewardBalance || 0) * rewardValue).toFixed(2)}`,
        }
      })

    if (cards.length === 0) return JSON.stringify({ result: 'No credit cards with reward info found in portfolio. Add cards with cardBrand and rewardType to compare.' })

    cards.sort((a, b) => parseFloat(b.cashbackPerDollar) - parseFloat(a.cashbackPerDollar))

    return JSON.stringify({
      category: input.spending_category,
      monthly_spend: input.monthly_spend || null,
      recommendation: cards[0].name,
      cards,
    })
  }

  return JSON.stringify({ error: 'Unknown tool' })
}

export async function POST(request) {
  const { limited } = rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { uid, error: authError } = await verifyAuth(request)
  if (authError) return authError

  try {
    const { messages, portfolioContext, apiKey, stream } = await request.json()

    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 })
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 })
    }

    const systemPrompt = buildSystemPrompt(portfolioContext)

    if (stream) {
      return handleStreaming(apiKey, systemPrompt, messages, portfolioContext)
    }

    return handleNonStreaming(apiKey, systemPrompt, messages, portfolioContext)
  } catch (err) {
    console.error('[api/chat]', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handleNonStreaming(apiKey, systemPrompt, messages, ctx) {
  let apiMessages = messages.map(m => ({ role: m.role, content: m.content }))
  let finalText = ''
  let toolActions = []

  for (let turn = 0; turn < 3; turn++) {
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
        messages: apiMessages,
        tools: TOOLS,
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

    const textBlocks = data.content?.filter(b => b.type === 'text') || []
    const toolBlocks = data.content?.filter(b => b.type === 'tool_use') || []

    if (textBlocks.length > 0) {
      finalText += textBlocks.map(b => b.text).join('')
    }

    if (toolBlocks.length === 0 || data.stop_reason !== 'tool_use') {
      break
    }

    apiMessages.push({ role: 'assistant', content: data.content })

    const toolResults = toolBlocks.map(tb => {
      const result = executeToolCall(tb.name, tb.input, ctx)
      if (tb.name === 'update_item' || tb.name === 'estimate_asset_value') {
        try { toolActions.push(JSON.parse(result)) } catch {}
      }
      return { type: 'tool_result', tool_use_id: tb.id, content: result }
    })

    apiMessages.push({ role: 'user', content: toolResults })
  }

  return NextResponse.json({ message: finalText, actions: toolActions })
}

async function handleStreaming(apiKey, systemPrompt, messages, ctx) {
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }))

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
      messages: apiMessages,
      tools: TOOLS,
      stream: true,
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

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6)
            if (jsonStr === '[DONE]') continue

            try {
              const event = JSON.parse(jsonStr)
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`))
              } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool_start: event.content_block.name })}\n\n`))
              } else if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
              }
            } catch {}
          }
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function buildSystemPrompt(ctx) {
  const lines = [
    'You are a financial advisor AI embedded in Chispudo, a personal portfolio tracking app.',
    'You have access to the user\'s real portfolio data below. Answer questions about their finances, suggest optimizations, estimate values, and provide actionable advice.',
    'Be concise and direct. Use numbers and percentages. Respond in the same language the user writes in (Spanish or English).',
    'You have tools available to estimate reward values, analyze debt payoff strategies, and update portfolio items when the user asks.',
    'When estimating credit card reward values, use the estimate_rewards tool.',
    'When the user asks which card to use or which gives better rewards, use the compare_cards tool.',
    'When the user asks to update a value, use the update_item tool.',
    'When the user asks about the value of a physical asset (property, car, collectible), use estimate_asset_value to provide your best estimate and optionally update the value.',
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
