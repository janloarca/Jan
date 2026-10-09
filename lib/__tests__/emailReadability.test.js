/**
 * @jest-environment node
 */
// FASE QD. Cómo se LEE el correo: la bandeja (preheader y remitente) y el
// cuerpo (contraste, lista de movers, notas, modo oscuro).
//
// Pedido del usuario tras FASE OO: "cómo podemos mejorar la lectura de
// bandeja de entrada y de body". Todo esto es presentación: ninguna cifra ni
// ninguna decisión de privacidad de FASE OO se mueve (hay un test que lo fija).

import { renderEmail, composePreheader, LIGHT, DARK } from '../emailLayout'
import { contrastRatio } from '../colorMath'
import { buildWeeklyBriefEmail } from '../weeklyBriefEmail'
import { buildMonthlyBriefEmail } from '../periodBriefEmail'
import { withDisplayName } from '../weeklyBriefBuilder'

const PORTFOLIO = {
  netWorth: 28547.41, weekAbs: 61.9, weekPct: 0.22, monthAbs: 120.5, monthPct: 0.42,
  ytdAbs: 211.14, ytdPct: 0.74, incomeAbs: 45.2, incomeCount: 2,
  movers: [{ symbol: 'NVO', pct: 2.1 }, { symbol: 'META', pct: -1.8 }],
  currency: 'USD', asOf: 'Sep 13, 2026',
}
const MARKET = { rows: [{ label: 'S&P 500', kind: 'index', last: 5000, changePct: 0.5 }], context: [] }

describe('contraste: lo que se lee con sol llega al piso de texto', () => {
  // Tinta, etiquetas, notas y pie sobre la tarjeta blanca. Antes el "gris
  // claro" de las notas y el pie medía 2.5:1.
  test.each(['ink', 'muted', 'faint', 'pos', 'neg'])('modo claro: %s sobre blanco >= 4.5', (k) => {
    expect(contrastRatio(LIGHT[k], LIGHT.card)).toBeGreaterThanOrEqual(4.5)
  })
  test('las pastillas de color por signo también se leen', () => {
    expect(contrastRatio(LIGHT.pos, LIGHT.posBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(LIGHT.neg, LIGHT.negBg)).toBeGreaterThanOrEqual(4.5)
  })
  test.each(['ink', 'muted', 'pos', 'neg'])('modo oscuro: %s sobre la tarjeta oscura >= 4.5', (k) => {
    expect(contrastRatio(DARK[k], DARK.card)).toBeGreaterThanOrEqual(4.5)
  })
  test('modo oscuro: las cifras de color se leen sobre su pastilla', () => {
    expect(contrastRatio(DARK.pos, DARK.posBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(DARK.neg, DARK.negBg)).toBeGreaterThanOrEqual(4.5)
  })
  test('el botón invertido (texto oscuro sobre fondo claro) se lee', () => {
    expect(contrastRatio('#111827', DARK.ink)).toBeGreaterThanOrEqual(7)
  })
})

describe('modo oscuro', () => {
  test('el correo declara que soporta los dos esquemas y trae las clases que lo sobreescriben', () => {
    const { html } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: PORTFOLIO, market: MARKET })
    expect(html).toContain('color-scheme:light dark')
    expect(html).toContain('prefers-color-scheme: dark')
    for (const c of ['em-bg', 'em-card', 'em-ink', 'em-muted', 'em-pos', 'em-neg', 'em-btn']) {
      expect(html).toContain(c)
    }
  })
  test('el preheader sigue siendo lo PRIMERO del HTML', () => {
    const { html } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: PORTFOLIO })
    expect(html.indexOf('<div style="display:none')).toBe(0)
  })
})

describe('movers: una fila por mover, con su color por signo', () => {
  test('el HTML los lista separados y el texto plano los alinea', () => {
    const { html, text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: PORTFOLIO })
    expect(html).not.toContain('NVO +2.10%   ·   META')
    expect(html).toMatch(/class="em-pos"[^>]*>\+2\.10%/)
    expect(html).toMatch(/class="em-neg"[^>]*>-1\.80%/)
    expect(text).toMatch(/NVO\s+\+2\.10%/)
    expect(text).toMatch(/META\s+-1\.80%/)
  })
})

