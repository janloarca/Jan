import {
  methodOfTx, transportOfTx, monthKeyOfTx,
  monthsPresent, transportsPresent, planFinanceWipe,
} from '../financeWipe'

const tx = (id, date, over = {}) => ({ id, date, amount: 100, currency: 'GTQ', ...over })

const data = [
  // julio: estados de cuenta
  tx('c1', '2026-07-05', { source: 'card_import', amount: 50 }),
  tx('c2', '2026-07-06', { source: 'card_import', amount: 22 }),
  tx('b1', '2026-07-08', { source: 'bi_import', amount: 30 }),
  // julio: captura automática, dos transportes
  tx('a1', '2026-07-09', { _source: 'auto_shortcut', amount: 18 }),
  tx('a2', '2026-07-10', { _source: 'auto_email', amount: 40 }),
  // julio: manual, uno moderno y uno VIEJO sin campo source
  tx('m1', '2026-07-11', { source: 'manual', amount: 200 }),
  tx('m2', '2026-07-12', { amount: 15 }),
  // agosto
  tx('c3', '2026-08-03', { source: 'card_import', amount: 17 }),
  tx('a3', '2026-08-19', { _source: 'auto_shortcut', amount: 18 }),
]

describe('a qué método pertenece una fila', () => {
  it('reconoce los tres', () => {
    expect(methodOfTx({ _source: 'auto_shortcut' })).toBe('auto')
    expect(methodOfTx({ source: 'card_import' })).toBe('statement')
    expect(methodOfTx({ source: 'bi_import' })).toBe('statement')
    expect(methodOfTx({ source: 'manual' })).toBe('manual')
  })

  it('manual es el RESIDUO: una fila vieja sin campo source no queda imborrable', () => {
    // El bug que esto evita: con `source === 'manual'` estricto, toda fila
    // tecleada antes de que ese campo existiera cae fuera de los tres filtros
    // y solo se puede borrar con "todo".
    expect(methodOfTx({})).toBe('manual')
    expect(methodOfTx({ source: '' })).toBe('manual')
    expect(methodOfTx({ source: 'algo_que_no_conocemos' })).toBe('manual')
  })

  it('el transporte solo existe para la captura automática', () => {
    expect(transportOfTx({ _source: 'auto_android' })).toBe('android')
    expect(transportOfTx({ source: 'card_import' })).toBeNull()
    expect(transportOfTx({})).toBeNull()
  })
})

describe('el mes sale por recorte de texto, jamás de new Date', () => {
  it('lee el prefijo', () => {
    expect(monthKeyOfTx({ date: '2026-07-05' })).toBe('2026-07')
  })

  it('el primer día del mes NO se corre al mes anterior', () => {
    // Leído como Date, '2026-08-01' es medianoche UTC y en UTC-6 getMonth()
    // devuelve julio. Es el bug que MonthlyBreakdown ya tuvo.
    expect(monthKeyOfTx({ date: '2026-08-01' })).toBe('2026-08')
    expect(monthKeyOfTx({ date: '2026-01-01' })).toBe('2026-01')
  })

  it('una fila sin fecha no inventa un mes', () => {
    expect(monthKeyOfTx({})).toBeNull()
    expect(monthKeyOfTx({ date: 'ayer' })).toBeNull()
  })
})

describe('el desplegable se arma solo con meses que existen', () => {
  it('cuenta por mes, del más reciente al más viejo', () => {
    expect(monthsPresent(data)).toEqual([
      { month: '2026-08', count: 2 },
      { month: '2026-07', count: 7 },
    ])
  })

  it('sin datos no ofrece ningún mes', () => {
    expect(monthsPresent([])).toEqual([])
  })
})

describe('los transportes se ofrecen solo cuando el dato los distingue', () => {
  it('lista los que existen', () => {
    expect(transportsPresent(data)).toEqual([
      { transport: 'shortcut', count: 2 },
      { transport: 'email', count: 1 },
    ])
  })

  it('con un solo transporte la UI no tiene nada que separar', () => {
    const solo = [tx('a1', '2026-07-09', { _source: 'auto_shortcut' })]
    expect(transportsPresent(solo)).toHaveLength(1)
  })
})

