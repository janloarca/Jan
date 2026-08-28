import { buildContributionFields, isBankLikeItem } from '../contributions'
import { getItemValue } from '@/components/dashboard/utils'

describe('isBankLikeItem', () => {
  it('treats banks as bank-like regardless of quantity', () => {
    expect(isBankLikeItem({ type: 'Bank', quantity: 5 })).toBe(true)
    expect(isBankLikeItem({ type: 'banco', quantity: 1 })).toBe(true)
  })

  it('treats non-market qty-1 assets (bonds, alternatives) as bank-like', () => {
    expect(isBankLikeItem({ type: 'Bond', quantity: 1 })).toBe(true)
    expect(isBankLikeItem({ type: 'Alternative' })).toBe(true) // qty defaults to 1
  })

  it('treats market assets as share-based', () => {
    expect(isBankLikeItem({ type: 'Stock', quantity: 1 })).toBe(false)
    expect(isBankLikeItem({ type: 'Crypto', quantity: 0.5 })).toBe(false)
    expect(isBankLikeItem({ type: 'ETF', quantity: 10 })).toBe(false)
  })

  it('treats multi-quantity bonds as share-based', () => {
    expect(isBankLikeItem({ type: 'Bond', quantity: 3 })).toBe(false)
  })
})

describe('buildContributionFields — bank-like (balance) assets', () => {
  const bank = { type: 'Bank', quantity: 1, purchasePrice: 5000, currentPrice: 5000 }

  it('add shifts both balance fields up', () => {
    const { itemFields, newLot, lotClose } = buildContributionFields({
      item: bank, amount: 1500, date: '2024-12-15', isAdd: true, currency: 'GTQ',
    })
    expect(itemFields).toEqual({ purchasePrice: 6500, currentPrice: 6500 })
    expect(newLot).toBeUndefined()
    expect(lotClose).toBeUndefined()
  })

  // FASE LY: al VACIAR se escribe también `quantity: 0`, espejo exacto de
  // `balanceFields` (lib/transferFields.js). No es una regresión: el valor
  // esperado viejo describía el defecto que el usuario reportó con captura (el
  // saldo VOLVÍA después de vaciar la cuenta, porque con los dos precios en
  // cero `getItemPrice` cae en cascada a un residuo en `price`/`cost` y lo
  // resucita). El desplazamiento de los dos campos de precio, que es lo que
  // este test existe para fijar, no se movió.
  it('withdraw shifts both balance fields down, floored at 0 (and empties the quantity)', () => {
    const { itemFields } = buildContributionFields({
      item: bank, amount: 8000, date: '2025-01-01', isAdd: false,
    })
    expect(itemFields).toEqual({ purchasePrice: 0, currentPrice: 0, quantity: 0 })
  })

  // El caso real de la captura: vaciar deja un residuo vivo en `cost`, y sin la
  // cantidad en cero el saldo resucita al leerse.
  it('vaciar no puede dejar el saldo resucitando por un residuo en price/cost', () => {
    const conResiduo = { ...bank, price: 5000, cost: 5000 }
    const { itemFields } = buildContributionFields({
      item: conResiduo, amount: 8000, date: '2025-01-01', isAdd: false,
    })
    expect(getItemValue({ ...conResiduo, ...itemFields })).toBe(0)
  })

  // El síntoma "cambié el valor y no se guarda": la cantidad guardada es CERO,
  // así que el saldo se escribía en el precio y la app lo leía como 0 × precio.
  it('una cantidad inservible se normaliza para que el saldo se pueda leer', () => {
    const rota = { type: 'Bank', quantity: 0, purchasePrice: 240, currentPrice: 240 }
    expect(getItemValue(rota)).toBe(0) // el sintoma
    const { itemFields } = buildContributionFields({
      item: rota, amount: 300, date: '2026-08-28', isAdd: true,
    })
    expect(itemFields.quantity).toBe(1)
    expect(getItemValue({ ...rota, ...itemFields })).toBe(540)
  })

  // ⛔ Y una cantidad LEGÍTIMA distinta de 1 se deja intacta: normalizarla le
  // cambiaría el valor al ítem sin que se moviera un centavo. Esta rama no sabe
  // expresarla y por eso `canRecordFlow` rehúsa esos ítems (FASE JJ3).
  it('una cantidad legitima distinta de 1 NO se toca', () => {
    const qty2 = { type: 'Bank', quantity: 2, purchasePrice: 500, currentPrice: 500 }
    const { itemFields } = buildContributionFields({
      item: qty2, amount: 300, date: '2026-08-28', isAdd: true,
    })
    expect(itemFields.quantity).toBeUndefined()
  })

  it('preserves a market-value gap on static assets (bond above cost)', () => {
    const bond = { type: 'Bond', quantity: 1, purchasePrice: 10000, currentPrice: 10500 }
    const { itemFields } = buildContributionFields({
      item: bond, amount: 1000, date: '2025-02-01', isAdd: true,
    })
    // Cost basis and value each move by the amount — the 500 gain is not erased.
    expect(itemFields).toEqual({ purchasePrice: 11000, currentPrice: 11500 })
  })

  it('falls back to purchasePrice when currentPrice is missing', () => {
    const cd = { type: 'CDT', quantity: 1, purchasePrice: 2000 }
    const { itemFields } = buildContributionFields({
      item: cd, amount: 500, date: '2025-03-01', isAdd: true,
    })
    expect(itemFields).toEqual({ purchasePrice: 2500, currentPrice: 2500 })
  })
})

