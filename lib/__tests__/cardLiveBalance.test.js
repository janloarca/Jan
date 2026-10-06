import { liveCardAdditions } from '../cardLiveBalance'

const card = (o = {}) => ({ id: 'c1', isDebt: true, cardKey: 'bi:9856', currency: 'GTQ', balanceAsOf: '2026-08-16', ...o })
const tx = (o = {}) => ({ type: 'EXPENSE', amount: 100, currency: 'GTQ', date: '2026-08-20', last4: '9856', _source: 'auto_shortcut', ...o })

describe('liveCardAdditions', () => {
  test('suma compras capturadas posteriores al corte de la tarjeta con esos 4 dígitos', () => {
    const r = liveCardAdditions([card()], [tx(), tx({ amount: 50.5 })])
    expect(r.byItemId.c1).toEqual({ amount: 150.5, count: 2 })
  })
  test('ignora compras anteriores o iguales al corte (ya están en el saldo)', () => {
    expect(liveCardAdditions([card()], [tx({ date: '2026-08-16' }), tx({ date: '2026-08-01' })]).byItemId.c1).toBeUndefined()
  })
  test('ignora filas importadas de un estado (no auto_*)', () => {
    expect(liveCardAdditions([card()], [tx({ _source: 'card_import' })]).byItemId.c1).toBeUndefined()
  })
  test('sin last4 no se asigna a ninguna tarjeta y se reporta', () => {
    const r = liveCardAdditions([card()], [tx({ last4: undefined })])
    expect(r.byItemId.c1).toBeUndefined()
    expect(r.unassigned.GTQ).toEqual({ amount: 100, count: 1 })
  })
  test('dos tarjetas con los mismos 4 dígitos y moneda: ambiguo, nadie la reclama', () => {
    const r = liveCardAdditions([card(), card({ id: 'c2', cardKey: 'bac:9856' })], [tx()])
    expect(r.byItemId).toEqual({})
    expect(r.unassigned.GTQ.count).toBe(1)
  })
  test('otra moneda no se convierte ni se suma', () => {
    expect(liveCardAdditions([card()], [tx({ currency: 'USD' })]).byItemId.c1).toBeUndefined()
  })
  test('ingresos y filas neteadas no suman', () => {
    expect(liveCardAdditions([card()], [tx({ type: 'INCOME' }), tx({ _nettedTransfer: true })]).byItemId.c1).toBeUndefined()
  })
})
