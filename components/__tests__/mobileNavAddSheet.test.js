// FASE SE (B3). El «+» del nav móvil abre las cuatro acciones de registrar
// (la MISMA lista `record` del menú «Nuevo») en vez de ir directo al alta.
// Sin acciones (cero activos: recorrido guiado) hace lo de siempre.
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...p }) => <a href={href} {...p}>{children}</a> }))
jest.mock('../../hooks/useInstitutional', () => ({ useInstitutional: () => ({}) }))

const MobileNav = require('../dashboard/MobileNav').default
const { dashboardActionGroups } = require('../../lib/dashboardActions')

function setup(withActions) {
  const calls = []
  const h = (k) => () => calls.push(k)
  const actions = withActions ? dashboardActionGroups({
    lang: 'es', onCashFlow: h('cashflow'), onAddAccount: h('add'), onSell: h('sell'), onTransfer: h('transfer'),
  }).record : null
  render(<MobileNav lang="es" onAdd={h('direct')} addActions={actions} onImport={() => {}} onExport={() => {}} onShare={() => {}} onSettings={() => {}} />)
  return calls
}

describe('FASE SE: un solo «+» con cuatro acciones', () => {
  it('abre las cuatro acciones y cada una llama a su handler', () => {
    const calls = setup(true)
    fireEvent.click(screen.getByLabelText('Agregar'))
    expect(calls).toEqual([])
    const items = screen.getAllByRole('menuitem')
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Agregar o retirar dinero'),
      expect.stringContaining('Agregar posición'),
      expect.stringContaining('Vender'),
      expect.stringContaining('Transferir'),
    ])
    fireEvent.click(items[2])
    expect(calls).toEqual(['sell'])
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })

  it('sin acciones (cero activos) el «+» va directo como siempre', () => {
    const calls = setup(false)
    fireEvent.click(screen.getByLabelText('Agregar'))
    expect(calls).toEqual(['direct'])
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})
