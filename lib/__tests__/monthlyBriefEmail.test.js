/**
 * @jest-environment node
 */
// El correo mensual hereda las reglas del semanal: no calcula nada, omite lo
// ausente en vez de imprimir ceros, y dice qué logró adjuntar. Estos tests
// fijan además la etiqueta del mes cubierto: cerrado a secas, en curso con
// "(to date)": una ventana parcial etiquetada como mes completo es mentira.

import { buildMonthlyBriefEmail, monthLabelFor } from '../monthlyBriefEmail'

const PORTFOLIO = {
  netWorth: 23156.99,
  monthAbs: 210.4, monthPct: 0.92,
  ytdAbs: 835.36, ytdPct: 3.12,
  incomeAbs: 240, incomeCount: 1,
  currency: 'USD', asOf: 'Aug 1, 2026',
}

describe('monthLabelFor', () => {
  test('mes cerrado: el nombre a secas', () => {
    const ref = new Date('2026-07-31T22:00:00Z')
    const now = new Date('2026-08-01T22:00:00Z')
    expect(monthLabelFor(ref, now)).toBe('July 2026')
  })

  test('mes en curso (prueba a mitad de mes): "(to date)"', () => {
    const ref = new Date('2026-08-12T22:00:00Z')
    const now = new Date('2026-08-13T22:00:00Z')
    expect(monthLabelFor(ref, now)).toBe('August 2026 (to date)')
  })
})

describe('buildMonthlyBriefEmail', () => {
  test('asunto y cifras del mes y del año', () => {
    const { subject, text } = buildMonthlyBriefEmail({ monthLabel: 'July 2026', portfolio: PORTFOLIO })
    expect(subject).toBe('Chispudo Monthly · July 2026')
    expect(text).toContain('This month')
    expect(text).toContain('+$210.40 (+0.92%)')
    expect(text).toContain('+$835.36 (+3.12%)')
  })

  test('nombra los DOS adjuntos, y avisa de meses en blanco del spreadsheet', () => {
    const { text } = buildMonthlyBriefEmail({
      monthLabel: 'July 2026', portfolio: PORTFOLIO,
      attachmentsInfo: { report: true, spreadsheet: true, missingMonths: ['2026-02'] },
    })
    expect(text).toContain('year-to-date report (PDF)')
    expect(text).toContain('monthly spreadsheet (Excel)')
    expect(text).toMatch(/blank.*open the Spreadsheet/i)
  })

  test('sin adjuntos no promete adjuntos; sin retornos lo dice en vez de imprimir 0%', () => {
    const { text } = buildMonthlyBriefEmail({
      monthLabel: 'July 2026',
      portfolio: { ...PORTFOLIO, monthAbs: null, monthPct: null, ytdAbs: null, ytdPct: null },
      attachmentsInfo: {},
    })
    expect(text).not.toContain('Attached')
    expect(text).toContain('Not enough history yet')
    expect(text).not.toContain('+0.00%')
  })

  test('índices como NIVEL y cripto en dólares, igual que el semanal', () => {
    const market = {
      rows: [
        { key: 'spx', label: 'S&P 500', kind: 'index', last: 6340.12, changePct: 2.1 },
        { key: 'btc', label: 'Bitcoin', kind: 'crypto', last: 63127, changePct: -3.4 },
      ],
      context: ['S&P 500 up 2.1%, its biggest monthly move in 13 months.'],
    }
    const { text } = buildMonthlyBriefEmail({ monthLabel: 'July 2026', portfolio: PORTFOLIO, market })
    expect(text).toContain('6,340.12')
    expect(text).not.toContain('$6,340.12')
    expect(text).toContain('$63,127.00')
    expect(text).toContain('biggest monthly move in 13 months')
  })

  test('un nivel lleva SIEMPRE dos decimales: "26,752.5" rompe la columna (FASE IE3)', () => {
    const market = {
      rows: [{ key: 'ndx', label: 'Nasdaq', kind: 'index', last: 26752.5, changePct: 3.36 }],
      context: [],
    }
    const { text } = buildMonthlyBriefEmail({ monthLabel: 'July 2026', portfolio: PORTFOLIO, market })
    expect(text).toContain('26,752.50')
    expect(text).not.toMatch(/26,752\.5(?!0)/)
  })
})
