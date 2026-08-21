/**
 * @jest-environment node
 */
// FASE KP. El PDF del link compartido (`audience: 'share'`) es una ALLOWLIST:
// omite instituciones (la promesa del tab Compartir: "Nunca revelan la
// institución de tus activos"), la columna de cantidades (el leak test del
// payload ya prohíbe qty), jurisdicciones, el detalle de deudas, sectores y
// comisiones; y agrega "Preparado para X por Y" más las disclosures. El
// default ('owner') queda BYTE-COHERENTE con lo de siempre, fijado como
// regresión: el PDF del dueño SIGUE conteniendo todo eso.
//
// Se verifica sobre el PDF GENERADO (texto extraído del content stream),
// nunca sobre el código que lo intenta: la lección de los tests de correo.

import { renderReportPdf } from '../generateReport'

const NOW_ITEMS = [
  { id: 'bond', name: 'VITALI', type: 'Bond', institution: 'IDC', currency: 'USD', quantity: 3, purchasePrice: 2000, currentPrice: 2000, entryFee: 98, taxJurisdiction: 'GT' },
  { id: 'aapl', name: 'APPLE INC', symbol: 'AAPL', type: 'Stock', sector: 'Technology', institution: 'Interactive Brokers', currency: 'USD', quantity: 2, purchasePrice: 150, currentPrice: 220 },
  { id: 'loan', name: 'Prestamo carro', type: 'Debt', isDebt: true, currency: 'USD', quantity: 1, currentPrice: 800 },
]

const SNAPSHOTS = [
  { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 6000, rates: { USD: 1 }, _source: 'daily' },
  { id: '2026-08-20', date: '2026-08-20', netWorthUSD: 5600, rates: { USD: 1 }, _source: 'daily' },
]

const TXS = [
  { id: 'd1', type: 'DEPOSIT', date: '2026-03-01', totalAmount: 500, currency: 'USD' },
]

// Los operadores `(...) Tj` del content stream de jsPDF sin comprimir.
function pdfText(buffer) {
  const s = buffer.toString('latin1')
  return [...s.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)]
    .map((m) => m[0].slice(1, -4).replace(/\\([()])/g, '$1')).join('\n')
}

const baseOpts = {
  items: NOW_ITEMS, snapshots: SNAPSHOTS, transactions: TXS,
  netWorth: 5640, totalAssets: 6440, lang: 'es',
  profileName: 'Jan Marco', baseCurrency: 'USD',
  convert: (v) => v, period: 'ytd',
}

describe('el PDF del dueño (default) conserva TODO: la regresión que protege al resto', () => {
  test('instituciones, cantidades, jurisdicción, deudas y sector presentes', async () => {
    const { buffer } = await renderReportPdf(baseOpts)
    const txt = pdfText(buffer)
    expect(txt).toContain('Interactive Brokers')
    expect(txt).toContain('Cant.')
    expect(txt).toContain('jurisdicci')
    expect(txt).toContain('Prestamo carro')
    expect(txt).toContain('Sector')
    expect(txt).toContain('Comisiones de entrada pagadas')
    // Y NO lleva la portada de cliente ni las disclosures del link.
    expect(txt).not.toContain('Preparado para')
    expect(txt).not.toContain('no sustituye')
  })
})

describe("el PDF del link (audience: 'share') es allowlist", () => {
  const shareOpts = {
    ...baseOpts,
    audience: 'share',
    clientLabel: 'Cliente Conacaste',
    advisor: { firm: 'IDC Valores', phone: '+502 5555 5555', email: 'jan@idc.gt' },
  }

  test('NO contiene instituciones, cantidades, jurisdicciones, deudas, sector ni comisiones', async () => {
    const { buffer } = await renderReportPdf(shareOpts)
    const txt = pdfText(buffer)
    // La promesa de privacidad del tab Compartir, ahora también en papel.
    expect(txt).not.toContain('Interactive Brokers')
    expect(txt).not.toContain('Rendimiento por cuenta')
    expect(txt).not.toContain('Cant.')
    expect(txt).not.toContain('jurisdicci')
    expect(txt).not.toContain('Prestamo carro')
    expect(txt).not.toContain('Deudas y pasivos')
    expect(txt).not.toContain('Sector')
    expect(txt).not.toContain('Comisiones de entrada')
  })

  test('SÍ lleva la portada de cliente y las disclosures del link', async () => {
    const { buffer } = await renderReportPdf(shareOpts)
    const txt = pdfText(buffer)
    expect(txt).toContain('Preparado para Cliente Conacaste')
    expect(txt).toContain('Jan Marco')
    expect(txt).toContain('IDC Valores')
    expect(txt).toContain('no sustituye')
    expect(txt).toContain('rendimiento m')
    // Lo que el link SÍ publica sigue presente: posiciones sin cantidades.
    expect(txt).toContain('VITALI')
    expect(txt).toContain('APPLE INC')
  })

  test('la nota del motor de atribución por cuenta tampoco se imprime', async () => {
    const { buffer } = await renderReportPdf(shareOpts)
    const txt = pdfText(buffer)
    // El footnote ³ habla de una sección que este PDF no lleva.
    expect(txt).not.toContain('las filas suman el total')
  })
})
