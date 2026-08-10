import { buildTransferTransaction } from '../transferTx'

const from = { id: 'src', name: 'Fondo Líquido', symbol: 'FLIQ', currency: 'USD' }
const to = { id: 'dst', name: 'Banco Industrial', symbol: 'BI', currency: 'GTQ' }

describe('buildTransferTransaction', () => {
  test('names BOTH accounts, which is the whole point', () => {
    // Every consumer of a TRANSFER row keys on these two ids and nothing else.
    // The Transfer screen used to write neither, so its transfers were invisible
    // in both accounts and read as a gain for one and a loss for the other.
    const tx = buildTransferTransaction({ fromItem: from, toItem: to, amount: 250, date: '2026-04-01' })
    expect(tx._originItemId).toBe('src')
    expect(tx._linkedItemId).toBe('dst')
    expect(tx.type).toBe('TRANSFER')
    expect(tx.totalAmount).toBe(250)
    expect(tx.date).toBe('2026-04-01')
  })

  test('the source keeps its "manual" prefix, which is what earns the id nonce', () => {
    // addTransaction only adds a uniqueness nonce when the source starts with
    // "manual". Without one, two identical same-day transfers between the same
    // pair of accounts collapse onto one document id and the second overwrites
    // the first, silently.
    for (const source of [undefined, 'manual_cashflow']) {
      const tx = buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: '2026-04-01', source })
      expect(tx._source.startsWith('manual')).toBe(true)
    }
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: 'x' })._source)
      .toBe('manual_transfer')
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: 'x', source: 'manual_cashflow' })._source)
      .toBe('manual_cashflow')
  })

  test('the money leaves in the SENDING account currency', () => {
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: 'x' }).currency).toBe('USD')
    const noCur = { ...from, currency: null }
    expect(buildTransferTransaction({ fromItem: noCur, toItem: to, amount: 10, date: 'x', currency: 'GTQ' }).currency).toBe('GTQ')
    expect(buildTransferTransaction({ fromItem: noCur, toItem: to, amount: 10, date: 'x' }).currency).toBe('USD')
  })

  test('a typed description wins, otherwise it says where the money went', () => {
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: 'x', description: 'Pago renta' }).description)
      .toBe('Pago renta')
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 10, date: 'x' }).description)
      .toBe('Transfer: Fondo Líquido → Banco Industrial')
  })

  test('an account with no symbol still gets a usable one', () => {
    expect(buildTransferTransaction({ fromItem: { ...from, symbol: '' }, toItem: to, amount: 10, date: 'x' }).symbol)
      .toBe('TRANSFER')
  })

  test('refuses to build a record that would not describe a real movement', () => {
    expect(buildTransferTransaction({ fromItem: from, toItem: null, amount: 10, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: null, toItem: to, amount: 10, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 0, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: -5, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: from, toItem: to, amount: 'abc', date: 'x' })).toBeNull()
  })
})
