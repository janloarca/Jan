import {
  knownContributions, impliedYieldRate, accrualSchedule, computeLiquidYield,
  yieldSignature, supersededYieldTxIds,
} from '../liquidYield'

const ts = (d) => new Date(`${d}T00:00:00Z`).getTime()

// El caso de referencia: FONDO LÍQUIDO Q de IDC. Apertura propia + tres cupones
// de bonos que pagan en efectivo a esta cuenta.
const FUND = { id: 'fund-q', name: 'FONDO LÍQUIDO Q', currency: 'GTQ', type: 'Bank' }
const XOCHI = { id: 'xochi', name: 'XOCHI', symbol: 'XOCHI', currency: 'GTQ', type: 'Bond', incomeDestination: 'fund-q' }
const CREDI = { id: 'credi', name: 'CrediCorp', symbol: 'CREDI', currency: 'GTQ', type: 'Bond', incomeDestination: 'fund-q' }

const CONTRIBUTIONS = [
  { ts: ts('2024-07-01'), amount: 500 },
  { ts: ts('2025-02-15'), amount: 600 },
  { ts: ts('2025-06-15'), amount: 400 },
  { ts: ts('2025-08-15'), amount: 600 },
]
const AS_OF = ts('2026-08-11')

describe('knownContributions', () => {
  const items = [FUND, XOCHI, CREDI]

  it('cuenta el depósito de apertura, los cupones ruteados aquí y las transferencias', () => {
    const txs = [
      { id: 'd1', type: 'DEPOSIT', date: '2024-07-01', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'fund-q' },
      { id: 'c1', type: 'DIVIDEND', date: '2025-02-15', totalAmount: 600, currency: 'GTQ', _linkedItemId: 'xochi' },
      { id: 'c2', type: 'DIVIDEND', date: '2025-06-15', totalAmount: 400, currency: 'GTQ', _linkedItemId: 'credi', _destinationItemId: 'fund-q' },
      { id: 't1', type: 'TRANSFER', date: '2025-09-01', totalAmount: 100, currency: 'GTQ', _linkedItemId: 'fund-q', _originItemId: 'other' },
      { id: 'w1', type: 'WITHDRAWAL', date: '2025-10-01', totalAmount: 50, currency: 'GTQ', _linkedItemId: 'fund-q' },
    ]
    const got = knownContributions({ item: FUND, items, transactions: txs, asOfTs: AS_OF })
    expect(got.map((c) => [c.kind, c.amount])).toEqual([
      ['deposit', 500], ['income', 600], ['income', 400], ['transfer-in', 100], ['withdrawal', -50],
    ])
  })

  it('NO cuenta como aporte el ingreso que la propia cuenta generó', () => {
    // Es justo lo que estamos deduciendo: contarlo del lado de los aportes lo
    // borraría del residuo y el fondo aparecería rindiendo cero.
    const txs = [
      { id: 'd1', type: 'DEPOSIT', date: '2024-07-01', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'fund-q' },
      { id: 'y1', type: 'DIVIDEND', date: '2025-01-31', totalAmount: 2, currency: 'GTQ', _linkedItemId: 'fund-q', _reinvested: true, _source: 'auto' },
      { id: 'y2', type: 'DIVIDEND', date: '2025-02-28', totalAmount: 2, currency: 'GTQ', _linkedItemId: 'fund-q', _reinvested: true, _source: 'inferred_yield' },
    ]
    const got = knownContributions({ item: FUND, items, transactions: txs, asOfTs: AS_OF })
    expect(got).toHaveLength(1)
    expect(got[0].kind).toBe('deposit')
  })

  it('ignora el cupón que se reinvierte en el bono (nunca llegó al fondo)', () => {
    const reinvesting = { ...XOCHI, dividendAction: 'reinvest' }
    const txs = [{ id: 'c1', type: 'DIVIDEND', date: '2025-02-15', totalAmount: 600, currency: 'GTQ', _linkedItemId: 'xochi' }]
    expect(knownContributions({ item: FUND, items: [FUND, reinvesting], transactions: txs, asOfTs: AS_OF })).toHaveLength(0)
  })

  it('corta en la fecha del saldo y convierte a la moneda de la cuenta', () => {
    const txs = [
      { id: 'c1', type: 'DIVIDEND', date: '2025-02-15', totalAmount: 100, currency: 'USD', _linkedItemId: 'xochi' },
      { id: 'c2', type: 'DIVIDEND', date: '2026-12-01', totalAmount: 600, currency: 'GTQ', _linkedItemId: 'xochi' },
    ]
    const convert = (amt, from, to) => (from === 'USD' && to === 'GTQ' ? amt * 7.7 : amt)
    const got = knownContributions({ item: FUND, items, transactions: txs, convert, asOfTs: AS_OF })
    expect(got).toHaveLength(1)
    expect(got[0].amount).toBeCloseTo(770, 6)
  })
})

