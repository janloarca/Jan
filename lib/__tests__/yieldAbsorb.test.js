/**
 * FASE PZ: corregir el mes en curso no mueve los meses cerrados.
 *
 * El caso del usuario: septiembre 5,015 y octubre 5,032; el saldo real hoy es
 * 5,023. Sin absorber, septiembre pasaba a 5,006. Los tests de punta a punta
 * corren la reconstrucción REAL (`getHistoricalItemValues`), no una copia.
 */
jest.mock('../authFetch', () => ({
  authFetch: jest.fn(),
  safeJson: (res) => res.json(),
}))

import {
  lastClosedMonthEndISO, planYieldAbsorption, applyAbsorptionToTransactions,
} from '../yieldAbsorb'
import { getHistoricalItemValues } from '../historicalValues'
import { planCellEdit, ANSWER_CORRECTION } from '../spreadsheetEdit'

const ITEM = {
  id: 'fund', name: 'Fondo', symbol: 'FONDO', type: 'Bank', currency: 'USD', institution: 'Banco',
  quantity: 1, currentPrice: 5032, purchasePrice: 5000, _category: 'cash',
  acquisitionDate: '2026-01-02', createdAt: '2026-01-02T00:00:00.000Z', balanceAsOf: '2026-10-08',
}
const OPEN = { id: 'open', type: 'DEPOSIT', date: '2026-01-02', totalAmount: 5000, currency: 'USD', symbol: 'FONDO', _linkedItemId: 'fund', _source: 'manual_new_account' }
const yieldTx = (id, date, amount, source = 'inferred_yield') => ({
  id, type: 'DIVIDEND', date, totalAmount: amount, currency: 'USD', symbol: 'FONDO',
  _linkedItemId: 'fund', _source: source, _reinvested: true,
})

const MONTHS = ['2026-08', '2026-09', '2026-10']
const valueOf = (res, mk) => res[mk]?.fund?.value ?? res[mk]?.fund

describe('lastClosedMonthEndISO', () => {
  it('es el último día del mes anterior', () => {
    expect(lastClosedMonthEndISO('2026-10-08')).toBe('2026-09-30')
    expect(lastClosedMonthEndISO('2026-03-01')).toBe('2026-02-28')
    expect(lastClosedMonthEndISO('2026-01-15')).toBe('2025-12-31')
  })
  it('sin fecha legible no inventa nada', () => {
    expect(lastClosedMonthEndISO('')).toBeNull()
  })
})

describe('planYieldAbsorption', () => {
  const end = '2026-09-30'
  const txs = [yieldTx('sep', '2026-09-30', 16), yieldTx('oct', '2026-10-08', 17)]

  it('una baja se resta del evento del mes en curso', () => {
    const p = planYieldAbsorption({ transactions: txs, item: ITEM, delta: -9, lastClosedEnd: end })
    expect(p.updates).toEqual([{ id: 'oct', totalAmount: 8 }])
    expect(p.deletes).toEqual([])
    expect(p.spill).toBe(0)
  })

  it('nunca toca un evento de un mes ya cerrado', () => {
    const p = planYieldAbsorption({ transactions: txs, item: ITEM, delta: -40, lastClosedEnd: end })
    expect(p.updates).toEqual([])
    expect(p.deletes).toEqual(['oct'])
    // 17 cupieron, 23 no: ese sobrante SÍ mueve el pasado y se dice.
    expect(p.spill).toBe(-23)
    expect(p.absorbed).toBe(-17)
  })

  it('un evento que llega a cero se borra, no queda en 0.00', () => {
    const p = planYieldAbsorption({ transactions: txs, item: ITEM, delta: -17, lastClosedEnd: end })
    expect(p.deletes).toEqual(['oct'])
    expect(p.updates).toEqual([])
    expect(p.spill).toBe(0)
  })

  it('va del más nuevo al más viejo cuando hay varios en el mes', () => {
    const two = [yieldTx('a', '2026-10-02', 5, 'manual_yield'), yieldTx('b', '2026-10-08', 4)]
    const p = planYieldAbsorption({ transactions: two, item: ITEM, delta: -6, lastClosedEnd: end })
    expect(p.deletes).toEqual(['b'])
    expect(p.updates).toEqual([{ id: 'a', totalAmount: 3 }])
  })

  it('una subida se suma al evento más nuevo', () => {
    const p = planYieldAbsorption({ transactions: txs, item: ITEM, delta: 8, lastClosedEnd: end })
    expect(p.updates).toEqual([{ id: 'oct', totalAmount: 25 }])
    expect(p.spill).toBe(0)
  })

  it('sin eventos candidatos no hace nada ni avisa', () => {
    const p = planYieldAbsorption({ transactions: [OPEN], item: ITEM, delta: -9, lastClosedEnd: end })
    expect(p.hadCandidates).toBe(false)
    expect(p.updates).toEqual([])
    expect(p.deletes).toEqual([])
  })

  it('NO absorbe pagos del motor automático, depósitos ni otras monedas ni otros ítems', () => {
    const noise = [
      yieldTx('auto', '2026-10-08', 17, 'auto'),
      { ...yieldTx('eur', '2026-10-08', 17), currency: 'EUR' },
      { ...yieldTx('other', '2026-10-08', 17), _linkedItemId: 'otro' },
      { id: 'dep', type: 'DEPOSIT', date: '2026-10-08', totalAmount: 17, currency: 'USD', _linkedItemId: 'fund' },
    ]
    const p = planYieldAbsorption({ transactions: noise, item: ITEM, delta: -9, lastClosedEnd: end })
    expect(p.hadCandidates).toBe(false)
  })

  it('un delta de redondeo no escribe nada', () => {
    const p = planYieldAbsorption({ transactions: txs, item: ITEM, delta: -0.004, lastClosedEnd: end })
    expect(p.updates).toEqual([])
    expect(p.deletes).toEqual([])
  })
})

