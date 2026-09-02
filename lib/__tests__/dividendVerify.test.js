import { verifyItemIncome, verifyIncomeForItems, REASONS } from '@/lib/dividendVerify'
import { getDividendIncomeByItem } from '@/components/dashboard/utils'
import { analyzeDataCompleteness } from '@/lib/dataCompleteness'

const NOW = Date.parse('2026-09-02')
const DAY = 86400000
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10)

const msft = {
  id: 'ms1',
  symbol: 'MSFT',
  name: 'MICROSOFT CORP',
  type: 'Stock',
  quantity: 100,
  currency: 'USD',
  _source: 'ibkr',
}

// Forma EXACTA que escribe lib/ibkrSync.js para un dividendo del Flex: símbolo,
// `_ibkrTxnId`, `_source`, y NINGÚN `_linkedItemId`.
const ibkrDiv = (amount, days, extra = {}) => ({
  type: 'DIVIDEND',
  symbol: 'MSFT',
  description: 'MSFT CASH DIVIDEND',
  date: daysAgo(days),
  quantity: 1,
  pricePerUnit: amount,
  totalAmount: amount,
  commission: 0,
  currency: 'USD',
  _ibkrAccountId: 'U123',
  _ibkrTxnId: `t${days}`,
  _source: 'ibkr',
  ...extra,
})

// Cuatro pagos trimestrales de 75 repartidos en el año = 300 al año.
const fourQuarters = [ibkrDiv(75, 350), ibkrDiv(75, 260), ibkrDiv(75, 170), ibkrDiv(75, 80)]

describe('verifyItemIncome: la segunda fuente es el ledger del broker', () => {
  test('ve un dividendo de IBKR aunque NO traiga _linkedItemId', () => {
    const res = verifyItemIncome({ item: msft, transactions: fourQuarters, projectedAnnual: 300, nowMs: NOW })
    expect(res.payments).toBe(4)
    expect(res.actual).toBe(300)
    expect(res.status).toBe('verified')
  })

  // ⛔ El control que explica por qué este módulo existe. La convención
  // CONGELADA (`getDividendIncomeByItem`) exige `_linkedItemId` a secas, así que
  // sobre las MISMAS filas no ve un solo centavo. Si alguien "unifica" el
  // emparejamiento de este módulo con aquella regla, la verificación se apaga
  // en silencio para toda posición de broker, que son justo las que tienen
  // segunda fuente.
  test('la regla congelada, sobre las MISMAS filas, no ve nada', () => {
    const frozen = getDividendIncomeByItem(fourQuarters, [msft], null, 'USD')
    expect(frozen.size).toBe(0)
  })

  test('mismatch cuando el declarado está fuera de banda por un factor', () => {
    // Declara 3,000 al año y el broker pagó 300: un decimal corrido.
    const res = verifyItemIncome({ item: msft, transactions: fourQuarters, projectedAnnual: 3000, nowMs: NOW })
    expect(res.status).toBe('mismatch')
    expect(res.actual).toBe(300)
    expect(res.projected).toBe(3000)
    expect(res.ratio).toBeCloseTo(0.1, 6)
  })

  test('mismatch también cuando el broker pagó MUCHO más de lo declarado', () => {
    const res = verifyItemIncome({ item: msft, transactions: fourQuarters, projectedAnnual: 60, nowMs: NOW })
    expect(res.status).toBe('mismatch')
    expect(res.ratio).toBeCloseTo(5, 6)
  })
})

describe('la banda es ancha a propósito: no gritar lobo', () => {
  // Un pagador trimestral cuyas fechas ex caen cerca del borde muestra CINCO
  // pagos en 365 días sin que nada esté mal. Con banda angosta esto sería un
  // aviso cada trimestre.
  test('cinco pagos trimestrales dentro de la ventana siguen siendo "verified"', () => {
    const five = [...fourQuarters, ibkrDiv(75, 360)]
    const res = verifyItemIncome({ item: msft, transactions: five, projectedAnnual: 300, nowMs: NOW })
    expect(res.payments).toBe(5)
    expect(res.ratio).toBeCloseTo(1.25, 6)
    expect(res.status).toBe('verified')
  })

  test('tres pagos (el borde del otro lado) tampoco disparan', () => {
    const three = [ibkrDiv(75, 350), ibkrDiv(75, 260), ibkrDiv(75, 170)]
    const res = verifyItemIncome({ item: msft, transactions: three, projectedAnnual: 300, nowMs: NOW })
    expect(res.ratio).toBeCloseTo(0.75, 6)
    expect(res.status).toBe('verified')
  })

  test('una diferencia chiquita en dinero no se reporta aunque el ratio se salga', () => {
    // Ratio 0.5 pero son 10 dólares: no vale el aviso.
    const tiny = [{ ...ibkrDiv(10, 350) }]
    const res = verifyItemIncome({ item: msft, transactions: tiny, projectedAnnual: 20, nowMs: NOW })
    expect(res.ratio).toBeCloseTo(0.5, 6)
    expect(res.status).toBe('verified')
  })
})

