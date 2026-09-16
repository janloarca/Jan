import { isReinvestedDividend, isCashDividend, reinvestIndex, wentOutAsCash } from '../dividendCash'
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

// FASE ON. "Reinvertido stale": un pago que YA salió a otra cuenta se leía como
// reinvertido en cuanto el activo cambiaba de modo, y con eso desaparecía del
// reporte dinero que de verdad se cobró.
describe('FASE ON: la evidencia de la fila le gana al modo de HOY', () => {
  // VITALI paga cupones EN EFECTIVO al Fondo Líquido. El motor estampa
  // `_destinationCredited` solo cuando escribe un pago ruteado a un destino.
  const cupon = {
    type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD',
    _linkedItemId: 'vitali', _source: 'auto', _destinationCredited: true,
  }
  // Un pago registrado a mano NOMBRA la cuenta que lo recibió.
  const manual = {
    type: 'DIVIDEND', date: '2026-06-15', totalAmount: 100, currency: 'USD',
    _linkedItemId: 'vitali', _destinationItemId: 'fondo', _source: 'manual_cashflow',
  }
  // El mismo activo DESPUÉS de cambiarlo a reinvertir: el editor limpia el
  // destino configurado (FASE OB), así que lo único que queda es el modo.
  const VITALI_REINVEST = { id: 'vitali', name: 'VITALI', dividendAction: 'reinvest' }
  const FONDO = { id: 'fondo', name: 'Fondo Líquido' }
  const after = [VITALI_REINVEST, FONDO]

  it('un cupón que acreditó otra cuenta sigue siendo efectivo tras el cambio de modo', () => {
    expect(isReinvestedDividend(cupon, after)).toBe(false)
    expect(isCashDividend(cupon, after)).toBe(true)
  })

  it('un pago que nombra su destino sigue siendo efectivo tras el cambio de modo', () => {
    expect(isReinvestedDividend(manual, after)).toBe(false)
  })

  it('el correo ya no pierde el ingreso: 340 antes y 340 después del cambio', () => {
    const txs = [cupon, manual]
    const now = new Date('2026-07-01T00:00:00Z')
    const before = [{ id: 'vitali', name: 'VITALI', incomeDestination: 'fondo' }, FONDO]
    const trailing = (items) => trailingDividends(txs, { convert: null, baseCurrency: 'USD', now, items })
    expect(trailing(before)).toBeCloseTo(340, 2)
    expect(trailing(after)).toBeCloseTo(340, 2)
    const window = incomeInWindow(txs, {
      fromTs: Date.UTC(2026, 0, 1), toTs: now.getTime(),
      convert: null, baseCurrency: 'USD', items: after,
    })
    expect(window.total).toBeCloseTo(340, 2)
    expect(window.count).toBe(2)
  })

  it('el `false` del backfill sigue siendo un pago en efectivo: se mira la presencia, no el valor', () => {
    // `_destinationCredited:false` dice que el SALDO no se movió porque el
    // saldo tecleado ya lo contenía (FASE DI), no que el pago fuera reinvertido.
    const backfill = { ...cupon, _destinationCredited: false }
    expect(isReinvestedDividend(backfill, after)).toBe(false)
  })

  it('un rendimiento acreditado a la MISMA cuenta que lo generó NO salió', () => {
    const selfYield = {
      type: 'DIVIDEND', date: '2026-05-15', totalAmount: 12, currency: 'USD',
      _linkedItemId: 'fondo', _destinationItemId: 'fondo',
    }
    expect(wentOutAsCash(selfYield)).toBe(false)
    expect(isReinvestedDividend(selfYield, [{ ...FONDO, dividendAction: 'reinvest' }])).toBe(true)
  })

  it('la bandera se sigue chequeando PRIMERO', () => {
    expect(isReinvestedDividend({ ...cupon, _reinvested: true }, after)).toBe(true)
  })

  it('un pago SIN evidencia conserva la regla de FASE JW', () => {
    // Regresión negativa: el caso que esa fase arregló (19 pagos escritos antes
    // de cambiar la cuenta a reinvertir, ninguno con bandera ni con destino) se
    // sigue leyendo como reinvertido, que es lo correcto.
    expect(wentOutAsCash(legacyPayment)).toBe(false)
    expect(isReinvestedDividend(legacyPayment, [FUND_REINVEST])).toBe(true)
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
