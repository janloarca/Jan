import { planPortfolioDelete, activePortfolioAfterDelete } from '../portfolioDelete'

const items = [
  { id: 'a', portfolioId: 'pB' }, { id: 'b', portfolioId: 'pB' }, { id: 'c', portfolioId: 'pA' }, { id: 'd' },
]
const lots = [{ id: 'l1', portfolioId: 'pB' }, { id: 'l2' }]
const transactions = [{ id: 't1', portfolioId: 'pB' }, { id: 't2', _linkedItemId: 'a' }]

describe('FASE OI: planPortfolioDelete', () => {
  it('nombra exactamente lo etiquetado con ese portafolio, y nada más', () => {
    const p = planPortfolioDelete('pB', { items, lots, transactions })
    expect(p).toEqual({ itemIds: ['a', 'b'], lotIds: ['l1'], transactionIds: ['t1'], refused: null })
  })
  it('un ítem de OTRO portafolio o sin etiqueta no entra (borrar B no toca A ni el default)', () => {
    const p = planPortfolioDelete('pB', { items, lots, transactions })
    expect(p.itemIds).not.toContain('c'); expect(p.itemIds).not.toContain('d')
  })
  it('rehúsa los pseudo-portafolios: "Todos" y el default implícito no son documentos', () => {
    expect(planPortfolioDelete('__all__', { items }).refused).toBe('pseudo-portfolio')
    expect(planPortfolioDelete('__default__', { items }).refused).toBe('pseudo-portfolio')
    expect(planPortfolioDelete('', { items }).refused).toBe('no-id')
    expect(planPortfolioDelete(undefined, { items }).itemIds).toEqual([])
  })
  it('tolera colecciones ausentes', () => {
    expect(planPortfolioDelete('pB', {})).toEqual({ itemIds: [], lotIds: [], transactionIds: [], refused: null })
  })
})

describe('FASE OI: activePortfolioAfterDelete', () => {
  it('borrar el portafolio ACTIVO devuelve la vista a Todos; borrar otro la deja quieta', () => {
    expect(activePortfolioAfterDelete('pB', 'pB')).toBe('__all__')
    expect(activePortfolioAfterDelete('pA', 'pB')).toBe('pA')
    expect(activePortfolioAfterDelete('__all__', 'pB')).toBe('__all__')
  })
})
