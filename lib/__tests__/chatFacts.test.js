import { buildChatContext, dividendsReceived, anchorKind } from '../chatContext'
import { buildSystemPrompt } from '../chatPrompt'
import { parseMarkdownTable } from '../markdownTable'

const NOW = new Date('2026-11-10T15:00:00Z')
const id = (a) => a

describe('chat: hechos de la app, nunca inventados (FASE RQ)', () => {
  const items = [
    { id: 'voo', name: 'VOO', symbol: 'VOO', type: 'ETF', quantity: 10, currentPrice: 600, dividendAction: 'cash' },
    { id: 'jnj', name: 'JNJ', symbol: 'JNJ', type: 'Stock', quantity: 5, currentPrice: 150 },
  ]
  const transactions = [
    { type: 'DIVIDEND', symbol: 'VOO', _linkedItemId: 'voo', totalAmount: 70, currency: 'USD', date: '2026-03-30' },
    { type: 'DIVIDEND', symbol: 'VOO', _linkedItemId: 'voo', totalAmount: 75, currency: 'USD', date: '2025-12-20' },
    { type: 'DIVIDEND', symbol: 'JNJ', totalAmount: 6.7, currency: 'USD', date: '2026-11-01' },
  ]
  const ctx = buildChatContext({
    items, transactions, convert: id, baseCurrency: 'USD', now: NOW,
    netWorth: 196274.16, totalAssets: 271274.16,
    returnYTD: -0.58, ytdChange: -1150, ytdStartValue: 343570.55, ytdStartTs: Date.UTC(2026, 0, 1), ytdStartSrc: 'backfill',
    benchmarkReturn: 10.08, benchmarkName: 'S&P 500',
    estimatedAnnualIncome: 457.22,
    incomeProjections: new Map([['voo', { annual: 306.26, currency: 'USD' }]]),
  })

  test('fecha de hoy y año en curso', () => {
    expect(ctx.today).toBe('2026-11-10')
    expect(ctx.year).toBe(2026)
  })

  test('recibido YTD separado de 12 meses', () => {
    expect(ctx.income.receivedYTD).toBe(76.7)
    expect(ctx.income.receivedTrailing12m).toBe(151.7)
  })

  test('ingreso por posición: la proyección de la app, no una tasa multiplicada', () => {
    const voo = ctx.items.find((i) => i.id === 'voo')
    expect(voo.projectedAnnualIncome).toBe(306.26)
    expect(voo.incomeReceivedYTD).toBe(70)
    expect(ctx.items.find((i) => i.id === 'jnj').incomeReceivedYTD).toBe(6.7)
  })

  test('el arranque dice si es observado o estimado', () => {
    expect(ctx.ytd.startKind).toBe('estimated')
    expect(anchorKind('daily')).toBe('observed')
  })

  test('el prompt trae fecha, benchmark del MISMO periodo y quién va adelante', () => {
    const p = buildSystemPrompt(ctx)
    expect(p).toContain('Today: 2026-11-10')
    expect(p).toContain('+10.08%')
    expect(p).toContain('-0.58%')
    expect(p).toContain('BEHIND')
    expect(p).toContain('price return')
    expect(p).toContain('projected annual income=306.26 USD')
    expect(p).toContain('Income received this year (YTD, cash): 76.70 USD')
    expect(p).toMatch(/Do NOT use Markdown tables/)
  })

  test('sin benchmark ni YTD el prompt dice que no está, no deja hueco', () => {
    const p = buildSystemPrompt(buildChatContext({ items: [], now: NOW }))
    expect(p).toContain('Benchmark return: NOT AVAILABLE in the app')
    expect(p).toContain('Portfolio return YTD: NOT AVAILABLE in the app')
  })

  test('dividendo reinvertido no cuenta como recibido', () => {
    const r = dividendsReceived({ transactions: [{ type: 'DIVIDEND', totalAmount: 50, date: '2026-05-01', _reinvested: true }], items: [], now: NOW })
    expect(r.ytd).toBe(0)
  })
})

describe('tabla Markdown del chat', () => {
  test('parsea encabezado y filas', () => {
    const t = parseMarkdownTable(['| Activo | Valor |', '|---|---:|', '| VOO | $6,000 |'])
    expect(t.head).toEqual(['Activo', 'Valor'])
    expect(t.rows).toEqual([['VOO', '$6,000']])
  })
  test('sin separador no es tabla', () => {
    expect(parseMarkdownTable(['| a | b |', '| c | d |'])).toBeNull()
  })
})

// Auditoría 12 nov: el chat restaba el índice del Dietz del encabezado
// ("11.63 puntos por detrás") mientras la tarjeta comparaba contra el TWR.
describe('benchmark: la misma métrica que la tarjeta', () => {
  const { buildSystemPrompt } = require('../chatPrompt')
  const base = {
    today: '2026-11-12', baseCurrency: 'USD', netWorth: 195647.69, totalAssets: 345647.69,
    ytd: { returnPct: -0.54, gain: -1858.03, startValue: 344088.2, startDate: '2026-01-02', startKind: 'estimated' },
    income: {},
  }
  test('con TWR da la brecha de la tarjeta y no la del Dietz', () => {
    const p = buildSystemPrompt({ ...base, benchmark: { name: 'S&P 500', ytdReturnPct: 11.09, kind: 'price return', portfolioTwrPct: 3.35, twrScope: 'investable assets only (home excluded)' } })
    expect(p).toContain('Portfolio TWR YTD')
    expect(p).toContain('+3.35%')
    expect(p).toContain('-7.74 percentage points')
    expect(p).not.toContain('-11.63')
  })
  test('sin TWR la brecha Dietz va rotulada como tal', () => {
    const p = buildSystemPrompt({ ...base, benchmark: { name: 'S&P 500', ytdReturnPct: 11.09, kind: 'price return', portfolioTwrPct: null } })
    expect(p).toContain('-11.63 percentage points')
    expect(p).toContain('NOT the time-weighted')
  })
})
