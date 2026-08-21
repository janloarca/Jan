import { isReinvestedDividend, isCashDividend, reinvestIndex } from '../dividendCash'
import { trailingDividends, incomeInWindow } from '../serverPortfolio'

// El caso real que documenta lib/liquidYield.js: el fondo del usuario tenia 19
// pagos escritos ANTES de cambiar la cuenta a reinvertir, asi que ninguno lleva
// la bandera `_reinvested`. Todo motor de reconstruccion los trata hoy como
// reinvertidos (indexBalanceEvents mira `linked.dividendAction`), pero las
// cifras de "cuanto cobre" los contaban como efectivo.
const FUND_REINVEST = { id: 'fund', name: 'ClubCashIn', dividendAction: 'reinvest' }
const FUND_CASH = { id: 'cash-fund', name: 'Fondo que paga', incomeDestination: 'banco' }

const legacyPayment = { type: 'DIVIDEND', date: '2026-03-15', totalAmount: 100, currency: 'USD', _linkedItemId: 'fund' }
const flaggedPayment = { type: 'DIVIDEND', date: '2026-03-15', totalAmount: 100, currency: 'USD', _linkedItemId: 'fund', _reinvested: true }
const realCash = { type: 'DIVIDEND', date: '2026-03-15', totalAmount: 40, currency: 'USD', _linkedItemId: 'cash-fund' }

describe('isReinvestedDividend', () => {
  it('la bandera sola no alcanza: un pago viejo sin ella tambien se quedo adentro', () => {
    // Regresion NEGATIVA explicita: asi se comportaban los cuatro sitios antes.
    expect(!!legacyPayment._reinvested).toBe(false)
    expect(isReinvestedDividend(legacyPayment, [FUND_REINVEST])).toBe(true)
  })

  it('la bandera manda aunque la cuenta ya no reinvierta', () => {
    expect(isReinvestedDividend(flaggedPayment, [FUND_CASH])).toBe(true)
  })

  it('un pago que de verdad salio a otra cuenta es efectivo', () => {
    expect(isReinvestedDividend(realCash, [FUND_CASH])).toBe(false)
    expect(isCashDividend(realCash, [FUND_CASH])).toBe(true)
  })

  it('sin items cae a la bandera sola: un caller viejo no cambia de resultado', () => {
    expect(isReinvestedDividend(legacyPayment, null)).toBe(false)
    expect(isReinvestedDividend(flaggedPayment, null)).toBe(true)
  })

  it('tolera un Map ya armado, un activo borrado y basura', () => {
    expect(isReinvestedDividend(legacyPayment, reinvestIndex([FUND_REINVEST]))).toBe(true)
    expect(isReinvestedDividend(legacyPayment, [])).toBe(false)
    expect(isReinvestedDividend(null, [FUND_REINVEST])).toBe(false)
  })
})

// ⛔ El candado del correo. `trailingDividends` e `incomeInWindow` viven en el
// MISMO archivo y alimentan el MISMO documento, y tenian reglas distintas: uno
// podia contar $100 que el otro correctamente excluia.
describe('el correo no puede contradecirse sobre el mismo dinero', () => {
  const txs = [legacyPayment, realCash]
  const items = [FUND_REINVEST, FUND_CASH]
  const now = new Date('2026-04-01T00:00:00Z')

  it('las dos cifras cuentan lo mismo', () => {
    const trailing = trailingDividends(txs, { convert: null, baseCurrency: 'USD', now, items })
    const window = incomeInWindow(txs, {
      fromTs: Date.UTC(2026, 0, 1), toTs: now.getTime(),
      convert: null, baseCurrency: 'USD', items,
    })
    expect(trailing).toBeCloseTo(40, 2)
    expect(window.total).toBeCloseTo(40, 2)
    expect(window.count).toBe(1)
  })

  it('sin items, trailing volvia a contar el pago viejo (comportamiento anterior)', () => {
    expect(trailingDividends(txs, { convert: null, baseCurrency: 'USD', now })).toBeCloseTo(140, 2)
  })
})

// El bloque "Flujo: un pago reinvertido nunca toco una cuenta bancaria" vivía
// acá y se eliminó con `investmentIncomeOfMonth`: Flujo ya no recibe nada del
// portafolio, así que esa pregunta no existe de ese lado. La regla que separa
// un pago reinvertido de uno cobrado en efectivo se sigue probando arriba, en
// las superficies de Patrimonio que sí la necesitan (trailingDividends e
// incomeInWindow, que alimentan el tablero y los correos).
