import {
  INDUSTRIES, INDUSTRY_KEYS, LEGACY_INDUSTRY, SUB_INDUSTRIES, INDUSTRY_ARCHETYPE, SUB_INDUSTRY_ARCHETYPE,
  industryChoices, industryLabel, subIndustriesOf, findSubIndustry, searchSubIndustries, normalizeSearch,
  archetypeForClassification,
} from '../classification'
import { ARCHETYPES } from '../worldModel'

describe('catalogo de industrias y subindustrias', () => {
  test('claves de industria unicas, y Consumer solo como alias legado', () => {
    const keys = INDUSTRIES.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(LEGACY_INDUSTRY.key)
    expect(INDUSTRY_KEYS).toContain('Consumer')
  })
  test('Consumer jamas se ofrece salvo que ya sea el valor guardado', () => {
    expect(industryChoices('').some(i => i.key === 'Consumer')).toBe(false)
    expect(industryChoices('Technology').some(i => i.key === 'Consumer')).toBe(false)
    expect(industryChoices('Consumer').some(i => i.key === 'Consumer')).toBe(true)
  })
  test('cada subindustria cuelga de una industria que existe y su clave es unica dentro de ella', () => {
    const seen = new Set()
    for (const s of SUB_INDUSTRIES) {
      expect(INDUSTRIES.map(i => i.key)).toContain(s.industry)
      const id = `${s.industry}::${s.key}`
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      expect(findSubIndustry(s.industry, s.key)).toBeTruthy()
    }
  })
  test('toda industria tiene al menos una subindustria', () => {
    for (const i of INDUSTRIES) expect(subIndustriesOf(i.key).length).toBeGreaterThan(0)
  })
  test('todo arquetipo referenciado existe en World', () => {
    for (const a of Object.values(INDUSTRY_ARCHETYPE)) expect(ARCHETYPES).toContain(a)
    for (const a of Object.values(SUB_INDUSTRY_ARCHETYPE)) expect(ARCHETYPES).toContain(a)
  })
  test('toda industria nueva tiene arquetipo (la cascada no se corta)', () => {
    for (const i of INDUSTRIES) expect(INDUSTRY_ARCHETYPE[i.key]).toBeTruthy()
  })
  test('etiquetas bilingues, sin guion largo', () => {
    for (const i of INDUSTRIES) {
      expect(industryLabel(i.key, 'es')).toBeTruthy()
      expect(industryLabel(i.key, 'en')).toBeTruthy()
      expect(`${i.es}${i.en}`).not.toMatch(/—/)
    }
    for (const s of SUB_INDUSTRIES) expect(`${s.es}${s.en}`).not.toMatch(/—/)
  })
})

describe('busqueda type-ahead', () => {
  test('ignora acentos y mayusculas', () => {
    expect(normalizeSearch('  CAFÉ ')).toBe('cafe')
    const a = searchSubIndustries('Café').map(s => `${s.industry}::${s.key}`)
    const b = searchSubIndustries('cafe').map(s => `${s.industry}::${s.key}`)
    expect(a).toEqual(b)
  })
  test('consulta vacia devuelve el catalogo (o la industria) acotado por limit', () => {
    expect(searchSubIndustries('', { limit: 5 })).toHaveLength(5)
    const inTech = searchSubIndustries('', { industry: 'Technology', limit: 50 })
    expect(inTech.every(s => s.industry === 'Technology')).toBe(true)
  })
  test('con industria elegida busca solo dentro de ella', () => {
    const r = searchSubIndustries('a', { industry: 'Energy', limit: 50 })
    expect(r.every(s => s.industry === 'Energy')).toBe(true)
  })
  test('los sinonimos encuentran algo y siempre hay resultado coherente', () => {
    for (const q of ['sports', 'bank', 'software']) {
      expect(searchSubIndustries(q).length).toBeGreaterThan(0)
    }
    expect(searchSubIndustries('zzzzqx')).toEqual([])
  })
})

describe('arquetipo por clasificacion explicita', () => {
  test('la subindustria especial gana a la industria madre', () => {
    expect(archetypeForClassification('Financials', 'Banking')).toEqual({ archetype: 'BANK', source: 'subindustry' })
    expect(archetypeForClassification('Financials', '')).toEqual({ archetype: 'FINANCE', source: 'industry' })
  })
  test('texto libre de proveedor o industria desconocida no clasifica', () => {
    expect(archetypeForClassification('Banks - Regional', '')).toBe(null)
    expect(archetypeForClassification('Consumer', '')).toBe(null)
    expect(archetypeForClassification(undefined, undefined)).toBe(null)
  })
})
