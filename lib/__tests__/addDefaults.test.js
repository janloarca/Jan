/**
 * FASE QK. `defaults` del alta: los cinco shapes que mandan los callers de la
 * Hoja, y la allowlist. Antes el prop ni existia en AddAccountModal.
 */
import { addDefaults } from '../addDefaults'

describe('addDefaults', () => {
  it('sin nada que sembrar devuelve SIEMPRE las dos llaves vacias', () => {
    expect(addDefaults()).toEqual({ type: '', subtype: '' })
    expect(addDefaults(null)).toEqual({ type: '', subtype: '' })
    expect(addDefaults('Debt')).toEqual({ type: '', subtype: '' })
    expect(addDefaults(42)).toEqual({ type: '', subtype: '' })
    expect(addDefaults({})).toEqual({ type: '', subtype: '' })
  })

  it('DebtSpreadsheet: { isDebt: true } -> tipo Debt y subtipo vacio (lo elige el usuario)', () => {
    expect(addDefaults({ isDebt: true })).toEqual({ type: 'Debt', subtype: '' })
  })

  it('Patrimonio: inmueble, vehiculo y coleccionable', () => {
    expect(addDefaults({ type: 'RealEstate', subtype: 'property' }))
      .toEqual({ type: 'RealEstate', subtype: 'property' })
    expect(addDefaults({ type: 'Alternative', subtype: 'vehicle' }))
      .toEqual({ type: 'Alternative', subtype: 'vehicle' })
    expect(addDefaults({ type: 'Alternative', subtype: 'collectible' }))
      .toEqual({ type: 'Alternative', subtype: 'collectible' })
  })

  it("el subtipo viaja VERBATIM, aunque no sea una opcion del selector ('vehicle' no lo es)", () => {
    // Validarlo contra el catalogo lo borraria y el bien naceria invisible en
    // la pestaña de Patrimonio desde la que se creo.
    expect(addDefaults({ type: 'Alternative', subtype: 'vehicle' }).subtype).toBe('vehicle')
  })

  it("un tipo que el selector no ofrece ('Other') tampoco se valida ni se remapea", () => {
    expect(addDefaults({ type: 'Other' })).toEqual({ type: 'Other', subtype: '' })
  })

  it('un type explicito gana sobre isDebt', () => {
    expect(addDefaults({ isDebt: true, type: 'Loan' })).toEqual({ type: 'Loan', subtype: '' })
  })

  it('isDebt solo cuenta si es EXACTAMENTE true (una cadena "true" no es una bandera)', () => {
    expect(addDefaults({ isDebt: 'true' })).toEqual({ type: '', subtype: '' })
    expect(addDefaults({ isDebt: 1 })).toEqual({ type: '', subtype: '' })
  })

  it('allowlist: cualquier otra llave se ignora y no se cuela al formulario', () => {
    const out = addDefaults({ type: 'Bond', subtype: 'corporate', quantity: 99, currentPrice: 1, name: 'x', isIlliquid: true })
    expect(out).toEqual({ type: 'Bond', subtype: 'corporate' })
    expect(Object.keys(out).sort()).toEqual(['subtype', 'type'])
  })

  it('cadenas en blanco o de otro tipo no siembran nada', () => {
    expect(addDefaults({ type: '   ', subtype: '' })).toEqual({ type: '', subtype: '' })
    expect(addDefaults({ type: 7, subtype: {} })).toEqual({ type: '', subtype: '' })
  })

  it('recorta espacios alrededor', () => {
    expect(addDefaults({ type: '  Bond ', subtype: ' corporate ' })).toEqual({ type: 'Bond', subtype: 'corporate' })
  })
})
