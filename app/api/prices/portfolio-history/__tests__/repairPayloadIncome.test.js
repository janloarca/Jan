/**
 * @jest-environment node
 */
// ⛔ FASE JU. El caso del usuario, reproducido contra la RUTA REAL.
//
// "Reparar ahora" (PortfolioGrowthChart) escribe los MISMOS docs de historial
// que el backfill automático, pero armaba su propio cuerpo de petición y se
// quedaba sin `income`. Ese campo es el ÚNICO canal por el que el server se
// entera del rendimiento REINVERTIDO: indexBalanceEvents lo manda a
// reinvestBySym/ById y nunca a balanceEventsById, así que no aparece en los
// `cashFlows` de ningún ítem.
//
// Consecuencia: una cuenta que compone (ClubCashIn, los fondos líquidos de IDC)
// se reconstruía PLANA en su valor de HOY, o sea el ancla del 1 de enero se
// archivaba demasiado alta. El panel del YTD, que sí manda `income` en su
// propio fetch, medía esa misma cuenta bien, y la diferencia salía como "Sin
// atribuir".
//
// Este test compara los DOS cuerpos contra la misma ruta y fija la diferencia.
jest.mock('../../../../../lib/apiAuth', () => ({ verifyAuth: jest.fn(async () => ({ uid: 'test-uid' })) }))
jest.mock('../../../../../lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ limited: false })) }))
jest.mock('../../../../../lib/priceCache', () => ({ getLastGood: jest.fn(async () => null), saveLastGood: jest.fn(async () => {}) }))
jest.mock('../../../../../lib/fetchWithRetry', () => ({ fetchWithRetry: jest.fn() }))
jest.mock('../../../../../lib/authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))

const { POST } = require('../route')
const { buildHistoryRequestBody, buildHistoryItemsPayload } = require('../../../../../lib/historyPayload')

const mockRequest = (body) => ({ json: async () => body })

// Un fondo que compone: hoy vale 706.73 y llegó ahí sumando su propio
// rendimiento mes a mes sobre un depósito de apertura viejo.
const FUND = {
  id: 'clubcashin', name: 'ClubCashIn', symbol: 'CLUBCASH',
  type: 'Cuenta bancaria', quantity: 1, currency: 'USD',
  purchasePrice: 706.73, currentPrice: 706.73,
  acquisitionDate: '2024-06-01', dividendAction: 'reinvest',
}
const OPENING = {
  id: 'dep', type: 'DEPOSIT', date: '2024-06-01', totalAmount: 600,
  currency: 'USD', _linkedItemId: 'clubcashin', _source: 'manual_new_account',
}
// Doce pagos reinvertidos de este año (ene..dic), 4.20 cada uno.
const YIELD = Array.from({ length: 12 }, (_, i) => ({
  id: `y${i}`, type: 'DIVIDEND',
  date: `${new Date().getUTCFullYear()}-${String(i + 1).padStart(2, '0')}-28`,
  totalAmount: 4.20, currency: 'USD',
  _linkedItemId: 'clubcashin', _reinvested: true, _source: 'inferred_yield',
}))
const TX = [OPENING, ...YIELD]

async function jan1Total(body) {
  const res = await POST(mockRequest(body))
  const data = await res.json()
  const jan1 = `${new Date().getUTCFullYear()}-01-01`
  const pts = (data.dataPoints || []).filter(
    (p) => new Date(p.ts).toISOString().split('T')[0] === jan1)
  return pts.length > 0 ? pts[pts.length - 1].total : null
}

describe('el cuerpo compartido lleva el rendimiento reinvertido al ancla', () => {
  const shared = { items: [FUND], transactions: TX, lots: [], convert: null }

  it('el cuerpo VIEJO del reparador (sin income) archiva la cuenta plana en su valor de HOY', async () => {
    // Regresión NEGATIVA explícita: así se comportaba el botón antes.
    const legacyBody = {
      items: buildHistoryItemsPayload(shared),
      period: 'YTD',
      breakdown: true,
    }
    const total = await jan1Total(legacyBody)
    expect(total).not.toBeNull()
    // 706.73 de hoy menos nada: el rendimiento del año es invisible.
    expect(total).toBeCloseTo(706.73, 2)
  })

  it('el cuerpo COMPARTIDO reversa los 12 pagos y baja el ancla', async () => {
    const body = buildHistoryRequestBody({ ...shared, period: 'YTD', breakdown: true })
    expect(body.income).toHaveLength(12)
    const total = await jan1Total(body)
    expect(total).not.toBeNull()
    // 706.73 - 12 x 4.20 = 656.33. El pago fechado el 28 de enero todavía no
    // había ocurrido el 1 de enero, así que los DOCE se reversan.
    expect(total).toBeCloseTo(656.33, 2)
  })

  it('la diferencia es exactamente el rendimiento del año', async () => {
    const legacy = await jan1Total({ items: buildHistoryItemsPayload(shared), period: 'YTD' })
    const fixed = await jan1Total(buildHistoryRequestBody({ ...shared, period: 'YTD' }))
    expect(legacy - fixed).toBeCloseTo(12 * 4.20, 2)
  })
})