describe('buildContributionFields — share-based assets', () => {
  const stock = {
    type: 'Stock', quantity: 10, purchasePrice: 90, currentPrice: 100,
    symbol: 'voo', institution: 'IBKR',
  }

  it('add converts amount to shares at current price and creates a dated lot', () => {
    const { itemFields, newLot } = buildContributionFields({
      item: stock, amount: 500, date: '2024-12-15', isAdd: true, currency: 'USD',
    })
    expect(itemFields.quantity).toBeCloseTo(15)
    expect(newLot).toEqual({
      symbol: 'VOO',
      quantity: 5,
      costBasis: 100,
      currency: 'USD',
      acquisitionDate: '2024-12-15',
      institution: 'IBKR',
    })
  })

  it('withdraw converts amount to shares and emits a FIFO lot close', () => {
    const { itemFields, lotClose } = buildContributionFields({
      item: stock, amount: 300, date: '2025-05-10', isAdd: false,
    })
    expect(itemFields.quantity).toBeCloseTo(7)
    expect(lotClose).toEqual({
      symbol: 'VOO', qty: 3, price: 100, date: '2025-05-10', institution: 'IBKR',
    })
  })

  it('withdraw floors quantity at 0 and never goes negative', () => {
    const { itemFields, lotClose } = buildContributionFields({
      item: stock, amount: 5000, date: '2025-05-10', isAdd: false,
    })
    expect(itemFields.quantity).toBe(0)
    expect(lotClose.qty).toBeCloseTo(50)
  })

  it('uses purchasePrice as unit price when currentPrice is missing', () => {
    const noPrice = { type: 'Fund', quantity: 2, purchasePrice: 50, symbol: 'x' }
    const { itemFields, newLot } = buildContributionFields({
      item: noPrice, amount: 100, date: '2025-01-01', isAdd: true,
    })
    expect(itemFields.quantity).toBeCloseTo(4)
    expect(newLot.costBasis).toBe(50)
  })

  it('defaults lot currency to the item currency, then USD', () => {
    const eur = { ...stock, currency: 'EUR' }
    expect(buildContributionFields({ item: eur, amount: 100, date: '2025-01-01', isAdd: true }).newLot.currency).toBe('EUR')
    expect(buildContributionFields({ item: stock, amount: 100, date: '2025-01-01', isAdd: true }).newLot.currency).toBe('USD')
  })
})
