/** @jest-environment jsdom */
// FASE ??. Verificado contra el componente REAL (testing-library), nunca
// props hechos a mano: la lección de FASE GQ3. Dos invariantes de esta
// pasada — applySuggestion sigue el mismo patrón async/await/try-catch
// que ChispuSuggestions.jsx (nunca marca "Aplicado" antes de que
// Firestore confirme), y el progreso del wizard (índice + revisados)
// sobrevive a un ciclo desmontar/remontar cuando page.jsx le devuelve
// startItemId/initialReviewed con lo que onNavigate/onItemReviewed ya
// reportaron (el caso real: abrir EditAccountModal desde adentro del
// wizard lo desmonta, y cerrarlo lo remonta desde cero).
const React = require('react')
const { render, screen, fireEvent, waitFor } = require('@testing-library/react')
const AccountReviewModal = require('../AccountReviewModal').default

const itemA = {
  id: 'a', name: 'Cuenta A', symbol: 'A', type: 'Bank', quantity: 1,
  currentPrice: 1000, purchasePrice: 1000, currency: 'USD', institution: 'X', acquisitionDate: '2025-01-01',
}
const itemB = {
  id: 'b', name: 'Cuenta B', symbol: 'B', type: 'Bank', quantity: 1,
  currentPrice: 500, purchasePrice: 500, currency: 'USD', institution: 'Y', acquisitionDate: '2025-01-01',
}

function show(props) {
  return render(React.createElement(AccountReviewModal, {
    items: [itemA, itemB], transactions: [], onClose: () => {}, onEditItem: () => {},
    lang: 'es', findings: [], convert: (a) => a, baseCurrency: 'USD', ...props,
  }))
}

describe('AccountReviewModal: applySuggestion async, paridad con ChispuSuggestions (FASE NB)', () => {
  const finding = {
    id: 'no-acq-date:a', code: 'no-acq-date', severity: 'medium', itemId: 'a',
    textEs: 'Falta fecha de compra', textEn: 'Missing purchase date',
    action: { kind: 'edit-item', field: 'acquisitionDate' },
    suggestion: { patch: { acquisitionDate: '2025-01-02' }, textEs: 'Usar 2025-01-02', textEn: 'Use 2025-01-02' },
  }

  it('no marca "Aplicado" hasta que la promesa de onApplySuggestion resuelve', async () => {
    let resolvePromise
    const onApplySuggestion = jest.fn(() => new Promise((res) => { resolvePromise = res }))
    show({ findings: [finding], onApplySuggestion })

    fireEvent.click(screen.getByRole('button', { name: 'Usar esto' }))
    expect(onApplySuggestion).toHaveBeenCalledWith('a', { acquisitionDate: '2025-01-02' })
    // Todavía en vuelo: sin confirmación de Firestore, "Aplicado" no puede
    // estar ahí (era exactamente el bug: se marcaba al disparar).
    expect(screen.queryByText(/Aplicado/)).toBeNull()

    resolvePromise()
    await waitFor(() => expect(screen.getByText('✓ Aplicado')).toBeTruthy())
  })

  it('si la promesa rechaza, muestra el error y "Usar esto" sigue ofrecido (no se pierde el guardado)', async () => {
    const onApplySuggestion = jest.fn(() => Promise.reject(new Error('offline')))
    show({ findings: [finding], onApplySuggestion })

    fireEvent.click(screen.getByRole('button', { name: 'Usar esto' }))
    // Este repo no registra los matchers de @testing-library/jest-dom
    // (toHaveTextContent no existe acá): se compara .textContent crudo,
    // mismo patrón que accountReviewReturn.test.js.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No se pudo guardar. Toca "Usar esto" otra vez.'))
    expect(screen.queryByText('✓ Aplicado')).toBeNull()
    expect(screen.getByRole('button', { name: 'Usar esto' })).toBeTruthy()
  })
})

describe('AccountReviewModal: el progreso sobrevive a desmontar/remontar (FASE NB)', () => {
  it('onNavigate/onItemReviewed reportan lo que startItemId/initialReviewed deben devolver para que el wizard aterrice igual', () => {
    const onNavigate = jest.fn()
    const onItemReviewed = jest.fn()
    const { unmount } = show({ onNavigate, onItemReviewed })

    // Arranca en itemA: es el de mayor valor y no hay startItemId.
    expect(screen.getByText('Cuenta A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /OK, siguiente/ }))
    expect(onItemReviewed).toHaveBeenCalledWith('a')
    expect(onNavigate).toHaveBeenCalledWith('b')

    // Simula exactamente lo que page.jsx hace al abrir EditAccountModal
    // desde dentro del wizard: este componente se desmonta...
    unmount()
    // ...y se remonta con el estado que esos dos callbacks ya reportaron
    // (reviewTarget.itemId/reviewedIds en page.jsx), no desde cero.
    show({ startItemId: 'b', initialReviewed: ['a'] })

    expect(screen.getByText('Cuenta B')).toBeTruthy()
    expect(screen.getByText(/1 revisados/)).toBeTruthy()
    // itemA (ya no visible) quedó marcada revisada — reviewedCount cuenta
    // por Object.keys(reviewed).length, no por el ítem en pantalla.
  })

  it('sin onNavigate/onItemReviewed ni startItemId/initialReviewed, el wizard se comporta como siempre (nada nuevo se vuelve obligatorio)', () => {
    show()
    expect(screen.getByText('Cuenta A')).toBeTruthy()
    expect(screen.getByText(/0 revisados/)).toBeTruthy()
  })
})
