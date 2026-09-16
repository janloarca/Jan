// FASE NT. El panel REAL alimentado por el motor REAL (ibkrJourneyProgress):
// una calibración de IBKR que la app está ignorando se DICE en el paso 4, en
// vez de "Pendiente" a secas sobre un paso que el usuario ya hizo.

const React = require('react')
const { render } = require('@testing-library/react')
const BrokerProgressPanel = require('../BrokerProgressPanel').default
const { ibkrJourneyProgress } = require('../../../lib/ibkrJourney')

const BASE = {
  ibkrConnected: true, ibkrNavDays: 200, ibkrSnapshotSpanDays: 200,
  hasQuarterlyHistory: true, hasIbkrCalibration: false, ibkrCalibrationIgnored: 0, earliestNeededDays: 400,
}

function show(state, lang = 'es') {
  return render(React.createElement(BrokerProgressPanel, {
    progress: ibkrJourneyProgress(state), lang, onOpenStep: () => {},
  }))
}

describe('BrokerProgressPanel: el paso 4 explica una calibración ignorada', () => {
  it('sin nada ignorado el paso 4 dice lo de siempre', () => {
    const { container } = show(BASE)
    expect(container.querySelectorAll('[data-step-attention]')).toHaveLength(0)
    expect(container.textContent).toMatch(/3 de 4 listos/)
  })

  it('con una ignorada el paso 4 lo dice, sigue pendiente y el % no cambia', () => {
    const { container } = show({ ...BASE, ibkrCalibrationIgnored: 1 })
    const att = container.querySelectorAll('[data-step-attention]')
    expect(att).toHaveLength(1)
    expect(att[0].textContent).toMatch(/la app lo está ignorando/)
    expect(att[0].textContent).toMatch(/No se deshizo nada/)
    // Sigue contando como pendiente: 3 de 4, igual que sin el aviso.
    expect(container.textContent).toMatch(/3 de 4 listos/)
    expect(container.textContent).not.toMatch(/Pendiente/)
  })

  // El hallazgo lateral de FASE NT: sin `ibkrNavDays` en el estado, el paso 2
  // nunca podía marcarse y el viaje quedaba tope en 75%.
  it('el paso 2 se marca listo con NAV real en el archivo', () => {
    const { container } = show({ ...BASE, hasIbkrCalibration: true })
    expect(container.textContent).toMatch(/Todo listo/)
    expect(container.textContent).toMatch(/100%/)
  })
})
