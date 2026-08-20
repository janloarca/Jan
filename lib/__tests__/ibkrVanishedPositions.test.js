import { vanishedIbkrPositionIds } from '../ibkrVanishedPositions'

const stored = (over = {}) => ({ id: 'i1', _source: 'ibkr', symbol: 'AAPL', quantity: 10, _ibkrAccountId: 'U1', ...over })
const feed = (over = {}) => ({ symbol: 'MSFT', quantity: 5, ...over })

describe('vanishedIbkrPositionIds', () => {
  it('borra la posición que el broker ya no reporta (el caso del bug)', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [stored({ id: 'vendida', symbol: 'AAPL' }), stored({ id: 'viva', symbol: 'MSFT' })],
      feedItems: [feed({ symbol: 'MSFT' })],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual(['vendida'])
  })

  it('GUARDA 1: un feed sin posiciones no borra NADA', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [stored(), stored({ id: 'i2', symbol: 'MSFT' })],
      feedItems: [],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual([])
  })

  it('GUARDA 1: un feed con posiciones sin símbolo tampoco cuenta como feed', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [stored()],
      feedItems: [{ quantity: 3 }],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual([])
  })

  it('GUARDA 2: nunca toca un item que el usuario escribió a mano', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [
        stored({ id: 'manual', _source: undefined, institution: 'Interactive Brokers' }),
        stored({ id: 'manual2', _source: 'manual_new_account', institution: 'Interactive Brokers' }),
      ],
      feedItems: [feed()],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual([])
  })

  it('GUARDA 3: no borra efectivo si el reporte no trae Cash Report', () => {
    const args = {
      storedItems: [stored({ id: 'cash', symbol: 'CASH-USD' })],
      feedItems: [feed()],
      feedAccounts: ['U1'],
    }
    expect(vanishedIbkrPositionIds({ ...args, hasCashSection: false })).toEqual([])
    // Con la sección presente, un efectivo que ya no viene sí se retira.
    expect(vanishedIbkrPositionIds({ ...args, hasCashSection: true })).toEqual(['cash'])
  })

  it('GUARDA 4: no borra posiciones de una cuenta que este reporte no cubre', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [
        stored({ id: 'otraCuenta', symbol: 'TSLA', _ibkrAccountId: 'U2' }),
        stored({ id: 'estaCuenta', symbol: 'NVDA', _ibkrAccountId: 'U1' }),
      ],
      feedItems: [feed()],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual(['estaCuenta'])
  })

  it('GUARDA 4: sin accountId en el item, solo borra si el feed trae UNA cuenta', () => {
    const args = {
      storedItems: [stored({ id: 'sinCuenta', symbol: 'TSLA', _ibkrAccountId: undefined })],
      feedItems: [feed()],
    }
    expect(vanishedIbkrPositionIds({ ...args, feedAccounts: ['U1'] })).toEqual(['sinCuenta'])
    expect(vanishedIbkrPositionIds({ ...args, feedAccounts: ['U1', 'U2'] })).toEqual([])
    // Sin lista de cuentas tampoco hay ambigüedad que resolver: se borra.
    expect(vanishedIbkrPositionIds({ ...args, feedAccounts: [] })).toEqual(['sinCuenta'])
  })

  it('compara símbolos sin distinguir mayúsculas ni espacios', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [stored({ symbol: ' aapl ' })],
      feedItems: [feed({ symbol: 'AAPL' })],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual([])
  })

  it('ignora items sin id o sin símbolo, que no se pueden borrar con seguridad', () => {
    const ids = vanishedIbkrPositionIds({
      storedItems: [stored({ id: undefined }), stored({ id: 'x', symbol: '' })],
      feedItems: [feed()],
      feedAccounts: ['U1'],
    })
    expect(ids).toEqual([])
  })

  it('tolera basura sin explotar', () => {
    expect(vanishedIbkrPositionIds()).toEqual([])
    expect(vanishedIbkrPositionIds({ storedItems: [null], feedItems: [null] })).toEqual([])
  })
})
