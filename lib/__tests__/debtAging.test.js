import { buildDebtAging, isCardPayment, isCardCharge, cardOfRow } from '../debtAging'

const NOW = Date.parse('2026-08-31T12:00:00Z')

const charge = (date, amount, over = {}) => ({
  date, amount, currency: 'GTQ', type: 'EXPENSE', kind: 'purchase',
  description: `compra ${date}`, source: 'card_import', cardKey: 'bi:9856', ...over,
})
const payment = (date, amount, over = {}) => ({
  date, amount, currency: 'GTQ', type: 'INCOME', kind: 'payment', category: 'Salario',
  description: 'GRACIAS POR SU PAGO', source: 'card_import', cardKey: 'bi:9856', ...over,
})

const only = (txs) => buildDebtAging(txs, { now: NOW })[0]

describe('cada pago ataca el gasto MÁS VIEJO que sigue sin pagar', () => {
  it('un pago que cubre justo el primer cargo lo liquida y deja el resto vivo', () => {
    const g = only([charge('2026-07-01', 100), charge('2026-07-20', 300), payment('2026-08-05', 100)])
    expect(g.settled).toHaveLength(1)
    expect(g.settled[0].date).toBe('2026-07-01')
    expect(g.settled[0].days).toBe(35)
    expect(g.outstanding).toHaveLength(1)
    expect(g.outstanding[0].date).toBe('2026-07-20')
    expect(g.outstandingTotal).toBe(300)
  })

  it('un pago grande liquida varios cargos, del más viejo al más nuevo', () => {
    const g = only([charge('2026-07-01', 100), charge('2026-07-11', 200), payment('2026-07-31', 300)])
    expect(g.settled.map((s) => s.date)).toEqual(['2026-07-01', '2026-07-11'])
    expect(g.settled.map((s) => s.days)).toEqual([30, 20])
    expect(g.outstanding).toHaveLength(0)
  })

  it('un cargo cubierto a medias sigue debiendo, y se liquida con el ÚLTIMO centavo', () => {
    // Hasta que no se cubre entero, seguías debiendo parte de él: la fecha de
    // liquidación es la del pago que lo termina, no la del que lo empezó.
    const g = only([charge('2026-07-01', 500), payment('2026-07-15', 200), payment('2026-08-10', 300)])
    expect(g.settled).toHaveLength(1)
    expect(g.settled[0].settledOn).toBe('2026-08-10')
    expect(g.settled[0].days).toBe(40)
    expect(g.outstanding).toHaveLength(0)
  })
})

describe('el promedio contesta "cuánto tardo"', () => {
  it('pondera por MONTO, no por cantidad de cargos', () => {
    // Dos cafés pagados al día siguiente no pueden tapar una compra grande que
    // se arrastró tres meses.
    const g = only([
      charge('2026-07-01', 10), charge('2026-07-01', 10), charge('2026-07-01', 1000),
      payment('2026-07-02', 20), payment('2026-09-29', 1000),
    ])
    // 10·1 + 10·1 + 1000·90 = 90020, sobre 1020 = 88.25
    expect(g.avgDays).toBeCloseTo(88.25, 2)
    expect(g.medianDays).toBe(1)
  })

  it('sin ningún pago no dice "0 días", dice que no se puede medir', () => {
    const g = only([charge('2026-07-01', 100)])
    expect(g.avgDays).toBeNull()
    expect(g.medianDays).toBeNull()
    expect(g.outstandingTotal).toBe(100)
  })
})

describe('lo que NO cuenta como haber pagado', () => {
  it('un reembolso cancela la deuda pero no entra al promedio', () => {
    // La deuda desapareció, y no porque la pagaras. Contarlo como "tardaste 1
    // día" sería inventar una virtud.
    const g = only([charge('2026-07-01', 100), charge('2026-07-02', -100, { kind: 'refund' })])
    expect(g.outstanding).toHaveLength(0)
    expect(g.settled[0].by).toBe('refund')
    expect(g.avgDays).toBeNull()
  })

  it('el cashback no es un pago ni un cargo', () => {
    const g = only([charge('2026-07-01', 100), charge('2026-07-05', -5, { kind: 'cashback', type: 'INCOME' })])
    expect(g.outstandingTotal).toBe(100)
  })
})

describe('lo que se REPORTA en vez de tragarse', () => {
  it('un pago sin cargos que atacar se nombra, no se descarta', () => {
    // Es el caso NORMAL del primer estado que uno sube: ese pago cubre consumos
    // de un mes que nunca se importó. Callarlo dejaría el promedio midiendo una
    // historia incompleta sin que nada lo dijera.
    const g = only([charge('2026-07-20', 100), payment('2026-07-05', 400)])
    // Los 400 ENTEROS quedan sin atribuir: el cargo del 20 es posterior al
    // pago, así que ese pago no pudo haberlo cubierto.
    expect(g.unattributed).toBe(400)
    expect(g.outstandingTotal).toBe(100)
  })

  it('una corrección a pago revierte lo que ese pago había cubierto de más', () => {
    const g = only([
      payment('2026-07-05', 400),
      payment('2026-07-10', -150, { kind: 'payment-adjustment', description: 'CORRECCION A PAGO' }),
    ])
    expect(g.unattributed).toBe(250)
  })
})

