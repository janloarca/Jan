import { planCardDebtSync, describeCardDebtLine } from '../cardDebt'

const card = (over = {}) => ({
  bank: 'gyt',
  bankLabel: 'G&T Continental',
  cardLast4: '9876',
  cutDate: '2026-08-09',
  closingBalance: { GTQ: 3953.98, USD: 315.4 },
  ...over,
})

describe('planCardDebtSync — crear', () => {
  it('crea UNA deuda por moneda con saldo', () => {
    const p = planCardDebtSync(card(), [])
    expect(p.ok).toBe(true)
    expect(p.creates.map((c) => c.currency)).toEqual(['GTQ', 'USD'])
    expect(p.creates[0].item.currentPrice).toBe(3953.98)
    expect(p.creates[1].item.currentPrice).toBe(315.4)
  })

  it('la magnitud se guarda POSITIVA: un negativo lo rechaza validateItem', () => {
    const p = planCardDebtSync(card(), [])
    for (const c of p.creates) {
      expect(c.item.purchasePrice).toBeGreaterThan(0)
      expect(c.item.currentPrice).toBeGreaterThan(0)
    }
  })

  it('un estado que cierra a favor no crea una "deuda negativa"', () => {
    const p = planCardDebtSync(card({ closingBalance: { GTQ: -250, USD: 0 } }), [])
    expect(p.creates).toEqual([])
    expect(p.ok).toBe(false)
  })

  it('una moneda en cero no crea una deuda vacia', () => {
    const p = planCardDebtSync(card({ closingBalance: { GTQ: 500, USD: 0 } }), [])
    expect(p.creates.map((c) => c.currency)).toEqual(['GTQ'])
  })

  // ⛔ El motor de rendimiento deducido excluye por `type === 'Debt'`, NO por
  // `isDebt`. Un item con isDebt y otro type, con balanceAsOf sellado, es justo
  // la combinacion que lo dispara.
  it('escribe type Debt explicito para quedar fuera del motor de rendimiento', () => {
    for (const c of planCardDebtSync(card(), []).creates) {
      expect(c.item.type).toBe('Debt')
      expect(c.item.isDebt).toBe(true)
      expect(c.item.subtype).toBe('credit_card')
    }
  })

  // ⛔ La fecha de corte y no hoy: el saldo lo afirma el BANCO sobre un dia que
  // ya paso. Sellar hoy diria que es de hoy, falso en cuanto compres algo.
  it('sella balanceAsOf y acquisitionDate con la fecha de CORTE, no con hoy', () => {
    const p = planCardDebtSync(card(), [])
    for (const c of p.creates) {
      expect(c.item.balanceAsOf).toBe('2026-08-09')
      expect(c.item.acquisitionDate).toBe('2026-08-09')
    }
  })

  it('lleva la identidad de tarjeta, que es lo que evita duplicar el mes que viene', () => {
    const p = planCardDebtSync(card(), [])
    expect(p.cardKey).toBe('gyt:9876')
    for (const c of p.creates) expect(c.item.cardKey).toBe('gyt:9876')
  })

  it('las dos monedas producen items DISTINTOS, nunca uno con la suma', () => {
    const p = planCardDebtSync(card(), [])
    const symbols = p.creates.map((c) => c.item.symbol)
    expect(new Set(symbols).size).toBe(2)
    const amounts = p.creates.map((c) => c.amount)
    expect(amounts).not.toContain(3953.98 + 315.4)
  })
})

