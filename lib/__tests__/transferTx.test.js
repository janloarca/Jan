import { buildTransferTransaction, buildDebtPaymentTransaction, transferCredit } from '../transferTx'

// Las dos cuentas comparten moneda a propósito: estos casos prueban ids,
// descripción y fuente, no divisas. El fixture original tenía USD → GTQ sin
// querer, así que TODOS ejercitaban de refilón el camino entre monedas.
const from = { id: 'src', name: 'Fondo Líquido', symbol: 'FLIQ', currency: 'USD' }
const to = { id: 'dst', name: 'Banco Industrial', symbol: 'BI', currency: 'USD' }
// El caso real del usuario: quetzales saliendo hacia una cuenta en dólares.
const toGTQ = { id: 'dst', name: 'Banco Industrial', symbol: 'BI', currency: 'GTQ' }

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
    // Sin moneda en el ítem manda la que se pasa por parámetro, y en ese caso
    // las dos puntas quedan en GTQ, o sea no es una transferencia cruzada.
    expect(buildTransferTransaction({ fromItem: noCur, toItem: toGTQ, amount: 10, date: 'x', currency: 'GTQ' }).currency).toBe('GTQ')
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

// ⛔ El bug reportado por el usuario (24 ago 2026) sobre una transferencia REAL.
//
// Movió Q2,500 de un fondo líquido en quetzales a su cuenta monetaria en
// dólares y la cuenta destino subió $2,500: el registro guardaba UN monto y UNA
// moneda, y las dos pantallas hacían `destino += monto` con el monto del
// ORIGEN. Su saldo pasó de 5,350 a 8,092, que es exactamente
// 5,350 + 2,500 + 242 (los quetzales acreditados como dólares mas un segundo
// traslado de $242 que sí era en dólares).
describe('una transferencia entre monedas tiene DOS montos', () => {
  const gtq = { id: 'fliq-q', name: 'Fondo Líquido Q', symbol: 'FLQ', currency: 'GTQ' }
  const usd = { id: 'bi', name: 'Banco Industrial', symbol: 'BI', currency: 'USD' }

  test('guarda lo que salio Y lo que entro, cada uno con su moneda', () => {
    const tx = buildTransferTransaction({
      fromItem: gtq, toItem: usd, amount: 2500, toAmount: 324.5, date: '2026-08-24',
    })
    expect(tx.totalAmount).toBe(2500)
    expect(tx.currency).toBe('GTQ')
    expect(tx._toAmount).toBe(324.5)
    expect(tx._toCurrency).toBe('USD')
  })

  test('la tasa se DERIVA, nunca es la fuente', () => {
    const tx = buildTransferTransaction({
      fromItem: gtq, toItem: usd, amount: 2500, toAmount: 324.5, date: 'x',
    })
    expect(tx._fxRate).toBeCloseTo(324.5 / 2500, 10)
  })

  // Sin saber cuánto llegó no hay forma HONESTA de registrarla: acreditar el
  // monto del origen es exactamente el bug. Refusar obliga a que la pantalla
  // pregunte, que es lo que ahora hace.
  test('sin el monto recibido REHUSA en vez de acreditar el del origen', () => {
    expect(buildTransferTransaction({ fromItem: gtq, toItem: usd, amount: 2500, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: gtq, toItem: usd, amount: 2500, toAmount: 0, date: 'x' })).toBeNull()
    expect(buildTransferTransaction({ fromItem: gtq, toItem: usd, amount: 2500, toAmount: 'abc', date: 'x' })).toBeNull()
  })

  test('con la MISMA moneda no hace falta preguntar nada', () => {
    const tx = buildTransferTransaction({ fromItem: usd, toItem: { ...usd, id: 'otra' }, amount: 100, date: 'x' })
    expect(tx.totalAmount).toBe(100)
    expect(tx._toAmount).toBe(100)
    expect(tx._toCurrency).toBe('USD')
    // Sin tasa: no hubo conversión que describir.
    expect(tx._fxRate).toBeUndefined()
  })
})

// La regla de "cuánto le llegó al destino", en UN solo lugar. Sin esto, cada
// consumidor tendría que acordarse del respaldo para las filas viejas, y el
// primero que se olvide vuelve a acreditar quetzales como dólares.
describe('transferCredit', () => {
  test('usa el monto RECIBIDO cuando existe', () => {
    expect(transferCredit({ totalAmount: 2500, currency: 'GTQ', _toAmount: 324.5, _toCurrency: 'USD' }))
      .toEqual({ amount: 324.5, currency: 'USD' })
  })

  test('una fila VIEJA cae al monto del origen: es lo correcto para ella', () => {
    // Se escribió cuando las dos cuentas se asumían en la misma moneda, así que
    // ese ES su monto de destino.
    expect(transferCredit({ totalAmount: 250, currency: 'USD' }))
      .toEqual({ amount: 250, currency: 'USD' })
  })

  test('un _toAmount invalido no puede desviar el credito', () => {
    for (const bad of [0, -1, 'x', null, undefined, NaN]) {
      expect(transferCredit({ totalAmount: 250, currency: 'USD', _toAmount: bad, _toCurrency: 'GTQ' }))
        .toEqual({ amount: 250, currency: 'USD' })
    }
  })
})

// El id del documento sale de fecha+simbolo+tipo+centavos, y eso NO identifica
// una transferencia. Sin nonce, dos movimientos reales del mismo dia entre el
// mismo par de cuentas colapsan en un solo doc y el segundo se pierde en
// silencio; y un pago de deuda choca con una transferencia del mismo monto.
describe('_txNonce: dos transferencias reales no se pisan', () => {
  const docId = (tx) => {
    const amt = Math.round((tx.totalAmount || 0) * 100)
    const base = `${tx.date || 'nodate'}-${(tx.symbol || 'nosym').toUpperCase()}-${tx.type || 'tx'}-${amt}`
    return tx._txNonce ? `${base}-${tx._txNonce}` : base
  }
  const deuda = { id: 'debt', name: 'Hipoteca', symbol: 'MTG', currency: 'USD' }

  test('dos transferencias identicas del mismo dia dan ids DISTINTOS', () => {
    const a = buildTransferTransaction({ fromItem: from, toItem: to, amount: 250, date: '2026-04-01' })
    const b = buildTransferTransaction({ fromItem: from, toItem: to, amount: 250, date: '2026-04-01' })
    expect(a._txNonce).toBeTruthy()
    expect(b._txNonce).toBeTruthy()
    expect(docId(a)).not.toBe(docId(b))
  })

  test('el MISMO objeto reintentado conserva su id', () => {
    const tx = buildTransferTransaction({ fromItem: from, toItem: to, amount: 250, date: '2026-04-01' })
    expect(docId(tx)).toBe(docId(tx))
  })

  test('un pago de deuda no choca con una transferencia del mismo monto', () => {
    const t = buildTransferTransaction({ fromItem: from, toItem: to, amount: 500, date: '2026-04-01' })
    const p = buildDebtPaymentTransaction({ fromItem: from, debtItem: deuda, amount: 500, date: '2026-04-01' })
    expect(docId(t)).not.toBe(docId(p))
  })

  // Todo lo demas que pasa por txDocId (ventas, aportes) no lleva nonce y
  // conserva su id de siempre, byte-identico.
  test('sin nonce el id es el de siempre', () => {
    expect(docId({ date: '2026-04-01', symbol: 'FLIQ', type: 'SELL', totalAmount: 250 }))
      .toBe('2026-04-01-FLIQ-SELL-25000')
  })
})
