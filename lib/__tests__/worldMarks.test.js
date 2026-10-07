import { VARIANT_MARK, variantOf, markFor } from '../worldMarks'
import { INDUSTRY_ARCHETYPE } from '../classification'
import { buildWorld } from '../worldModel'

describe('marcas de industria en World', () => {
  test('toda industria con marca existe en el catalogo y las formas no se repiten', () => {
    for (const v of Object.keys(VARIANT_MARK)) expect(INDUSTRY_ARCHETYPE[v]).toBeTruthy()
    const shapes = Object.values(VARIANT_MARK)
    expect(new Set(shapes).size).toBe(shapes.length)
  })
  test('industrias que comparten arquetipo reciben formas distintas', () => {
    // Las que NO tienen marca son la por defecto de su arquetipo; dos industrias
    // del mismo arquetipo nunca pueden ser las dos "sin marca" ni repetir forma.
    const byArch = {}
    for (const [ind, arch] of Object.entries(INDUSTRY_ARCHETYPE)) (byArch[arch] ||= []).push(ind)
    for (const inds of Object.values(byArch)) {
      const unmarked = inds.filter(i => !VARIANT_MARK[i])
      expect(unmarked.length).toBeLessThanOrEqual(1)
    }
  })
  test('variantOf resuelve la industria directa o la de la subindustria', () => {
    expect(variantOf({ industry: 'Hospitality' })).toBe('Hospitality')
    expect(variantOf({ industry: 'Banks - Regional' })).toBe(null)
    expect(variantOf(null)).toBe(null)
  })
  test('markFor solo marca si el arquetipo dibujado es el de la industria', () => {
    expect(markFor('RETAIL', 'Hospitality')).toBe('bell')
    expect(markFor('ENERGY', 'Hospitality')).toBe(null) // override a otro arquetipo
    expect(markFor('TECH', 'Technology')).toBe(null) // la por defecto no lleva marca
  })
  test('buildWorld lleva la industria al piso y al edificio', () => {
    const w = buildWorld([
      { id: 'h', quantity: 1, currentPrice: 900, purchasePrice: 900, type: 'Stock', institution: 'Hoteles SA', industry: 'Hospitality' },
      { id: 'g', quantity: 1, currentPrice: 100, purchasePrice: 100, type: 'Stock', institution: 'Hoteles SA' },
    ])
    const b = w.buildings[0]
    expect(b.archetype).toBe('RETAIL')
    expect(b.variant).toBe('Hospitality')
    expect(b.departments.find(d => d.id === 'h').variant).toBe('Hospitality')
    expect(b.departments.find(d => d.id === 'g').variant).toBe(null)
  })
  test('un override del usuario a otro arquetipo no deja una marca falsa', () => {
    const w = buildWorld([{ id: 'h', quantity: 1, currentPrice: 900, purchasePrice: 900, type: 'Stock', institution: 'X', industry: 'Hospitality', worldArchetype: 'ENERGY' }])
    expect(w.buildings[0].variant).toBe(null)
  })
})
