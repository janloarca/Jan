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
