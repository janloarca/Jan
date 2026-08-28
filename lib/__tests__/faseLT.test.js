// FASE LT: una deuda no es un activo, y la Hoja deja de tratarla como uno.
//
// El caso que lo obligó (captura del usuario): pagó USD 321.36 de su préstamo,
// editó la celda, y la Hoja le ofreció "Saqué dinero / Perdió valor / El
// número estaba mal", las respuestas de un ACTIVO. "Saqué dinero" archivaba un
// WITHDRAWAL vinculado a la deuda (un flujo Dietz que además restaba del
// invertido del año) y "Perdió valor" leía el pago como ganancia.

import { editNeedsAnswer, planCellEdit, ANSWER_FLOW, ANSWER_CORRECTION, ANSWER_RETURN, FLOW_SOURCE } from '../spreadsheetEdit'
import { buildSheetDebtPaymentTransaction } from '../transferTx'
import { transferReversalPlan } from '../transferReversal'

// historicalValues arrastra authFetch (y con él firebase), que no inicializa
// bajo jest: el mismo stub que usa transferBalanceEvents.test.js.
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({ ok: false })),
  safeJson: jest.fn(() => Promise.resolve(null)),
}))
const { indexBalanceEvents } = require('../historicalValues')

const DEUDA = {
  id: 'd1', name: 'Deuda AIXEN', type: 'Debt', isDebt: true, currency: 'USD',
  quantity: 1, currentPrice: 4000, purchasePrice: 4000,
  interestRate: 1.5, ratePeriod: 'monthly',
}

describe('cuándo pregunta la Hoja sobre una deuda', () => {
  it('una BAJA pregunta (pago o corrección)', () => {
    expect(editNeedsAnswer({ item: DEUDA, oldValue: 4000, newValue: 3678.64, isMarket: false })).toBe(true)
  })

  it('una SUBIDA no pregunta: intereses, más préstamo o corrección escriben lo mismo', () => {
    expect(editNeedsAnswer({ item: DEUDA, oldValue: 4000, newValue: 4060, isMarket: false })).toBe(false)
  })

  it('un activo no cambia de comportamiento', () => {
    const banco = { id: 'b1', type: 'Bank', quantity: 1, currentPrice: 1000, purchasePrice: 1000 }
    expect(editNeedsAnswer({ item: banco, oldValue: 1000, newValue: 1100, isMarket: false })).toBe(true)
    expect(editNeedsAnswer({ item: banco, oldValue: 1000, newValue: 900, isMarket: false })).toBe(true)
  })
})

