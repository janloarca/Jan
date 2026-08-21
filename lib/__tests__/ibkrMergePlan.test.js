import { dropDeletesThatAreUpdated } from '../ibkrMergePlan'

describe('dropDeletesThatAreUpdated (FASE KF)', () => {
  it('el caso real: una posicion vendida a cero que se vuelve a comprar', () => {
    // El bucle de reconciliacion la encola como update (el broker la reporta de
    // nuevo) y la limpieza de sobrantes la encola como borrado (cantidad 0 con
    // el simbolo presente en el feed). bulkImport borra primero, asi que el
    // update posterior revienta el commit entero.
    const updateOps = [{ id: 'aapl-1', fields: { quantity: 5 } }]
    expect(dropDeletesThatAreUpdated(['aapl-1'], updateOps)).toEqual([])
  })

  it('los borrados que NO se estan actualizando siguen pasando', () => {
    const updateOps = [{ id: 'aapl-1', fields: { quantity: 5 } }]
    expect(dropDeletesThatAreUpdated(['viejo-1', 'aapl-1', 'viejo-2'], updateOps))
      .toEqual(['viejo-1', 'viejo-2'])
  })

  it('sin updates no toca nada, y conserva el orden', () => {
    expect(dropDeletesThatAreUpdated(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
    expect(dropDeletesThatAreUpdated(['a', 'b'], undefined)).toEqual(['a', 'b'])
  })

  it('tolera listas vacias y entradas sin id', () => {
    expect(dropDeletesThatAreUpdated([], [{ id: 'x' }])).toEqual([])
    expect(dropDeletesThatAreUpdated(undefined, [{ id: 'x' }])).toEqual([])
    expect(dropDeletesThatAreUpdated(['a'], [{ fields: {} }, null])).toEqual(['a'])
  })
})