describe('la identidad: aportes + interés == saldo tecleado', () => {
  it('reproduce el ejemplo trabajado de IDC al centavo', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF })
    expect(out.status).toBe('ok')
    expect(out.contributed).toBe(2100)
    expect(out.interest).toBeCloseTo(136.73, 2)
    expect(out.ratePct).toBeCloseTo(4.5, 1)
    const sum = out.months.reduce((s, m) => s + m.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(136.73)
  })

  it('cierra exacto con cualquier saldo, incluido uno cuya tasa se marca implausible', () => {
    for (const balance of [2150.07, 2201.11, 2280.4, 3000.55]) {
      const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: balance, asOfTs: AS_OF })
      expect(['ok', 'implausible-rate']).toContain(out.status)
      const sum = out.months.reduce((s, m) => s + m.amount, 0)
      expect(Math.round((out.contributed + sum) * 100) / 100).toBe(balance)
    }
  })

  it('la tasa implícita reconstruye el saldo al componer hacia adelante', () => {
    const rate = impliedYieldRate(CONTRIBUTIONS, 2236.73, AS_OF)
    const sched = accrualSchedule(CONTRIBUTIONS, rate, { endTs: AS_OF })
    expect(sched.finalBalance).toBeCloseTo(2236.73, 6)
  })
})

describe('devenga desde que entra, no desde el principio del mes', () => {
  it('el mes en que aterriza un cupón a mitad rinde menos que el mes siguiente', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF })
    const feb = out.months.find((m) => m.month === '2025-02')
    const mar = out.months.find((m) => m.month === '2025-03')
    const ene = out.months.find((m) => m.month === '2025-01')
    // El cupón entra el 15 de febrero: febrero solo lo tiene media, marzo entero.
    expect(feb.amount).toBeGreaterThan(ene.amount)
    expect(mar.amount).toBeGreaterThan(feb.amount)
  })

  it('un aporte posterior no rinde nada antes de su fecha', () => {
    const late = [{ ts: ts('2026-01-01'), amount: 1000 }, { ts: ts('2026-07-01'), amount: 1000 }]
    const sched = accrualSchedule(late, 10, { endTs: ts('2027-01-01') })
    const primero = sched.months.find((m) => m.month === '2026-01').amount
    const ultimo = sched.months.find((m) => m.month === '2026-08').amount
    expect(ultimo).toBeGreaterThan(primero * 1.8) // el saldo se duplicó a mitad de camino
    expect(sched.months.every((m) => m.ts < ts('2027-01-02'))).toBe(true)
  })

  it('la transacción de cada mes se fecha al cierre de ese mes', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF })
    expect(out.months.find((m) => m.month === '2025-02').date).toBe('2025-02-28')
    // el mes en curso se corta en la fecha del saldo, no al final del mes
    expect(out.months[out.months.length - 1].date).toBe('2026-08-11')
  })
})

describe('el orden de carga no cambia el resultado', () => {
  // El requisito del usuario: cargar los bonos primero y el fondo después tiene
  // que dar lo mismo que al revés. El motor solo mira lo que existe HOY.
  it('mismo desglose con los aportes en cualquier orden', () => {
    const shuffled = [CONTRIBUTIONS[2], CONTRIBUTIONS[0], CONTRIBUTIONS[3], CONTRIBUTIONS[1]]
    const a = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF })
    const b = computeLiquidYield({ contributions: shuffled, finalBalance: 2236.73, asOfTs: AS_OF })
    expect(b.ratePct).toBeCloseTo(a.ratePct, 9)
    expect(b.months).toEqual(a.months)
  })

  it('agregar después un bono que pagó a esta cuenta BAJA el interés deducido', () => {
    const sinBono = computeLiquidYield({
      contributions: CONTRIBUTIONS.slice(0, 3), finalBalance: 2236.73, asOfTs: AS_OF,
    })
    const conBono = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF })
    // Los mismos 2,236.83, pero ahora 600 de ellos tienen dueño conocido.
    expect(sinBono.interest).toBeCloseTo(conBono.interest + 600, 2)
    expect(conBono.ratePct).toBeLessThan(sinBono.ratePct)
  })
})