describe('punta a punta: septiembre se queda en su lugar', () => {
  const base = [OPEN, yieldTx('sep', '2026-09-30', 16), yieldTx('oct', '2026-10-08', 17)]

  const run = async (item, transactions) => {
    const res = await getHistoricalItemValues([item], MONTHS, null, 'USD', [], transactions, [])
    return res
  }

  it('REPRODUCE el bug: sin absorber, corregir octubre mueve septiembre', async () => {
    const before = await run(ITEM, base)
    const sepBefore = valueOf(before, '2026-09')
    expect(sepBefore).toBeCloseTo(5015, 2)

    // La corrección SIN tocar el evento (el comportamiento viejo).
    const plan = planCellEdit({ item: ITEM, oldValue: 5032, newValue: 5023, answer: ANSWER_CORRECTION })
    const after = await run({ ...ITEM, ...plan.patch }, base)
    expect(valueOf(after, '2026-09')).toBeCloseTo(5006, 2)
  })

  it('con la absorción, septiembre queda exactamente como estaba', async () => {
    const before = await run(ITEM, base)
    const sepBefore = valueOf(before, '2026-09')
    const augBefore = valueOf(before, '2026-08')

    const plan = planCellEdit({ item: ITEM, oldValue: 5032, newValue: 5023, answer: ANSWER_CORRECTION })
    const abs = planYieldAbsorption({ transactions: base, item: ITEM, delta: -9, lastClosedEnd: '2026-09-30' })
    const txs = applyAbsorptionToTransactions(base, abs)
    const after = await run({ ...ITEM, ...plan.patch }, txs)

    expect(valueOf(after, '2026-09')).toBeCloseTo(sepBefore, 2)
    expect(valueOf(after, '2026-08')).toBeCloseTo(augBefore, 2)
    expect(valueOf(after, '2026-10')).toBeCloseTo(5023, 2)
    expect(txs.find((t) => t.id === 'oct').totalAmount).toBe(8)
  })

  it('una subida también deja septiembre quieto', async () => {
    const before = await run(ITEM, base)
    const plan = planCellEdit({ item: ITEM, oldValue: 5032, newValue: 5040, answer: ANSWER_CORRECTION })
    const abs = planYieldAbsorption({ transactions: base, item: ITEM, delta: 8, lastClosedEnd: '2026-09-30' })
    const after = await run({ ...ITEM, ...plan.patch }, applyAbsorptionToTransactions(base, abs))
    expect(valueOf(after, '2026-09')).toBeCloseTo(valueOf(before, '2026-09'), 2)
  })
})
