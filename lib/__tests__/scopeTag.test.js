// FASE OJ. La única definición de "con qué etiqueta nace un documento nuevo".
const { scopeTagFor, tagForScope } = require('../scopeTag')

describe('scopeTagFor', () => {
  it('con un portafolio y una entidad seleccionados devuelve las dos etiquetas', () => {
    expect(scopeTagFor('pA', 'ent1')).toEqual({ portfolioId: 'pA', entityId: 'ent1' })
  })
  it('los centinelas no son etiquetas: __all__, __default__, default, vacío', () => {
    expect(scopeTagFor('__all__', '__all__')).toEqual({})
    expect(scopeTagFor('__default__', 'default')).toEqual({})
    expect(scopeTagFor(null, undefined)).toEqual({})
    expect(scopeTagFor('', '')).toEqual({})
  })
  it('acepta cada mitad por separado', () => {
    expect(scopeTagFor('pA', 'default')).toEqual({ portfolioId: 'pA' })
    expect(scopeTagFor('__all__', 'ent1')).toEqual({ entityId: 'ent1' })
  })
})

describe('tagForScope', () => {
  it('rellena lo que falta y no toca el resto del documento', () => {
    const doc = { name: 'Fondo', quantity: 1, currentPrice: 500 }
    expect(tagForScope(doc, 'pA', 'default')).toEqual({ ...doc, portfolioId: 'pA' })
  })
  it('una etiqueta que el documento ya trae GANA sobre el alcance', () => {
    expect(tagForScope({ name: 'x', portfolioId: 'pB' }, 'pA', 'ent1')).toEqual({ name: 'x', portfolioId: 'pB', entityId: 'ent1' })
  })
  it('sin alcance devuelve el documento tal cual (byte-idéntico en contenido)', () => {
    const doc = { name: 'x', portfolioId: 'pB' }
    expect(tagForScope(doc, '__all__', '__all__')).toEqual(doc)
    expect(tagForScope(null, 'pA', 'default')).toEqual({ portfolioId: 'pA' })
  })
})