describe('cuándo rehúsa', () => {
  it('sin aportes no infiere nada', () => {
    expect(computeLiquidYield({ contributions: [], finalBalance: 2500, asOfTs: AS_OF }).status).toBe('no-contributions')
  })

  it('un residuo de redondeo no escribe 26 transacciones', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 2103, asOfTs: AS_OF })
    expect(out.status).toBe('negligible')
    expect(out.months).toEqual([])
  })

  it('un saldo MENOR que lo aportado no produce interés negativo', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 1800, asOfTs: AS_OF })
    expect(out.status).toBe('negative-residual')
    expect(out.months).toEqual([])
    expect(out.interest).toBeCloseTo(-300, 2)
  })

  it('una tasa implausible se marca pero se devuelve el desglose para que el usuario decida', () => {
    const out = computeLiquidYield({ contributions: CONTRIBUTIONS, finalBalance: 4000, asOfTs: AS_OF })
    expect(out.status).toBe('implausible-rate')
    expect(out.ratePct).toBeGreaterThan(25)
    expect(out.months.length).toBeGreaterThan(0)
  })

  it('con tasa declarada, una implícita 3x mayor también se marca', () => {
    const out = computeLiquidYield({
      contributions: CONTRIBUTIONS, finalBalance: 2600, asOfTs: AS_OF, declaredRatePct: 4.5,
    })
    expect(out.status).toBe('implausible-rate')
    expect(out.declared.ratePct).toBe(4.5)
    expect(out.declared.expectedInterest).toBeCloseTo(136.73, 1)
    expect(out.declared.unexplained).toBeCloseTo(500 - 136.73, 0)
  })

  it('con tasa declarada que coincide, no hay nada sin explicar', () => {
    const out = computeLiquidYield({
      contributions: CONTRIBUTIONS, finalBalance: 2236.73, asOfTs: AS_OF, declaredRatePct: 4.5,
    })
    expect(out.status).toBe('ok')
    expect(Math.abs(out.declared.unexplained)).toBeLessThan(0.5)
  })
})

describe('yieldSignature', () => {
  it('cambia cuando cambia el saldo, su fecha o los aportes', () => {
    const a = yieldSignature({ asOfTs: AS_OF, finalBalance: 2236.73, contributions: CONTRIBUTIONS })
    expect(yieldSignature({ asOfTs: AS_OF, finalBalance: 2300, contributions: CONTRIBUTIONS })).not.toBe(a)
    expect(yieldSignature({ asOfTs: ts('2026-08-12'), finalBalance: 2236.73, contributions: CONTRIBUTIONS })).not.toBe(a)
    expect(yieldSignature({ asOfTs: AS_OF, finalBalance: 2236.73, contributions: CONTRIBUTIONS.slice(0, 3) })).not.toBe(a)
  })

  it('no cambia por el orden de los aportes', () => {
    const a = yieldSignature({ asOfTs: AS_OF, finalBalance: 2236.73, contributions: CONTRIBUTIONS })
    const b = yieldSignature({ asOfTs: AS_OF, finalBalance: 2236.73, contributions: [...CONTRIBUTIONS].reverse() })
    expect(b).toBe(a)
  })
})