describe('rehúsa antes que inventar', () => {
  test('sin proyección no hay nada que verificar', () => {
    const res = verifyItemIncome({ item: msft, transactions: fourQuarters, projectedAnnual: 0, nowMs: NOW })
    expect(res.status).toBe('unverifiable')
    expect(res.reason).toBe(REASONS.NO_PROJECTION)
  })

  test('una cuenta que REINVIERTE no tiene efectivo que comparar', () => {
    const res = verifyItemIncome({
      item: { ...msft, dividendAction: 'reinvest' },
      transactions: fourQuarters, projectedAnnual: 300, nowMs: NOW,
    })
    expect(res.reason).toBe(REASONS.REINVESTED)
  })

  test('sin un solo pago en el archivo no hay segunda fuente', () => {
    const res = verifyItemIncome({ item: msft, transactions: [], projectedAnnual: 300, nowMs: NOW })
    expect(res.reason).toBe(REASONS.NO_PAYMENTS)
  })

  // El caso que produciría el falso positivo más común: una posición comprada
  // hace tres meses cobró un trimestre y el año proyectado la haría ver como si
  // le faltara el 75% de su rendimiento.
  test('historial más corto que el año NO se compara contra una proyección anual', () => {
    const recent = [ibkrDiv(75, 40)]
    const res = verifyItemIncome({ item: msft, transactions: recent, projectedAnnual: 300, nowMs: NOW })
    expect(res.status).toBe('unverifiable')
    expect(res.reason).toBe(REASONS.SHORT_HISTORY)
  })

  test('una compra dentro de la ventana cambia la cantidad y anula la comparación', () => {
    const withBuy = [...fourQuarters, { type: 'BUY', symbol: 'MSFT', date: daysAgo(120), totalAmount: 5000, currency: 'USD', _source: 'ibkr' }]
    const res = verifyItemIncome({ item: msft, transactions: withBuy, projectedAnnual: 3000, nowMs: NOW })
    expect(res.reason).toBe(REASONS.QUANTITY_CHANGED)
  })

  test('una venta también', () => {
    const withSell = [...fourQuarters, { type: 'SELL', symbol: 'MSFT', date: daysAgo(200), totalAmount: 5000, currency: 'USD', _source: 'ibkr' }]
    expect(verifyItemIncome({ item: msft, transactions: withSell, projectedAnnual: 3000, nowMs: NOW }).reason)
      .toBe(REASONS.QUANTITY_CHANGED)
  })

  test('una compra ANTERIOR a la ventana no estorba', () => {
    const oldBuy = [...fourQuarters, { type: 'BUY', symbol: 'MSFT', date: daysAgo(800), totalAmount: 5000, currency: 'USD', _source: 'ibkr' }]
    expect(verifyItemIncome({ item: msft, transactions: oldBuy, projectedAnnual: 300, nowMs: NOW }).status).toBe('verified')
  })

  test('dos activos con el mismo símbolo: el pago no se puede atribuir', () => {
    const res = verifyItemIncome({ item: msft, transactions: fourQuarters, projectedAnnual: 300, sharedSymbol: true, nowMs: NOW })
    expect(res.reason).toBe(REASONS.AMBIGUOUS_SYMBOL)
  })

  test('...salvo que ESE activo tenga sus pagos vinculados por id', () => {
    const linked = fourQuarters.map((t) => ({ ...t, _linkedItemId: 'ms1' }))
    const res = verifyItemIncome({ item: msft, transactions: linked, projectedAnnual: 300, sharedSymbol: true, nowMs: NOW })
    expect(res.status).toBe('verified')
  })
})

describe('signos y monedas', () => {
  test('un INTEREST pagado (margen) no cuenta como ingreso', () => {
    const margin = [
      ibkrDiv(300, 350),
      { type: 'INTEREST', symbol: 'MSFT', date: daysAgo(100), totalAmount: 500, _signedAmount: -500, currency: 'USD', _source: 'ibkr' },
    ]
    const res = verifyItemIncome({ item: msft, transactions: margin, projectedAnnual: 300, nowMs: NOW })
    expect(res.actual).toBe(300)
    expect(res.status).toBe('verified')
  })

  test('un INTEREST recibido SÍ cuenta', () => {
    const bond = { id: 'b1', symbol: 'BOND', name: 'Bono', currency: 'USD' }
    const txs = [{ type: 'INTEREST', symbol: 'BOND', date: daysAgo(340), totalAmount: 400, _signedAmount: 400, currency: 'USD' }]
    const res = verifyItemIncome({ item: bond, transactions: txs, projectedAnnual: 400, nowMs: NOW })
    expect(res.actual).toBe(400)
    expect(res.status).toBe('verified')
  })

  test('un pago en otra moneda se convierte a la del ítem antes de comparar', () => {
    const gbpItem = { id: 'sh1', symbol: 'SHEL', name: 'Shell', currency: 'USD' }
    // El broker pagó en GBP; la proyección está en USD.
    const txs = [{ type: 'DIVIDEND', symbol: 'SHEL', date: daysAgo(340), totalAmount: 200, currency: 'GBP' }]
    const convert = (a, from, to) => (from === 'GBP' && to === 'USD' ? a * 1.25 : a)
    const res = verifyItemIncome({ item: gbpItem, transactions: txs, projectedAnnual: 250, convert, nowMs: NOW })
    expect(res.actual).toBe(250)
    expect(res.status).toBe('verified')
    // Sin convertir habría dado 200/250 = 0.8: dentro de banda por casualidad,
    // pero con una moneda de otra escala (JPY) sería un mismatch inventado.
    const raw = verifyItemIncome({ item: gbpItem, transactions: txs, projectedAnnual: 250, nowMs: NOW })
    expect(raw.actual).toBe(200)
  })
})

