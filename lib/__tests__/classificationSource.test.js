import { industrySourceOf, classificationSourceFor, showAutoDetected, INDUSTRY_SOURCES } from '../classificationSource'
import {
  COUNTRY_REGIONS, groupCountryOptions, TAX_JURISDICTION_OPTIONS, ASSET_COUNTRY_OPTIONS,
} from '@/components/dashboard/utils'

describe('origen de la industria (FASE PT)', () => {
  test('solo hay dos origenes honestos, y ninguno es "inferred"', () => {
    expect(INDUSTRY_SOURCES).toEqual(['api', 'user'])
  })

  test('un item sin marca (todo lo guardado antes) no afirma nada', () => {
    expect(industrySourceOf({ industry: 'Technology' })).toBeNull()
    expect(industrySourceOf(null)).toBeNull()
    expect(industrySourceOf({ classificationSource: { industry: 'inferred' } })).toBeNull()
  })

  test('lee el origen guardado', () => {
    expect(industrySourceOf({ classificationSource: { industry: 'api' } })).toBe('api')
    expect(industrySourceOf({ classificationSource: { industry: 'user' } })).toBe('user')
  })

  test('sin industria no se registra origen (no se afirma algo sobre un campo vacio)', () => {
    expect(classificationSourceFor({ industry: '', industrySource: 'api' })).toBeNull()
    expect(classificationSourceFor({ industry: 'Energy', industrySource: '' })).toBeNull()
    expect(classificationSourceFor({ industry: 'Energy', industrySource: 'basura' })).toBeNull()
    expect(classificationSourceFor({ industry: 'Energy', industrySource: 'api' })).toEqual({ industry: 'api' })
  })

  test('"Auto-detectado" solo mientras el valor es el del proveedor', () => {
    expect(showAutoDetected({ industry: 'Banks - Regional', industrySource: 'api' })).toBe(true)
    // el usuario lo cambio: pasa a 'user' y la linea desaparece sola
    expect(showAutoDetected({ industry: 'Banks - Regional', industrySource: 'user' })).toBe(false)
    // sin industria no hay nada que corregir
    expect(showAutoDetected({ industry: '', industrySource: 'api' })).toBe(false)
    // sin marca (dato viejo) no se muestra
    expect(showAutoDetected({ industry: 'Energy', industrySource: '' })).toBe(false)
  })
})

describe('paises agrupados por region (FASE PT)', () => {
  test('todas las opciones de las dos listas pertenecen a una region conocida', () => {
    const known = new Set(COUNTRY_REGIONS.map(r => r.key))
    for (const o of [...TAX_JURISDICTION_OPTIONS, ...ASSET_COUNTRY_OPTIONS]) {
      expect(known.has(o.region)).toBe(true)
    }
  })

  test('el agrupado no pierde ni duplica ninguna opcion', () => {
    for (const list of [TAX_JURISDICTION_OPTIONS, ASSET_COUNTRY_OPTIONS]) {
      const flat = groupCountryOptions(list).flatMap(g => g.options.map(o => o.key))
      expect(flat.slice().sort()).toEqual(list.map(o => o.key).sort())
    }
  })

  test('Latinoamerica va primero, y no se devuelven grupos vacios', () => {
    const g = groupCountryOptions(TAX_JURISDICTION_OPTIONS)
    expect(g[0].key).toBe('latam')
    expect(g.every(x => x.options.length > 0)).toBe(true)
    // la jurisdiccion fiscal no trae Europa ni Asia: esos grupos no existen
    expect(g.map(x => x.key)).toEqual(['latam', 'northamerica', 'other'])
  })

  test('una region desconocida cae en "Otros" en vez de desaparecer', () => {
    const g = groupCountryOptions([{ key: 'XX', region: 'marte', es: 'X', en: 'X' }])
    expect(g).toHaveLength(1)
    expect(g[0].key).toBe('other')
  })
})
