/**
 * FASE SG (B6): una lectura que falla no es una cuenta vacía.
 *
 * El componente se prueba montado (no una copia de su lógica), y las cuatro
 * pantallas que leen el portafolio se fijan por FUENTE: el gate vive en JSX que
 * jest no puede montar sin Firebase, así que lo que se exige es que cada
 * pantalla distinga el error ANTES de su estado vacío.
 */
const React = require('react')
const { render, screen, fireEvent } = require('@testing-library/react')
const fs = require('fs')
const path = require('path')
const LoadErrorCard = require('../ui/LoadErrorCard').default

describe('LoadErrorCard', () => {
  test('dice que los datos siguen guardados y no afirma una cuenta vacía', () => {
    render(React.createElement(LoadErrorCard, { error: 'permission-denied', lang: 'es', onRetry: () => {} }))
    expect(screen.getByRole('alert').textContent).toMatch(/siguen guardados/)
    expect(screen.getByRole('alert').textContent).not.toMatch(/Aún no/)
    expect(screen.getByText('permission-denied')).toBeTruthy()
  })

  test('Reintentar llama al handler', () => {
    const onRetry = jest.fn()
    render(React.createElement(LoadErrorCard, { error: 'unavailable', lang: 'es', onRetry }))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('tuteo, nunca voseo', () => {
    render(React.createElement(LoadErrorCard, { error: 'x', lang: 'es', onRetry: () => {} }))
    const txt = screen.getByRole('alert').textContent
    expect(txt).not.toMatch(/volvé|revisá|intentá/i)
  })

  test('en inglés', () => {
    render(React.createElement(LoadErrorCard, { error: null, lang: 'en', onRetry: () => {} }))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('las cuatro pantallas distinguen error de vacío', () => {
  const root = path.join(__dirname, '..', '..')
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
  const cases = [
    ['app/dashboard/page.jsx', 'loadError'],
    ['app/spreadsheet/page.jsx', 'loadError'],
    ['app/costs/page.jsx', 'loadError'],
    ['app/finances/page.jsx', 'financeLoadError'],
  ]
  test.each(cases)('%s renderiza LoadErrorCard con %s', (file, field) => {
    const src = read(file)
    expect(src).toMatch(/import LoadErrorCard from '@\/components\/ui\/LoadErrorCard'/)
    expect(src).toMatch(new RegExp(`<LoadErrorCard error=\\{${field}\\}`))
  })

  test('el hook expone financeLoadError', () => {
    expect(read('hooks/useFirestoreItems.js')).toMatch(/setFinanceLoadError\(e\?\.code/)
  })
})