describe('notas administrativas: después del botón, chicas', () => {
  test('el semanal pone el adjunto y el aviso del total DESPUÉS del botón', () => {
    const { html, text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: PORTFOLIO, hasAttachment: true })
    const cta = html.indexOf('Open Chispudo')
    expect(cta).toBeGreaterThan(0)
    expect(html.indexOf('attached as a PDF')).toBeGreaterThan(cta)
    expect(html.indexOf('kept out of this email')).toBeGreaterThan(cta)
    expect(text.indexOf('attached as a PDF')).toBeGreaterThan(text.indexOf('Open Chispudo:'))
  })
  test('el mensual igual', () => {
    const { html } = buildMonthlyBriefEmail({
      monthLabel: 'x', portfolio: PORTFOLIO, attachmentsInfo: { report: true, spreadsheet: true, missingMonths: ['2026-01'] },
    })
    const cta = html.indexOf('Open Chispudo')
    expect(html.indexOf('Attached:')).toBeGreaterThan(cta)
    expect(html.indexOf('Some months in the spreadsheet are blank')).toBeGreaterThan(cta)
  })
  test('una sección sin notas no dibuja nada extra', () => {
    const { html } = renderEmail({ title: 'T', sections: [{ rows: [['a', 'b', '']] }] })
    expect(html).not.toContain('font-size:12px;line-height:1.5')
  })
})

describe('preheader: nombra lo que ESTE correo trae, sin datos', () => {
  const first = (t) => t.split('\n')[0]

  test('con ingresos, movers y mercado, los nombra', () => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: PORTFOLIO, market: MARKET })
    expect(first(text)).toMatch(/income you collected/)
    expect(first(text)).toMatch(/biggest movers/)
    expect(first(text)).toMatch(/market closed/)
  })
  test('sin ingresos ni movers ni mercado, no los promete', () => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', portfolio: { ...PORTFOLIO, incomeAbs: 0, movers: [] } })
    expect(first(text)).not.toMatch(/income|movers|market/)
  })
  test.each([
    ['con todo', { portfolio: PORTFOLIO, market: MARKET }],
    ['sin nada', { portfolio: { ...PORTFOLIO, incomeAbs: 0, movers: [] } }],
  ])('%s: >= 100 caracteres, cero dígitos y cero tickers', (_n, extra) => {
    const { text } = buildWeeklyBriefEmail({ weekLabel: 'x', ...extra })
    const line = first(text)
    expect(line.length).toBeGreaterThanOrEqual(100)
    expect(line).not.toMatch(/\d/)
    expect(line).not.toMatch(/NVO|META/)
  })
  test('el mensual también', () => {
    const { text } = buildMonthlyBriefEmail({ monthLabel: 'x', portfolio: PORTFOLIO, attachmentsInfo: { report: true } })
    expect(first(text)).toMatch(/^Your month in Chispudo:/)
    expect(first(text)).toMatch(/attached report/)
    expect(first(text)).not.toMatch(/\d/)
  })
  test('composePreheader tira cualquier dígito que se cuele y completa si queda corto', () => {
    const out = composePreheader('Your week in Chispudo:', ['how it moved 123'], 'Open.')
    expect(out).not.toMatch(/\d/)
    expect(out).toMatch(/stay inside the email/)
    expect(out.length).toBeGreaterThanOrEqual(100)
  })
  test('el asunto sigue sin llevar cifras (FASE OO intacta)', () => {
    const { subject, html } = buildWeeklyBriefEmail({ weekLabel: 'Sep 7-13, 2026', portfolio: PORTFOLIO })
    expect(subject).toBe('Chispudo Weekly · Sep 7-13, 2026')
    expect(html).not.toContain('$28,547.41')
  })
})

describe('remitente', () => {
  test('una dirección pelada se muestra como "Chispudo"', () => {
    expect(withDisplayName('reminders@chispu.xyz')).toBe('Chispudo <reminders@chispu.xyz>')
  })
  test('si ya trae nombre, se respeta', () => {
    expect(withDisplayName('Otro Nombre <a@b.com>')).toBe('Otro Nombre <a@b.com>')
  })
  test('vacío sigue vacío (el caller cae a su default)', () => {
    expect(withDisplayName(undefined)).toBe('')
  })
})