describe('el plan: lo que se cuenta es exactamente lo que se borra', () => {
  it('sin filtro toma todo', () => {
    const p = planFinanceWipe(data)
    expect(p.count).toBe(9)
    expect(p.ids).toHaveLength(9)
    expect(p.isEverything).toBe(true)
  })

  it('por mes', () => {
    const p = planFinanceWipe(data, { month: '2026-08' })
    expect(p.ids.sort()).toEqual(['a3', 'c3'])
    expect(p.isEverything).toBe(false)
  })

  it('por método', () => {
    expect(planFinanceWipe(data, { method: 'statement' }).ids.sort()).toEqual(['b1', 'c1', 'c2', 'c3'])
    expect(planFinanceWipe(data, { method: 'auto' }).ids.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(planFinanceWipe(data, { method: 'manual' }).ids.sort()).toEqual(['m1', 'm2'])
  })

  it('mes y método a la vez', () => {
    const p = planFinanceWipe(data, { month: '2026-07', method: 'auto' })
    expect(p.ids.sort()).toEqual(['a1', 'a2'])
  })

  it('por transporte, sin tocar el otro teléfono', () => {
    // El caso que lo justifica: una macro de Android mal configurada mete
    // basura y hay que borrar ESO sin tocar lo que el iPhone sí captura bien.
    const conAndroid = [...data, tx('n1', '2026-07-20', { _source: 'auto_android' })]
    const p = planFinanceWipe(conAndroid, { method: 'auto', transport: 'android' })
    expect(p.ids).toEqual(['n1'])
  })

  it('un transporte pedido con otro método no borra de más', () => {
    expect(planFinanceWipe(data, { method: 'statement', transport: 'shortcut' }).count).toBe(0)
  })

  it('los ids salen de las MISMAS filas que el conteo', () => {
    const p = planFinanceWipe(data, { month: '2026-07' })
    expect(p.ids).toHaveLength(p.count)
    expect(p.rows.map((r) => r.id)).toEqual(p.ids)
    expect(p.byMethod.auto + p.byMethod.statement + p.byMethod.manual).toBe(p.count)
  })

  it('una fila SIN id no se cuenta: contarla prometería un borrado imposible', () => {
    const p = planFinanceWipe([{ date: '2026-07-05', amount: 10, currency: 'GTQ' }])
    expect(p.count).toBe(0)
    expect(p.ids).toEqual([])
  })

  it('el total va POR MONEDA, sin convertir', () => {
    // Convertir necesitaría tasas, y una tasa faltante devuelve el monto crudo
    // en silencio: la vista previa mentiría sobre cuánto se está por borrar.
    const mixto = [
      tx('g', '2026-07-05', { currency: 'GTQ', amount: 100 }),
      tx('u', '2026-07-06', { currency: 'USD', amount: 200 }),
      tx('g2', '2026-07-07', { currency: 'GTQ', amount: 50 }),
    ]
    expect(planFinanceWipe(mixto).totals).toEqual([
      { currency: 'USD', amount: 200 },
      { currency: 'GTQ', amount: 150 },
    ])
  })

  it('un reembolso resta en el total, como en cualquier otra suma', () => {
    const conReembolso = [
      tx('a', '2026-07-04', { amount: 770 }),
      tx('b', '2026-07-05', { amount: -488.07 }),
    ]
    expect(planFinanceWipe(conReembolso).totals).toEqual([{ currency: 'GTQ', amount: 281.93 }])
  })

  it('un mes sin datos devuelve un plan vacío, no un error', () => {
    const p = planFinanceWipe(data, { month: '2025-01' })
    expect(p.count).toBe(0)
    expect(p.totals).toEqual([])
  })

  it('aguanta una entrada vacía', () => {
    expect(planFinanceWipe(null).count).toBe(0)
    expect(planFinanceWipe(undefined).ids).toEqual([])
  })
})
