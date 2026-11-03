import { buildWorld, classifyItem, archetypeFromText, tierFor, MAX_FLOORS, MAX_WORKERS_PER_BUILDING, ARCHETYPES } from '../worldModel'

const item = (o) => ({ id: o.id, quantity: 1, currentPrice: o.v, purchasePrice: o.v, type: 'Bond', ...o })

describe('classifyItem: orden de reglas', () => {
  test('el override del usuario gana sobre todo', () => {
    expect(classifyItem(item({ id: 'a', v: 1, worldArchetype: 'ENERGY', notes: 'bono de carretera' }))).toEqual({ archetype: 'ENERGY', source: 'override' })
  })
  test('un override desconocido se ignora', () => {
    expect(classifyItem(item({ id: 'a', v: 1, worldArchetype: 'CASINO', notes: 'carretera' })).archetype).toBe('INFRASTRUCTURE')
  })
  test('las notas: lo que se financia gana sobre la forma del instrumento', () => {
    expect(classifyItem(item({ id: 'a', v: 1, notes: 'Bono que financia una carretera en Escuintla' }))).toEqual({ archetype: 'INFRASTRUCTURE', source: 'notes' })
  })
  test('sin notas, el nombre', () => {
    expect(classifyItem(item({ id: 'a', v: 1, name: 'Bono Azúcar 8%' }))).toEqual({ archetype: 'AGRICULTURE', source: 'name' })
  })
  test('sector/industria de mercado', () => {
    expect(classifyItem({ id: 'm', type: 'Stock', name: 'META PLATFORMS', sector: 'Communication Services' }).archetype).toBe('TECH')
    expect(classifyItem({ id: 'n', type: 'Stock', name: 'NOVO-NORDISK', sector: 'Healthcare' }).archetype).toBe('HEALTHCARE')
    expect(classifyItem({ id: 'b', type: 'Stock', name: 'XYZ', sector: 'Financial Services', industry: 'Banks - Regional' }).archetype).toBe('BANK')
  })
  test('por tipo, y genérico al final', () => {
    expect(classifyItem({ id: 'x', type: 'Bank', name: 'XQZ' })).toEqual({ archetype: 'BANK', source: 'type' })
    expect(classifyItem({ id: 'y', type: 'Stock', name: 'QQQX' })).toEqual({ archetype: 'GENERIC_CORPORATE', source: 'default' })
  })
  test('solo al inicio de palabra: "ia" en farmacia no cuenta como otra cosa', () => {
    expect(archetypeFromText('Farmacia del pueblo')).toBe('HEALTHCARE')
    expect(archetypeFromText('Canada Goose')).toBe(null)
    expect(archetypeFromText('')).toBe(null)
  })
})