describe('qué escribe cada respuesta sobre una deuda', () => {
  it('"Hice un pago" registra el pago y deja el saldo nuevo en los DOS campos', () => {
    const plan = planCellEdit({ item: DEUDA, oldValue: 4000, newValue: 3678.64, answer: ANSWER_FLOW, date: '2026-08-27' })
    expect(plan.patch).toEqual({ currentPrice: 3678.64, purchasePrice: 3678.64 })
    // 4000 − 3678.64 deja polvo binario (321.36000...01): se compara con
    // tolerancia, el producto guarda el delta tal cual.
    expect(plan.debtPayment.amount).toBeCloseTo(321.36, 10)
    expect(plan.debtPayment.currency).toBe('USD')
    expect(plan.debtPayment.date).toBe('2026-08-27')
    // Y NUNCA el flujo de activo: eso era el bug (un WITHDRAWAL Dietz-visible
    // "sacando dinero" de una deuda).
    expect(plan.flow).toBeNull()
    expect(plan.income).toBeNull()
  })

  it('"El número estaba mal" escribe el mismo parche SIN registro', () => {
    const plan = planCellEdit({ item: DEUDA, oldValue: 4000, newValue: 3678.64, answer: ANSWER_CORRECTION, date: '2026-08-27' })
    expect(plan.patch).toEqual({ currentPrice: 3678.64, purchasePrice: 3678.64 })
    expect(plan.debtPayment).toBeNull()
    expect(plan.flow).toBeNull()
  })

  it('una respuesta de activo colada sobre una deuda no puede escribir un flujo', () => {
    // Defensa en profundidad: la UI de deuda no ofrece "Perdió valor", pero si
    // llegara, cae al parche a secas.
    const plan = planCellEdit({ item: DEUDA, oldValue: 4000, newValue: 3678.64, answer: ANSWER_RETURN, date: '2026-08-27' })
    expect(plan.patch).toEqual({ currentPrice: 3678.64, purchasePrice: 3678.64 })
    expect(plan.debtPayment).toBeNull()
    expect(plan.flow).toBeNull()
    expect(plan.income).toBeNull()
  })

  it('regresión negativa: la rama vieja de activo habría archivado un WITHDRAWAL', () => {
    // La misma edición sobre un BANCO (la rama que la deuda pisaba antes)
    // devuelve el flujo Dietz-visible: eso es lo que una deuda ya no puede
    // producir.
    const banco = { id: 'b1', type: 'Bank', quantity: 1, currentPrice: 4000, purchasePrice: 4000 }
    const plan = planCellEdit({ item: banco, oldValue: 4000, newValue: 3678.64, answer: ANSWER_FLOW, date: '2026-08-27' })
    expect(plan.flow).toMatchObject({ type: 'WITHDRAWAL', source: FLOW_SOURCE })
    expect(plan.flow.amount).toBeCloseTo(321.36, 10)
  })
})

describe('el pago desde la Hoja, contra los motores REALES', () => {
  const tx = buildSheetDebtPaymentTransaction({ debtItem: DEUDA, amount: 321.36, date: '2026-08-27' })

  it('lleva la forma compartida: _debtItemId, sin origen, con nonce de unicidad', () => {
    expect(tx.type).toBe('TRANSFER')
    expect(tx._debtItemId).toBe('d1')
    expect(tx._originItemId).toBeUndefined()
    expect(tx._toAmount).toBe(321.36)
    expect(tx._toCurrency).toBe('USD')
    // El prefijo "manual" es lo que hace que addTransaction agregue el nonce:
    // dos pagos iguales el mismo día no pueden colapsar en un documento.
    expect(tx._source).toBe('manual_debt_payment')
    expect(tx._txNonce).toBeTruthy()
  })

  it('el rebobinado congelado lo entiende: la deuda debía MÁS antes del pago', () => {
    // indexBalanceEvents (⛔ lógica congelada F, NO tocada: esto prueba un
    // INPUT nuevo contra el comportamiento que ya tiene) empuja −aplicado en
    // la deuda: el rebobinado (val -= amount para eventos posteriores) la
    // SUBE hacia atrás.
    const { balanceEventsById } = indexBalanceEvents([{ ...tx, id: 't1' }], [DEUDA], null, 'USD')
    expect(balanceEventsById.d1).toHaveLength(1)
    expect(balanceEventsById.d1[0].amount).toBeCloseTo(-321.36, 6)
  })

  it('borrarlo tiene reversa: SUBE la deuda, y el origen ausente no bloquea nada', () => {
    const plan = transferReversalPlan({ ...tx, id: 't1' }, [DEUDA])
    expect(plan).toBeTruthy()
    expect(plan.to.id).toBe('d1')
    // Revertir un pago de deuda es volver a deberlo (la regla de FASE KY).
    expect(plan.to.after).toBeCloseTo(plan.to.before + 321.36, 6)
    expect(plan.missing).not.toContain('from')
    expect(plan.refused).toHaveLength(0)
  })
})

// ── Parte 2: el préstamo nuevo deja de leerse como pérdida ─────────────────
//
// El bug medido en el YTD real del usuario: el bloque del depósito de apertura
// no tenía guard de deuda, así que crear un préstamo escribía un DEPOSIT de
// "dinero nuevo" por el saldo completo. Para el Dietz eso es patrimonio que
// bajó B con un flujo de +B: una "pérdida" de 2B (crear la deuda de 4,000 se
// leyó como perder 8,000).

