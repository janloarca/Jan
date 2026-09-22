/** @jest-environment jsdom */
// FASE ??. Verificado contra el componente REAL (testing-library), nunca
// props hechos a mano: la lección de FASE GQ3. Dos invariantes del
// arreglo de esta pasada — un hallazgo sin `action` no ofrece ningún
// botón de acción (no-symbol/uncovered-shares: no hay campo editable),
// y "Revisar" en un dup-suspect ancla el wizard al primer ítem señalado
// en vez de abrirlo sin filtrar.
const React = require('react')
const { render, screen, fireEvent } = require('@testing-library/react')
const ChispuSuggestions = require('../ChispuSuggestions').default

beforeEach(() => { try { localStorage.clear() } catch {} })

const noActionFinding = (over = {}) => ({
  id: 'no-symbol:x1', code: 'no-symbol', severity: 'medium', itemId: 'x1',
  textEs: 'Sin símbolo', textEn: 'No symbol', action: null, suggestion: null, ...over,
})

const dupSuspectFinding = (over = {}) => ({
  id: 'dup-suspect:a', code: 'dup-suspect', severity: 'medium', itemId: 'a',
  textEs: 'Posible duplicado', textEn: 'Possible duplicate',
  action: { kind: 'review', itemIds: ['a', 'b'] }, suggestion: null, ...over,
})

describe('ChispuSuggestions: el botón de acción y el anclaje del review', () => {
  it('no renderiza ningún botón de acción cuando f.action es null (no-symbol/uncovered-shares)', () => {
    render(React.createElement(ChispuSuggestions, {
      findings: [noActionFinding()], globalScore: 80, lang: 'es', items: [],
    }))
    // La fila sí renderizó (el ✕ de descartar existe); lo que falta es
    // el botón de acción, que `runAction` habría caído a su fallback
    // genérico onEditItem(item, undefined) si el guard `f.action &&` no
    // existiera.
    expect(screen.getByRole('button', { name: 'Descartar sugerencia' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Completar/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ver campo/i })).toBeNull()
  })

  it('runAction de un dup-suspect llama a onOpenReview con el PRIMER itemId, no sin argumento', () => {
    const onOpenReview = jest.fn()
    render(React.createElement(ChispuSuggestions, {
      findings: [dupSuspectFinding()], globalScore: 80, lang: 'es', items: [], onOpenReview,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(onOpenReview).toHaveBeenCalledTimes(1)
    expect(onOpenReview).toHaveBeenCalledWith('a')
  })

  it('sin itemIds en la acción, ancla con null (el comportamiento de "sin filtrar" se conserva a propósito)', () => {
    const onOpenReview = jest.fn()
    const noIds = dupSuspectFinding({ id: 'dup-suspect:b', action: { kind: 'review' } })
    render(React.createElement(ChispuSuggestions, {
      findings: [noIds], globalScore: 80, lang: 'es', items: [], onOpenReview,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(onOpenReview).toHaveBeenCalledWith(null)
  })
})