describe('buildWorld', () => {
  test('agrupa por institución, excluye deuda y excluidos, ignora vendidos', () => {
    const w = buildWorld([
      item({ id: 'v', v: 6000, institution: 'IDC', name: 'VITALI', notes: 'carretera' }),
      item({ id: 'x', v: 1966, institution: 'IDC', name: 'XOCHI' }),
      item({ id: 'd', v: 4000, institution: 'AIXEN', isDebt: true }),
      item({ id: 'r', v: 900, institution: 'Primo', isReceivable: true, countInNetWorth: false }),
      item({ id: 's', v: 0, institution: 'Vendida' }),
      { id: 'i', _source: 'ibkr', institution: 'Interactive Brokers', type: 'Stock', quantity: 10, currentPrice: 900, sector: 'Technology' },
    ])
    expect(w.buildings.map(b => b.key)).toEqual(['ibkr', 'idc'])
    expect(w.buildings[0].name).toBe('Interactive Brokers')
    expect(w.buildings[1].name).toBe('IDC')
    expect(w.total).toBeCloseTo(9000 + 7966)
    expect(w.investmentCount).toBe(3)
    expect(w.buildings[1].archetype).toBe('INFRASTRUCTURE')
    expect(w.buildings[1].departments.map(d => d.id)).toEqual(['v', 'x'])
  })

  test('tope de pisos: el resto se agrupa en un piso "otras"', () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ id: `p${i}`, v: 100 + i, institution: 'Big' }))
    const w = buildWorld(many)
    const b = w.buildings[0]
    expect(b.departments).toHaveLength(MAX_FLOORS)
    const last = b.departments[MAX_FLOORS - 1]
    expect(last.itemIds).toHaveLength(9 - (MAX_FLOORS - 1))
    expect(b.departments.reduce((a, d) => a + d.value, 0)).toBeCloseTo(b.value)
  })

  test('escala igual con $1k y $1M: mismos escalones, mismos trabajadores, con techo', () => {
    const mk = (k) => buildWorld([item({ id: 'a', v: 600 * k, institution: 'A' }), item({ id: 'b', v: 300 * k, institution: 'B' }), item({ id: 'c', v: 10 * k, institution: 'C' })])
    const small = mk(1)
    const big = mk(1000)
    expect(small.buildings.map(b => b.tier)).toEqual(big.buildings.map(b => b.tier))
    expect(small.workerCount).toBe(big.workerCount)
    for (const b of big.buildings) expect(b.workerCount).toBeLessThanOrEqual(MAX_WORKERS_PER_BUILDING)
    expect(big.buildings.map(b => b.tier)).toEqual([5, 4, 1])
  })

  test('todo piso tiene al menos un trabajador', () => {
    const w = buildWorld(Array.from({ length: 6 }, (_, i) => item({ id: `p${i}`, v: i === 0 ? 1e6 : 1, institution: 'X' })))
    for (const d of w.buildings[0].departments) expect(d.workers.length).toBeGreaterThanOrEqual(1)
  })

  test('determinístico: la misma entrada da el mismo mundo', () => {
    const items = [item({ id: 'a', v: 5000, institution: 'A', notes: 'solar' }), item({ id: 'b', v: 2000, institution: 'B' })]
    expect(JSON.stringify(buildWorld(items))).toBe(JSON.stringify(buildWorld(items)))
  })

  test('sin datos: mundo vacío sin romper', () => {
    const w = buildWorld([])
    expect(w).toMatchObject({ total: 0, buildings: [], institutionCount: 0, investmentCount: 0, workerCount: 0 })
  })
})

test('tierFor', () => {
  expect(tierFor(100, 100)).toBe(5)
  expect(tierFor(1, 100)).toBe(1)
  expect(tierFor(0, 100)).toBe(1)
  expect(ARCHETYPES).toHaveLength(15)
})

test('ningún piso tiene más gente de la que cabe en su galería, y los totales cuadran', () => {
  const { slotCapacity } = require('../worldLayout')
  const cases = [
    [item({ id: 'solo', v: 1e6, institution: 'Grande' })],
    Array.from({ length: 3 }, (_, i) => item({ id: `t${i}`, v: [1e6, 10, 5][i], institution: 'Mix' })),
  ]
  for (const items of cases) {
    const w = buildWorld(items)
    let sum = 0
    for (const b of w.buildings) {
      const cap = slotCapacity(b.tier)
      let bsum = 0
      for (const d of b.departments) { expect(d.workers.length).toBeLessThanOrEqual(cap); bsum += d.workers.length }
      expect(bsum).toBe(b.workerCount)
      sum += bsum
    }
    expect(sum).toBe(w.workerCount)
  }
})