import { buildLoanProceedsTransaction, buildLoanProceedsOutsideTransaction } from '../transferTx'
import { computeModifiedDietz } from '../../components/dashboard/utils'
import { computeYtdInvested } from '../ytdInvested'

const CUENTA = { id: 'a1', name: 'Cuenta Monetaria', type: 'Bank', currency: 'USD', quantity: 1, currentPrice: 10000, purchasePrice: 10000 }

describe('el registro del dinero del préstamo', () => {
  it('a una cuenta registrada: TRANSFER con la deuda en campo propio', () => {
    const tx = buildLoanProceedsTransaction({ debtItem: DEUDA, toItem: CUENTA, amount: 4000, date: '2026-08-25' })
    expect(tx.type).toBe('TRANSFER')
    expect(tx._linkedItemId).toBe('a1')
    expect(tx._loanItemId).toBe('d1')
    // NUNCA _originItemId con la deuda: la reversa "devolvería" el monto a la
    // deuda subiéndola, y el rebobinado la reconstruiría al revés.
    expect(tx._originItemId).toBeUndefined()
    expect(tx._source).toBe('manual_loan_proceeds')
  })

  it('fuera de la app: WITHDRAWAL que netea el Dietz', () => {
    const tx = buildLoanProceedsOutsideTransaction({ debtItem: DEUDA, amount: 4000, date: '2026-08-25' })
    expect(tx.type).toBe('WITHDRAWAL')
    expect(tx._linkedItemId).toBe('d1')
    expect(tx.totalAmount).toBe(4000)
    expect(tx._source).toBe('manual_loan_proceeds')
  })
})

describe('el Dietz del año, con la deuda nueva', () => {
  // Portafolio de 20,000 quieto todo el año; el 25 de agosto entra una deuda
  // de 4,000. Sin ningún registro (o con el registro viejo) el año se lee como
  // pérdida; con el registro nuevo, el retorno es CERO, que es la verdad.
  const args = { startValue: 20000, startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 11, 31), baseCurrency: 'USD' }

  it('regresión negativa: el DEPOSIT de apertura viejo producía una pérdida de 2B', () => {
    const viejo = { type: 'DEPOSIT', date: '2026-08-25', totalAmount: 4000, currency: 'USD', _linkedItemId: 'd1', _source: 'manual_new_account' }
    const r = computeModifiedDietz({ ...args, endValue: 16000, transactions: [viejo] })
    expect(r.abs).toBeCloseTo(-8000, 6)
  })

  it('sin ningún registro, la deuda nueva se lee como pérdida de B', () => {
    const r = computeModifiedDietz({ ...args, endValue: 16000, transactions: [] })
    expect(r.abs).toBeCloseTo(-4000, 6)
  })

  it('con el registro nuevo, pedir prestado no es perder: ganancia CERO', () => {
    const tx = buildLoanProceedsOutsideTransaction({ debtItem: DEUDA, amount: 4000, date: '2026-08-25' })
    const r = computeModifiedDietz({ ...args, endValue: 16000, transactions: [tx] })
    expect(r.abs).toBeCloseTo(0, 6)
  })

  it('llegando a una cuenta registrada, el TRANSFER es invisible y el neto ya es cero', () => {
    // La cuenta sube 4,000 y la deuda resta 4,000: endValue no cambia, y el
    // TRANSFER no es flujo Dietz.
    const tx = buildLoanProceedsTransaction({ debtItem: DEUDA, toItem: CUENTA, amount: 4000, date: '2026-08-25' })
    const r = computeModifiedDietz({ ...args, endValue: 20000, transactions: [tx] })
    expect(r.abs).toBeCloseTo(0, 6)
  })
})