describe('verifyIncomeForItems', () => {
  const projections = new Map([['ms1', 3000]])

  test('detecta el símbolo compartido solo, sin que el caller lo diga', () => {
    const twin = { ...msft, id: 'ms2' }
    const out = verifyIncomeForItems({
      items: [msft, twin], transactions: fourQuarters,
      projections: new Map([['ms1', 300], ['ms2', 300]]), nowMs: NOW,
    })
    expect(out.get('ms1').reason).toBe(REASONS.AMBIGUOUS_SYMBOL)
    expect(out.get('ms2').reason).toBe(REASONS.AMBIGUOUS_SYMBOL)
  })

  test('un solo activo con ese símbolo sí se verifica', () => {
    const out = verifyIncomeForItems({ items: [msft], transactions: fourQuarters, projections, nowMs: NOW })
    expect(out.get('ms1').status).toBe('mismatch')
  })

  test('sin mapa de proyecciones devuelve vacío, nunca adivina', () => {
    expect(verifyIncomeForItems({ items: [msft], transactions: fourQuarters, nowMs: NOW }).size).toBe(0)
  })

  test('una deuda no entra', () => {
    const debt = { id: 'd1', symbol: 'MSFT', isDebt: true }
    const out = verifyIncomeForItems({ items: [debt], transactions: fourQuarters, projections: new Map([['d1', 300]]), nowMs: NOW })
    expect(out.has('d1')).toBe(false)
  })
})

describe('el hallazgo en dataCompleteness', () => {
  const priced = { ...msft, quantity: 100, currentPrice: 400, purchasePrice: 300, acquisitionDate: '2023-01-05' }
  const run = (verification) => analyzeDataCompleteness({
    items: [priced], transactions: fourQuarters, convert: (a) => a,
    baseCurrency: 'USD', now: '2026-09-02', incomeVerification: verification,
  }).findings.map((f) => f.code)

  test('un mismatch se reporta AUNQUE el activo sea del broker', () => {
    // ⛔ Esta es la razón por la que el check va antes de la puerta que excluye
    // a los ítems de broker: en un ítem de IBKR el rendimiento no lo puso el
    // usuario, lo resolvió Yahoo, y el broker es la fuente que lo contradice.
    const v = new Map([['ms1', { status: 'mismatch', projected: 3000, actual: 300, payments: 4, ratio: 0.1 }]])
    expect(run(v)).toContain('income-mismatch')
  })

  test('un veredicto verificado no genera nada', () => {
    const v = new Map([['ms1', { status: 'verified', projected: 300, actual: 300, payments: 4, ratio: 1 }]])
    expect(run(v)).not.toContain('income-mismatch')
  })

  test('un rehúse tampoco: no se culpa al dato del usuario por un límite nuestro', () => {
    const v = new Map([['ms1', { status: 'unverifiable', reason: REASONS.SHORT_HISTORY }]])
    expect(run(v)).not.toContain('income-mismatch')
  })

  test('sin el mapa el motor se comporta igual que siempre', () => {
    expect(run(null)).not.toContain('income-mismatch')
  })

  test('el texto dice las DOS cifras y cuántos pagos, para poder juzgarlo sin abrir nada', () => {
    const v = new Map([['ms1', { status: 'mismatch', projected: 3000, actual: 300, payments: 4, ratio: 0.1 }]])
    const f = analyzeDataCompleteness({
      items: [priced], transactions: fourQuarters, convert: (a) => a,
      baseCurrency: 'USD', now: '2026-09-02', incomeVerification: v,
    }).findings.find((x) => x.code === 'income-mismatch')
    expect(f.textEs).toContain('3,000')
    expect(f.textEs).toContain('300')
    expect(f.textEs).toContain('4 pagos')
    expect(f.textEn).toContain('4 payments')
    expect(f.itemId).toBe('ms1')
  })
})
