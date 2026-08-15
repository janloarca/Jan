import { buildWeeklyBriefEmail, weekLabelFor, weeklyBriefSubject } from '../weeklyBriefEmail'

const basePortfolio = {
  netWorth: 26759.07,
  weekAbs: 326.65, weekPct: 1.24,
  ytdAbs: 1204.30, ytdPct: 4.72,
  incomeAbs: 45.20, incomeCount: 2,
  movers: [{ symbol: 'NVO', pct: 2.1 }, { symbol: 'VICI', pct: -1.8 }],
  currency: 'USD', asOf: 'Aug 16, 2026',
}

const market = {
  rows: [
    { key: 'spx', label: 'S&P 500', kind: 'index', last: 6340.12, changePct: 1.2 },
    { key: 'vix', label: 'VIX', kind: 'level', last: 14.2, changePct: -5.1 },
    { key: 'btc', label: 'Bitcoin', kind: 'crypto', last: 118420, changePct: 3.1 },
  ],
  context: ['S&P 500 up 1.2%, its biggest weekly move in 9 weeks.'],
  complete: false,
}

describe('correo semanal', () => {
  test('trae las cifras del usuario y del mercado, en HTML y en texto', () => {
    const { subject, html, text } = buildWeeklyBriefEmail({
      weekLabel: 'Aug 10-16, 2026', portfolio: basePortfolio, market,
    })
    expect(subject).toBe('Chispudo Weekly · Aug 10-16, 2026')
    for (const body of [html, text]) {
      expect(body).toContain('$26,759.07')
      expect(body).toContain('+1.24%')
      expect(body).toContain('+4.72%')
      expect(body).toContain('NVO +2.10%')
      expect(body).toContain('biggest weekly move in 9 weeks')
    }
    // El HTML escapa el ampersand (obligatorio); el texto plano no debe hacerlo.
    expect(html).toContain('S&amp;P 500')
    expect(html).not.toContain('>S&P 500<')
    expect(text).toContain('S&P 500')
  })

  test('el negativo del portafolio usa signo, no paréntesis: es un cambio, no un saldo', () => {
    const { text } = buildWeeklyBriefEmail({
      weekLabel: 'Aug 10-16, 2026',
      portfolio: { ...basePortfolio, weekAbs: -326.65, weekPct: -1.24 },
    })
    expect(text).toContain('-$326.65 (-1.24%)')
  })

  test('sin retorno medible lo DICE en vez de imprimir +0.00%', () => {
    const { text } = buildWeeklyBriefEmail({
      weekLabel: 'Aug 10-16, 2026',
      portfolio: { netWorth: 1000, weekPct: null, ytdPct: null, currency: 'USD' },
    })
    expect(text).toContain('Not enough history yet')
    expect(text).not.toContain('+0.00%')
  })

  // Un índice es un nivel, no un precio: "$6,340.12" para el S&P 500 es falso.
  test('los índices salen como nivel y solo la cripto en dólares', () => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio, market })
    expect(text).toContain('6,340.12')
    expect(text).not.toContain('$6,340.12')
    expect(text).toContain('$118,420')
  })

  test('sin datos de mercado la sección no aparece, en vez de una tabla vacía', () => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio, market: { rows: [] } })
    expect(text).not.toContain('MARKET BRIEF')
  })

  test('con mercado pero sin nada notable, lo dice sin inventar una historia', () => {
    const { text } = buildWeeklyBriefEmail({
      weekLabel: 'x', portfolio: basePortfolio,
      market: { rows: market.rows, context: [] },
    })
    expect(text).toContain('No standout moves')
  })

  test('el pie legal y el aviso de no-responder salen siempre', () => {
    const { html, text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio })
    for (const body of [html, text]) {
      expect(body).toContain('do not reply')
      expect(body).toContain('enabled weekly notifications')
    }
  })

  test('avisa del adjunto solo cuando de verdad se adjuntó', () => {
    const withPdf = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio, hasAttachment: true })
    expect(withPdf.text).toContain('attached as a PDF')
    const without = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio })
    expect(without.text).not.toContain('attached as a PDF')
  })

  test('la versión de texto no lleva etiquetas HTML', () => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio, market })
    expect(text).not.toMatch(/<[a-z/][^>]*>/i)
  })

  test('un nivel lleva SIEMPRE dos decimales: "26,752.5" rompe la columna (FASE IE3)', () => {
    const oneDecimal = {
      rows: [{ key: 'ndx', label: 'Nasdaq', kind: 'index', last: 26752.5, changePct: 3.36 }],
      context: [],
    }
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: basePortfolio, market: oneDecimal })
    expect(text).toContain('26,752.50')
    expect(text).not.toMatch(/26,752\.5(?!0)/)
  })
})

describe('etiqueta de la semana', () => {
  test('dentro del mismo mes', () => {
    expect(weekLabelFor('2026-08-16T00:00:00Z')).toBe('Aug 10-16, 2026')
  })
  test('cruzando el cambio de mes', () => {
    expect(weekLabelFor('2026-08-02T00:00:00Z')).toBe('Jul 27 - Aug 2, 2026')
  })
  test('el asunto usa la misma etiqueta', () => {
    expect(weeklyBriefSubject('Aug 10-16, 2026')).toContain('Aug 10-16, 2026')
  })
})