describe('FASE PR: clasificacion explicita en la cascada', () => {
  test('la industria elegida gana sobre las notas', () => {
    const r = classifyItem(item({ id: 'a', v: 1, industry: 'Energy', notes: 'bono que financia una carretera' }))
    expect(r).toEqual({ archetype: 'ENERGY', source: 'industry' })
  })
  test('la subindustria gana sobre la industria', () => {
    const r = classifyItem({ id: 'b', type: 'Stock', industry: 'Financials', subIndustry: 'Banking', notes: 'seguros' })
    expect(r).toEqual({ archetype: 'BANK', source: 'subindustry' })
  })
  test('el override del usuario sigue ganando a todo', () => {
    const r = classifyItem({ id: 'c', type: 'Stock', industry: 'Energy', subIndustry: 'Utilities', worldArchetype: 'TECH' })
    expect(r).toEqual({ archetype: 'TECH', source: 'override' })
  })
  test('industria de proveedor en texto libre sigue por las reglas de texto', () => {
    expect(classifyItem({ id: 'd', type: 'Stock', name: 'XYZ', industry: 'Banks - Regional' }).archetype).toBe('BANK')
  })
  test('Consumer legado no clasifica solo: cae a notas', () => {
    expect(classifyItem(item({ id: 'e', v: 1, industry: 'Consumer', notes: 'carretera' })).archetype).toBe('INFRASTRUCTURE')
  })
})

describe('FASE LU2: altura proporcional y color por rendimiento', () => {
  const { perfTone } = require('../worldModel')
  const { buildingGeometry, heightForRatio, HEIGHT_BASE, HEIGHT_MAX } = require('../worldLayout')

  test('perfTone: null es "none", nunca "flat"', () => {
    expect(perfTone(null)).toBe('none')
    expect(perfTone(0)).toBe('flat')
    expect(perfTone(3.9)).toBe('up')
    expect(perfTone(-1)).toBe('down')
  })
  test('la altura crece de forma continua con el capital', () => {
    const w = buildWorld([
      item({ id: 'a', v: 10000, institution: 'A', name: 'a' }),
      item({ id: 'b', v: 5000, institution: 'B', name: 'b' }),
    ])
    const [A, B] = w.buildings
    expect(A.heightRatio).toBe(1)
    expect(B.heightRatio).toBeCloseTo(0.5)
    expect(buildingGeometry(A).top).toBeGreaterThan(buildingGeometry(B).top)
    expect(heightForRatio(0)).toBe(HEIGHT_BASE)
    expect(heightForRatio(2)).toBe(HEIGHT_MAX)
  })
  test('sin transacciones de rendimiento el rendimiento es null, no 0', () => {
    const w = buildWorld([item({ id: 'a', v: 100, institution: 'A', name: 'a' })])
    expect(w.buildings[0].returnPct).not.toBe(0)
  })
  test('con perf, VITALI rinde 3.94% (la convencion congelada)', () => {
    const vitali = { id: 'v', type: 'Bond', institution: 'IDC', name: 'VITALI', quantity: 1, currentPrice: 6000, purchasePrice: 6000, entryFee: 95.78, incomeDestination: 'f', currency: 'USD' }
    const fund = { id: 'f', type: 'Bank', institution: 'IDC', name: 'FONDO', quantity: 1, currentPrice: 240, purchasePrice: 240, currency: 'USD' }
    const tx = [{ type: 'DIVIDEND', symbol: 'VITALI', _linkedItemId: 'v', _destinationItemId: 'f', totalAmount: 240, currency: 'USD', date: '2026-05-15' }]
    const w = buildWorld([vitali, fund], { perf: { transactions: tx, convert: (a) => a, baseCurrency: 'USD' } })
    const dept = w.buildings[0].departments.find((d) => d.id === 'v')
    expect(dept.returnPct).toBeCloseTo(3.94, 1)
  })
})

describe('formatReturn', () => {
  const { formatReturn } = require('../worldModel')
  test('legible en cualquier magnitud', () => {
    expect(formatReturn(3.944)).toBe('▲ +3.94%')
    expect(formatReturn(-12.5)).toBe('▼ -12.50%')
    expect(formatReturn(0)).toBe('■ 0.00%')
    expect(formatReturn(266980.22)).toBe('▲ ×2,671')
    expect(formatReturn(90400)).toBe('▲ +90,400%')
    expect(formatReturn(null)).toBe('')
  })
})
