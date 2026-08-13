/**
 * @jest-environment node
 */
// Integración del builder mensual de punta a punta con un db FALSO: el
// pipeline real (carga → enriquecimiento → Dietz del mes cerrado → adjuntos),
// no una versión hecha a mano de sus salidas (la lección de FASE GQ3: probar
// con props armados a mano fue exactamente cómo se escapó un crash). Activos
// solo estáticos a propósito: priceItems no toca la red sin símbolos de
// mercado, así que el test no depende de ningún proveedor.

import { buildMonthlyBriefForUser, monthRefFor } from '../monthlyBriefBuilder'

// Enviado el 1 de septiembre a las 22:00 UTC: cubre agosto completo.
const NOW = new Date('2026-09-01T22:00:00Z')

const ITEMS = [
  { id: 'bond1', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD' },
  { id: 'cash1', name: 'Fondo Líquido', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 240, currency: 'USD' },
]

const SNAPSHOTS = [
  { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 6000, rates: { USD: 1 }, _source: 'daily' },
  { id: '2026-07-31', date: '2026-07-31', netWorthUSD: 6100, rates: { USD: 1 }, _source: 'daily' },
  { id: '2026-08-31', date: '2026-08-31', netWorthUSD: 6240, rates: { USD: 1 }, _source: 'daily' },
]

const TXS = [
  { id: 't1', type: 'DIVIDEND', date: '2026-08-15', totalAmount: 140, currency: 'USD', _linkedItemId: 'bond1' },
]

const ITEM_SNAPSHOT_DOCS = {
  // Solo enero cacheado, y bajo la versión VIGENTE: los demás meses quedan en
  // blanco y agosto (el mes cubierto) sale de los valores en vivo.
  '2026-01': { _version: 999, _currency: 'USD', items: { bond1: { value: 6000 }, cash1: { value: 0 } } },
}

function makeFakeDb() {
  return {
    collection: (path) => ({
      get: async () => {
        const name = path.split('/').pop()
        const rows = name === 'items' ? ITEMS : name === 'transactions' ? TXS : name === 'snapshots' ? SNAPSHOTS : []
        return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
      },
    }),
    doc: (path) => ({
      get: async () => {
        const mk = path.split('/').pop()
        const data = ITEM_SNAPSHOT_DOCS[mk]
        // Admin SDK: `exists` es PROPIEDAD, no función (el cliente usa exists()).
        return { exists: !!data, data: () => data }
      },
    }),
  }
}

describe('buildMonthlyBriefForUser (integración con db falso)', () => {
  test('arma el correo del mes cerrado con sus DOS adjuntos reales', async () => {
    const mail = await buildMonthlyBriefForUser({ db: makeFakeDb(), uid: 'u1', prefs: {}, market: null, now: NOW })
    expect(mail).toBeTruthy()

    // El mes cubierto es AGOSTO (el de ayer), no septiembre.
    expect(mail.subject).toBe('Chispudo Monthly · August 2026')

    // Retorno del mes: ancla 31 jul (6,100) → hoy (6,240), con el cupón de
    // 140 cobrado EN efectivo a mitad de mes. No hay depósitos que netear.
    expect(mail.text).toContain('This month')
    expect(mail.text).toContain('Income collected')

    // Los dos adjuntos reales: PDF (firma %PDF) y XLSX (firma ZIP "PK").
    expect(mail.attachments).toHaveLength(2)
    const pdf = mail.attachments.find((a) => a.filename.endsWith('.pdf'))
    const xlsx = mail.attachments.find((a) => a.filename.endsWith('.xlsx'))
    expect(pdf.content.slice(0, 4).toString('latin1')).toBe('%PDF')
    expect(xlsx.content.slice(0, 2).toString('latin1')).toBe('PK')
    expect(xlsx.filename).toBe('chispudo-spreadsheet-2026.xlsx')
    expect(mail.text).toContain('year-to-date report (PDF)')
    expect(mail.text).toContain('monthly spreadsheet (Excel)')

    // El caché solo tenía enero: el correo avisa de los meses en blanco.
    expect(mail.text).toMatch(/blank.*open the Spreadsheet/i)
  })

  test('portafolio vacío devuelve null en vez de un correo hueco', async () => {
    const emptyDb = {
      collection: () => ({ get: async () => ({ docs: [] }) }),
      doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
    }
    expect(await buildMonthlyBriefForUser({ db: emptyDb, uid: 'u1', now: NOW })).toBeNull()
  })

  test('monthRefFor: el 1 del mes referencia al mes anterior', () => {
    const ref = monthRefFor(NOW)
    expect(ref.getUTCMonth()).toBe(7) // agosto
    expect(ref.getUTCFullYear()).toBe(2026)
  })
})