describe('supersededYieldTxIds', () => {
  const REINVESTING = { id: 'fund-q', dividendAction: 'reinvest' }
  const txs = [
    { id: 'inf', type: 'DIVIDEND', date: '2025-03-31', _linkedItemId: 'fund-q', _source: 'inferred_yield', _reinvested: true },
    { id: 'auto-in', type: 'DIVIDEND', date: '2025-05-31', _linkedItemId: 'fund-q', _source: 'auto', _reinvested: true },
    { id: 'auto-out', type: 'DIVIDEND', date: '2026-09-30', _linkedItemId: 'fund-q', _source: 'auto', _reinvested: true },
    { id: 'manual', type: 'DIVIDEND', date: '2025-06-30', _linkedItemId: 'fund-q' },
    { id: 'cupon', type: 'DIVIDEND', date: '2025-02-15', _linkedItemId: 'xochi', _destinationItemId: 'fund-q' },
    { id: 'dep', type: 'DEPOSIT', date: '2024-07-01', _linkedItemId: 'fund-q' },
  ]

  it('se lleva lo que la app generó dentro de la ventana, y nada más', () => {
    expect(supersededYieldTxIds(txs, REINVESTING, AS_OF).sort()).toEqual(['auto-in', 'inf'])
  })

  it('jamás toca un pago que escribió el usuario a mano, ni un cupón de otro activo', () => {
    const ids = supersededYieldTxIds(txs, REINVESTING, AS_OF)
    expect(ids).not.toContain('manual')
    expect(ids).not.toContain('cupon')
    expect(ids).not.toContain('dep')
  })

  it('alcanza a los pagos escritos ANTES de cambiar la cuenta a reinvertir', () => {
    // El caso real del usuario: 19 pagos automáticos escritos cuando la cuenta
    // estaba en "recibo el efectivo", así que no llevan la bandera _reinvested.
    // Los motores ya los tratan como reinvertidos porque la cuenta ahora lo
    // hace, así que si no se superan cuentan el mismo dinero dos veces.
    const viejos = [{ id: 'pre', type: 'DIVIDEND', date: '2026-02-28', _linkedItemId: 'fund-q', _source: 'auto' }]
    expect(supersededYieldTxIds(viejos, REINVESTING, AS_OF)).toEqual(['pre'])
    // Sin configuración de destino tampoco salieron de la cuenta.
    expect(supersededYieldTxIds(viejos, { id: 'fund-q' }, AS_OF)).toEqual(['pre'])
  })

  it('NO toca un pago que se fue a otra cuenta: borrarlo exigiría revertir su crédito', () => {
    const pagando = { id: 'fund-q', dividendAction: 'cash', incomeDestination: 'otra' }
    const salientes = [{ id: 'out', type: 'DIVIDEND', date: '2026-02-28', _linkedItemId: 'fund-q', _source: 'auto' }]
    expect(supersededYieldTxIds(salientes, pagando, AS_OF)).toEqual([])
  })
})

// FASE HV7. Los movimientos que se listan tienen que traer con qué BORRARLOS
// bien: un pago escrito por el motor automático se regenera solo si no se
// excluye además su fecha en el activo que lo produce.
describe('metadatos para poder corregir una fila', () => {
  const items = [FUND, XOCHI]
  it('cada movimiento sabe quién lo escribió, cuándo y de qué activo viene', () => {
    const txs = [
      { id: 'c1', type: 'DIVIDEND', date: '2024-08-28', totalAmount: 600, currency: 'GTQ', _linkedItemId: 'xochi', _source: 'auto' },
      { id: 'w1', type: 'WITHDRAWAL', date: '2025-12-30', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'fund-q', _source: 'manual_cashflow' },
    ]
    const got = knownContributions({ item: FUND, items, transactions: txs, asOfTs: AS_OF })
    expect(got[0]).toMatchObject({ txId: 'c1', source: 'auto', date: '2024-08-28', sourceItemId: 'xochi', kind: 'income' })
    expect(got[1]).toMatchObject({ txId: 'w1', source: 'manual_cashflow', date: '2025-12-30', sourceItemId: 'fund-q', kind: 'withdrawal' })
  })

  it('el caso real de IDC: quitar los pagos inventados de 2024 y el retiro duplicado cierra el saldo', () => {
    // Lo que la app tenía archivado: 8 cupones (600 en feb/ago, 400 en jun/dic)
    // y DOS retiros de 500, contra un saldo tecleado de 2,500.
    const cupones = [
      ['2024-08-28', 600], ['2024-12-18', 400],
      ['2025-02-28', 600], ['2025-06-18', 400],
      ['2025-08-28', 600], ['2025-12-18', 400],
      ['2026-02-28', 600], ['2026-06-18', 400],
    ].map(([date, amount], i) => ({ id: `c${i}`, type: 'DIVIDEND', date, totalAmount: amount, currency: 'GTQ', _linkedItemId: 'xochi', _source: 'auto' }))
    const retiros = [
      { id: 'w1', type: 'WITHDRAWAL', date: '2025-12-30', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'fund-q' },
      { id: 'w2', type: 'WITHDRAWAL', date: '2026-08-06', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'fund-q' },
    ]
    const asOfTs = ts('2026-08-12')
    const antes = computeLiquidYield({
      contributions: knownContributions({ item: FUND, items, transactions: [...cupones, ...retiros], asOfTs }),
      finalBalance: 2500, asOfTs,
    })
    expect(antes.contributed).toBe(3000)
    expect(antes.status).toBe('negative-residual')

    // El usuario corrige: en 2024 no hubo ningún pago, y uno de los retiros
    // estaba duplicado.
    const limpio = [...cupones.filter((c) => !c.date.startsWith('2024')), retiros[1]]
    const despues = computeLiquidYield({
      contributions: knownContributions({ item: FUND, items, transactions: limpio, asOfTs }),
      finalBalance: 2500, asOfTs,
    })
    expect(despues.contributed).toBe(2500)
    expect(despues.status).toBe('negligible')
  })
})
