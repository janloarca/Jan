/**
 * @jest-environment node
 */
// El adjunto del correo semanal depende de que jsPDF corra EN NODE, no solo
// en el navegador. Es la suposición más riesgosa de toda la cadena: si falla,
// falla en producción dentro de un cron que nadie mira. Este test genera un
// PDF de verdad en el entorno de Node y verifica los bytes.

import { renderReportPdf } from '../generateReport'

const identity = (v) => v

const items = [
  { id: 'v', name: 'VITALI', symbol: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, entryFee: 95.78, currency: 'USD', _originalCurrency: 'USD' },
  { id: 'a', name: 'APPLE INC', symbol: 'AAPL', type: 'Stock', institution: 'IBKR', quantity: 10, purchasePrice: 150, currentPrice: 180, currency: 'USD', _originalCurrency: 'USD' },
]
const transactions = [{ id: 't', type: 'DIVIDEND', date: '2026-08-12', totalAmount: 240, currency: 'USD', _linkedItemId: 'v' }]
const snapshots = [
  { date: '2026-08-09', netWorthUSD: 7600, _source: 'daily' },
  { date: '2026-08-15', netWorthUSD: 7800, _source: 'daily' },
]

describe('PDF del servidor', () => {
  test('genera bytes de un PDF válido, con nombre de archivo', async () => {
    const { buffer, filename } = await renderReportPdf({
      items, snapshots, transactions,
      netWorth: 7800, totalAssets: 7800, lang: 'en',
      profileName: 'Jan', baseCurrency: 'USD', convert: identity, period: 'week',
    })
    expect(Buffer.isBuffer(buffer)).toBe(true)
    // Firma de un PDF: los primeros bytes son "%PDF-".
    expect(buffer.slice(0, 5).toString('latin1')).toBe('%PDF-')
    // Un PDF con contenido real, no una cáscara vacía.
    expect(buffer.length).toBeGreaterThan(3000)
    expect(filename).toMatch(/^chispudo-report-jan-\d{4}-\d{2}-\d{2}\.pdf$/)
  }, 30000)

  test('el período semanal se refleja en el documento', async () => {
    const { buffer } = await renderReportPdf({
      items, snapshots, transactions,
      netWorth: 7800, totalAssets: 7800, lang: 'en',
      baseCurrency: 'USD', convert: identity, period: 'week',
    })
    // jsPDF guarda el "subject" con la etiqueta del período en los metadatos.
    const raw = buffer.toString('latin1')
    expect(raw).toContain('Portfolio Report')
  }, 30000)

  test('sin nombre de perfil el archivo sigue teniendo un nombre usable', async () => {
    const { filename } = await renderReportPdf({
      items, snapshots, transactions,
      netWorth: 7800, totalAssets: 7800, lang: 'en',
      baseCurrency: 'USD', convert: identity, period: 'week',
    })
    expect(filename).toMatch(/^chispudo-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  }, 30000)
})

// FASE JA4. La vista previa en pantalla y el PDF descargado salen del MISMO
// motor (`buildReportData`), pero el reenvío de `handleDownload` recortaba
// campos: benchmark, volatilidad, Sharpe y beta llegaban como undefined, así
// que esas secciones simplemente no se imprimían y el usuario descargaba un
// documento distinto del que acababa de ver. Este test verifica sobre el PDF
// GENERADO que, con esos datos presentes, sí salen.
function pdfText(buffer) {
  const s = buffer.toString('latin1')
  return [...s.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)]
    .map((m) => m[0].slice(1, -4).replace(/\\([()])/g, '$1')).join('\n')
}

describe('paridad entre la vista previa y el PDF', () => {
  const withRisk = {
    items, snapshots, transactions,
    netWorth: 7800, totalAssets: 7800, lang: 'es',
    profileName: 'Jan', baseCurrency: 'USD', convert: identity, period: 'ytd',
    benchmarkName: 'S&P 500', benchmarkReturn: 12.5,
    volatilityPct: 8.4, sharpe: 1.12, beta: 0.62,
  }

  test('con benchmark y riesgo, el PDF los imprime', async () => {
    const { buffer } = await renderReportPdf(withRisk)
    const txt = pdfText(buffer)
    expect(txt).toContain('S&P 500')
    expect(txt).toContain('8.4')
    expect(txt).toContain('1.12')
    expect(txt).toContain('0.62')
  })

  test('sin esos campos el PDF sigue saliendo, solo sin esas líneas', async () => {
    // El comportamiento viejo del reenvío recortado, fijado como regresión: el
    // documento es válido, pero le faltan secciones que la pantalla sí mostró.
    const { buffer } = await renderReportPdf({ ...withRisk, benchmarkName: undefined, benchmarkReturn: undefined, volatilityPct: undefined, sharpe: undefined, beta: undefined })
    const txt = pdfText(buffer)
    expect(buffer.length).toBeGreaterThan(1000)
    expect(txt).not.toContain('S&P 500')
  })
})
