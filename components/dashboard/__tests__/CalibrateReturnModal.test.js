// FASE NT. El componente REAL (no una copia de su lógica: lección FASE GQ3).
//
// El defecto: `CalibrateReturnModal` recibe `snapshots` y `accountSnapshots`
// YA filtrados, así que una calibración que la app dejó de aplicar (FASE NN /
// FASE NP) no aparecía en la lista, no se podía leer ni QUITAR, y la tarjeta
// mandaba a "copiar el % otra vez" sin que hubiera dónde ver cuál.

const React = require('react')
const { render, screen, fireEvent } = require('@testing-library/react')
const CalibrateReturnModal = require('../CalibrateReturnModal').default

const ITEMS = [
  { id: 'ibkr1', symbol: 'IBKRP', type: 'Stock', quantity: 1, currentPrice: 9954.07, purchasePrice: 6000, _source: 'ibkr', institution: 'Interactive Brokers' },
  { id: 'idc1', symbol: 'VITALI', type: 'Bond', quantity: 1, currentPrice: 6000, purchasePrice: 6000, institution: 'IDC' },
]
const active = {
  id: '2026-01-01~cal~idc', date: '2026-01-01', netWorthUSD: 5500, _account: 'idc', _accountName: 'IDC',
  _source: 'manual', _calibrated: true, _calibrationKind: 'ytd',
}
const ignoredAccount = {
  id: '2026-01-01~cal~ibkr', date: '2026-01-01', netWorthUSD: 9305.22, _account: 'ibkr', _accountName: 'Interactive Brokers',
  _source: 'manual', _calibrated: true, _calibrationKind: 'ytd', _ignoredReason: 'broker-nav',
}
const ignoredGlobal = {
  id: '2026-01-01', date: '2026-01-01', netWorthUSD: 9305.22,
  _source: 'manual', _calibrated: true, _calibrationKind: 'ytd', _ignoredReason: 'neighbor',
}

function show(props = {}) {
  const deleteSnapshot = jest.fn(async () => {})
  const utils = render(React.createElement(CalibrateReturnModal, {
    onClose: () => {}, netWorth: 15954, transactions: [], convert: (a) => a, baseCurrency: 'USD',
    snapshots: [], accountSnapshots: [active], ignoredCalibrations: [], items: ITEMS,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot, lang: 'es',
    ...props,
  }))
  return { ...utils, deleteSnapshot }
}

describe('CalibrateReturnModal: las calibraciones ignoradas se ven y se pueden quitar', () => {
  it('sin ignoradas la lista es la de siempre: "activas" y ninguna fila marcada', () => {
    const { container } = show()
    expect(screen.getByText('Calibraciones activas')).toBeTruthy()
    expect(container.querySelectorAll('[data-calibration-row="ignored"]')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/ignorada/)
  })

  it('una calibración por cuenta ignorada se lista con su razón y el encabezado deja de decir "activas"', () => {
    const { container } = show({ ignoredCalibrations: [ignoredAccount] })
    expect(screen.getByText('Calibraciones guardadas')).toBeTruthy()
    expect(screen.queryByText('Calibraciones activas')).toBeNull()
    const rows = container.querySelectorAll('[data-calibration-row="ignored"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/Interactive Brokers/)
    expect(rows[0].textContent).toMatch(/ignorada: el % no cuadra con el NAV/)
    // La activa sigue ahí, sin marca.
    expect(container.querySelectorAll('[data-calibration-row="active"]')).toHaveLength(1)
  })

  it('un ancla global ignorada dice su razón (el vecino) y se rotula como todo el portafolio', () => {
    const { container } = show({ ignoredCalibrations: [ignoredGlobal] })
    const row = container.querySelector('[data-calibration-row="ignored"]')
    expect(row.textContent).toMatch(/Todo el portafolio/)
    expect(row.textContent).toMatch(/día de al lado/)
  })

  it('"Quitar" sobre una ignorada borra EXACTAMENTE su documento', () => {
    const { container, deleteSnapshot } = show({ ignoredCalibrations: [ignoredAccount] })
    const row = container.querySelector('[data-calibration-row="ignored"]')
    fireEvent.click(row.querySelector('button'))
    expect(deleteSnapshot).toHaveBeenCalledTimes(1)
    expect(deleteSnapshot).toHaveBeenCalledWith('2026-01-01~cal~ibkr')
  })

  it('el período de una ignorada se marca como "ya calibrado: se reemplaza" para su cuenta', () => {
    // Re-guardar escribe el MISMO id, o sea reemplaza: ese es el remedio, y el
    // punto ámbar tiene que decirlo aunque la calibración esté ignorada.
    const { container } = show({ ignoredCalibrations: [ignoredAccount], preferredAccount: 'ibkr' })
    const dots = container.querySelectorAll('[title="Ya calibrado: se reemplaza"]')
    expect(dots).toHaveLength(1)
  })

  it('en inglés la razón también se traduce', () => {
    const { container } = show({ ignoredCalibrations: [ignoredAccount], lang: 'en' })
    expect(screen.getByText('Saved calibrations')).toBeTruthy()
    expect(container.textContent).toMatch(/ignored: the % does not match the NAV/)
  })
})