describe('planCardDebtSync — actualizar en vez de duplicar', () => {
  const existing = (over = {}) => ({
    id: 'd1', name: 'G&T ·9876', isDebt: true, type: 'Debt',
    cardKey: 'gyt:9876', currency: 'GTQ',
    quantity: 1, purchasePrice: 3953.98, currentPrice: 3953.98,
    balanceAsOf: '2026-08-09', ...over,
  })

  it('el mes siguiente ACTUALIZA la misma deuda, no crea una segunda', () => {
    const next = card({ cutDate: '2026-09-09', closingBalance: { GTQ: 4200, USD: 0 } })
    const p = planCardDebtSync(next, [existing()])
    expect(p.creates).toEqual([])
    expect(p.updates).toHaveLength(1)
    expect(p.updates[0].id).toBe('d1')
    expect(p.updates[0].prev).toBe(3953.98)
    expect(p.updates[0].next).toBe(4200)
    expect(p.updates[0].patch).toEqual({ currentPrice: 4200, purchasePrice: 4200, balanceAsOf: '2026-09-09' })
  })

  // Lo que el usuario tecleo a mano es suyo: tasa, cuota, dia de pago.
  it('el parche toca SOLO el saldo y su fecha', () => {
    const next = card({ cutDate: '2026-09-09', closingBalance: { GTQ: 4200 } })
    const p = planCardDebtSync(next, [existing({ interestRate: 24, ratePeriod: 'annual', minimumPayment: 300 })])
    expect(Object.keys(p.updates[0].patch).sort()).toEqual(['balanceAsOf', 'currentPrice', 'purchasePrice'])
  })

  it('una deuda de OTRA moneda de la misma tarjeta no se pisa entre si', () => {
    const p = planCardDebtSync(card({ cutDate: '2026-09-09' }), [existing()])
    expect(p.updates.map((u) => u.currency)).toEqual(['GTQ'])
    expect(p.creates.map((c) => c.currency)).toEqual(['USD'])
  })

  it('otra tarjeta del mismo banco no se confunde con esta', () => {
    const otra = existing({ id: 'd2', cardKey: 'gyt:1111' })
    const p = planCardDebtSync(card({ cutDate: '2026-09-09', closingBalance: { GTQ: 4200 } }), [otra])
    expect(p.updates).toEqual([])
    expect(p.creates).toHaveLength(1)
  })

  // Un item creado antes de que `cardKey` existiera no matchea, y eso es
  // DELIBERADO: adivinar cual deuda es "la misma" por nombre corrompe dos items
  // a la vez. El plan se muestra antes de aplicar, asi que el usuario lo ve.
  it('una deuda sin cardKey no se adivina', () => {
    const vieja = existing({ cardKey: undefined })
    const p = planCardDebtSync(card({ closingBalance: { GTQ: 4200 } }), [vieja])
    expect(p.updates).toEqual([])
    expect(p.creates).toHaveLength(1)
  })

  it('un saldo que no cambio y ya esta en esa fecha no produce escritura', () => {
    const p = planCardDebtSync(card({ closingBalance: { GTQ: 3953.98, USD: 0 } }), [existing()])
    expect(p.updates).toEqual([])
    expect(p.creates).toEqual([])
    expect(p.ok).toBe(false)
  })

  // ⛔ Este es el caso donde el clamp de la magnitud tiene dientes de verdad.
  // En la rama de CREAR, un negativo lo atrapa igual el guard de `amount <= 0`,
  // asi que el test de "cierra a favor" pasaba por la razon equivocada: lo
  // descubri neutralizando el clamp y viendo que la suite seguia en verde.
  // Acá el negativo SÍ se escribiría, y `validateItem` lo rechaza.
  it('un estado a favor sobre una deuda YA creada escribe cero, nunca un negativo', () => {
    const p = planCardDebtSync(card({ cutDate: '2026-09-09', closingBalance: { GTQ: -250, USD: 0 } }), [existing()])
    expect(p.updates).toHaveLength(1)
    expect(p.updates[0].next).toBe(0)
    expect(p.updates[0].patch.currentPrice).toBe(0)
    expect(p.updates[0].patch.purchasePrice).toBe(0)
  })

  it('bajar a cero SI se escribe: la tarjeta se pago', () => {
    const p = planCardDebtSync(card({ cutDate: '2026-09-09', closingBalance: { GTQ: 0, USD: 0 } }), [existing()])
    expect(p.updates).toHaveLength(1)
    expect(p.updates[0].next).toBe(0)
  })
})

describe('planCardDebtSync — un estado viejo no pisa uno nuevo', () => {
  it('rehusa cuando el saldo guardado es de una fecha posterior', () => {
    const guardado = {
      id: 'd1', name: 'G&T ·9876', isDebt: true, cardKey: 'gyt:9876', currency: 'GTQ',
      currentPrice: 4200, purchasePrice: 4200, balanceAsOf: '2026-09-09',
    }
    const viejo = card({ cutDate: '2026-06-09', closingBalance: { GTQ: 1000, USD: 0 } })
    const p = planCardDebtSync(viejo, [guardado])
    expect(p.updates).toEqual([])
    expect(p.stale).toHaveLength(1)
    expect(p.stale[0].asOf).toBe('2026-09-09')
    expect(p.reason).toBe('stale-statement')
  })
})

describe('planCardDebtSync — rehusa antes que inventar', () => {
  it('sin banco no hay identidad estable y no se ofrece', () => {
    expect(planCardDebtSync(card({ bank: null }), []).reason).toBe('no-card-key')
  })

  it('sin saldo legible no se crea nada', () => {
    expect(planCardDebtSync(card({ closingBalance: null }), []).reason).toBe('no-balance')
  })

  it('sin fecha de corte no se sella nada', () => {
    expect(planCardDebtSync(card({ cutDate: null }), []).reason).toBe('no-cut-date')
  })

  it('sin estado no revienta', () => {
    expect(planCardDebtSync(null, []).ok).toBe(false)
  })
})

describe('describeCardDebtLine', () => {
  it('describe una creacion y una actualizacion en la moneda correcta', () => {
    const p = planCardDebtSync(card(), [])
    expect(describeCardDebtLine(p.creates[0], 'create')).toContain('Q3,953.98')
    expect(describeCardDebtLine(p.creates[1], 'create')).toContain('$315.40')
    const upd = { name: 'G&T', currency: 'GTQ', prev: 100, next: 250 }
    expect(describeCardDebtLine(upd, 'update')).toBe('G&T: Q100.00 → Q250.00')
  })
})