describe('pedir prestado no es invertir', () => {
  it('el registro del préstamo no toca el invertido del año', () => {
    const conPrestamo = [
      { type: 'DEPOSIT', date: '2026-02-01', totalAmount: 1000, currency: 'USD', _linkedItemId: 'a1', _source: 'manual_contribution' },
      buildLoanProceedsOutsideTransaction({ debtItem: DEUDA, amount: 4000, date: '2026-08-25' }),
    ]
    const r = computeYtdInvested({ transactions: conPrestamo, items: [DEUDA, CUENTA], year: 2026, baseCurrency: 'USD' })
    // Solo el aporte real de 1,000: el WITHDRAWAL del préstamo no resta.
    expect(r.invested).toBeCloseTo(1000, 6)
  })

  // ACTUALIZADO en FASE LV, anotado (correcto acá, a diferencia del candado de
  // 3.94%: fijaba el MECANISMO de entonces, no un invariante). El valor viejo
  // (-4000) afirmaba que solo el `_source` de manual_loan_proceeds excluía el
  // flujo; desde FASE LV cualquier flujo VINCULADO a una deuda queda fuera del
  // invertido, sea cual sea su _source, que es estrictamente más fuerte. El
  // invariante que queda: por deuda nunca entra, por activo siempre entra.
  it('un flujo vinculado a una deuda no toca el invertido, sea cual sea su _source', () => {
    const aDeuda = { type: 'WITHDRAWAL', date: '2026-08-25', totalAmount: 4000, currency: 'USD', _linkedItemId: 'd1', _source: 'otra_cosa' }
    const aActivo = { type: 'WITHDRAWAL', date: '2026-08-25', totalAmount: 4000, currency: 'USD', _linkedItemId: 'a1', _source: 'otra_cosa' }
    const r = computeYtdInvested({ transactions: [aDeuda], items: [DEUDA, CUENTA], year: 2026, baseCurrency: 'USD' })
    expect(r.invested).toBeCloseTo(0, 6)
    const r2 = computeYtdInvested({ transactions: [aActivo], items: [DEUDA, CUENTA], year: 2026, baseCurrency: 'USD' })
    expect(r2.invested).toBeCloseTo(-4000, 6)
  })
})

describe('los registros del préstamo son inertes para la reconstrucción de la deuda', () => {
  it('el TRANSFER de desembolso solo empuja el evento de la CUENTA', () => {
    const tx = buildLoanProceedsTransaction({ debtItem: DEUDA, toItem: CUENTA, amount: 4000, date: '2026-08-25' })
    const { balanceEventsById } = indexBalanceEvents([{ ...tx, id: 'p1' }], [DEUDA, CUENTA], null, 'USD')
    expect(balanceEventsById.a1).toHaveLength(1)
    expect(balanceEventsById.a1[0].amount).toBeCloseTo(4000, 6)
    // La deuda NO recibe ningún evento: su pasado lo gobierna su fecha de alta.
    expect(balanceEventsById.d1).toBeUndefined()
  })
})

// ── Guardián de FUENTE ─────────────────────────────────────────────────────
//
// El guard vive en handleSubmit de AddAccountModal, inalcanzable en jest sin
// montar el modal entero (el precedente de moneyInputs.test.js y de
// ibkrImportGate.test.js: el confirm se fija leyendo el archivo). Sin esto,
// quitar `!item.isDebt` del depósito de apertura no tumba ningún test y el
// bug de la "pérdida de 2B" vuelve en silencio.
describe('guardián: el alta de una deuda en AddAccountModal', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require('path').join(__dirname, '../../components/AddAccountModal.jsx'), 'utf8')

  it('el depósito de apertura JAMÁS se escribe para una deuda', () => {
    expect(src).toContain('if (isNewMoney && !item.isDebt && onAddTransaction && singleDeposit > 0)')
  })

  it('la deuda escribe su propio registro de proceeds, con la escotilla explícita', () => {
    expect(src).toContain("loanProceeds !== 'none'")
    expect(src).toContain('buildLoanProceedsOutsideTransaction({ debtItem: debtForTx')
    expect(src).toContain('buildLoanProceedsTransaction({ debtItem: debtForTx')
  })
})