describe('⛔ la cola es por tarjeta Y por moneda', () => {
  it('un pago en quetzales no puede pagar un cargo en dólares', () => {
    // Estos estados traen GTQ y USD en el mismo documento.
    const groups = buildDebtAging([
      charge('2026-07-01', 100, { currency: 'USD' }),
      payment('2026-07-05', 100, { currency: 'GTQ' }),
    ], { now: NOW })
    const usd = groups.find((g) => g.currency === 'USD')
    const gtq = groups.find((g) => g.currency === 'GTQ')
    expect(usd.outstandingTotal).toBe(100)
    expect(gtq.unattributed).toBe(100)
  })

  it('dos tarjetas distintas no comparten cola', () => {
    const groups = buildDebtAging([
      charge('2026-07-01', 100),
      charge('2026-07-01', 200, { cardKey: 'gyt:1234' }),
      payment('2026-07-10', 300),
    ], { now: NOW })
    const bi = groups.find((g) => g.card === 'bi:9856')
    const gyt = groups.find((g) => g.card === 'gyt:1234')
    expect(bi.outstandingTotal).toBe(0)
    expect(bi.unattributed).toBe(200)
    expect(gyt.outstandingTotal).toBe(200)
  })
})

describe('la deuda viva y su antigüedad', () => {
  it('el cargo más viejo sin pagar es el que encabeza', () => {
    const g = only([charge('2026-06-15', 500), charge('2026-08-01', 100)])
    expect(g.oldest.date).toBe('2026-06-15')
    expect(g.oldest.ageDays).toBe(77)
    expect(g.outstandingTotal).toBe(600)
  })

  it('un cargo pagado a medias reporta lo que QUEDA, no su monto original', () => {
    const g = only([charge('2026-07-01', 500), payment('2026-07-20', 200)])
    expect(g.outstanding[0].amount).toBe(500)
    expect(g.outstanding[0].remaining).toBe(300)
    expect(g.outstandingTotal).toBe(300)
  })
})

describe('qué filas mira y cuáles no', () => {
  it('un pago DEGRADADO a transferencia sigue siendo un pago', () => {
    // FASE KV lo degrada cuando aparece el estado del banco, pero le conserva
    // el `kind` justamente para esto. Si dejara de contar, el motor vería
    // cargos y ningún pago.
    const neteado = payment('2026-07-10', 100, {
      category: 'Transferencia Recibida', _nettedTransfer: true, _categorySetByUser: true,
    })
    expect(isCardPayment(neteado)).toBe(true)
    const g = only([charge('2026-07-01', 100), neteado])
    expect(g.outstandingTotal).toBe(0)
    expect(g.settled[0].days).toBe(9)
  })

  it('un gasto que no vino de un estado de tarjeta no entra a la cola', () => {
    // Un gasto en efectivo o capturado por el atajo no es deuda de tarjeta.
    expect(isCardCharge({ source: 'auto_shortcut', kind: 'purchase' })).toBe(false)
    expect(isCardCharge({ source: 'bi_import', type: 'EXPENSE' })).toBe(false)
  })

  it('una fila sin tarjeta se ignora en vez de caer en un grupo cualquiera', () => {
    expect(buildDebtAging([{ ...charge('2026-07-01', 100), cardKey: undefined }], { now: NOW })).toEqual([])
  })

  it('una fila vieja sin cardKey se reconoce por su etiqueta de cuenta', () => {
    expect(cardOfRow({ account: 'Bi (Contecnica) •9856' })).toBe('card:9856')
  })
})

// Un pago no puede cubrir algo que todavía no se debía. Sin esta regla, un pago
// del 5 de julio liquidaba un cargo del 20 y el "tardé" salía NEGATIVO.
describe('un pago solo ataca lo que ya se debía', () => {
  it('ignora los cargos posteriores a su fecha', () => {
    const g = only([charge('2026-07-01', 100), charge('2026-07-25', 100), payment('2026-07-10', 200)])
    expect(g.settled.map((s) => s.date)).toEqual(['2026-07-01'])
    expect(g.outstanding.map((c) => c.date)).toEqual(['2026-07-25'])
    expect(g.unattributed).toBe(100)
  })

  it('un cargo del MISMO día sí es elegible', () => {
    // Comprás y pagás ese mismo día: pasa, y son cero días.
    const g = only([charge('2026-07-10', 100), payment('2026-07-10', 100)])
    expect(g.settled[0].days).toBe(0)
    expect(g.outstandingTotal).toBe(0)
  })

  it('ningún "tardé" puede salir negativo', () => {
    const g = only([charge('2026-07-01', 50), charge('2026-08-01', 50), payment('2026-07-15', 100)])
    for (const s of g.settled) expect(s.days).toBeGreaterThanOrEqual(0)
  })
})
