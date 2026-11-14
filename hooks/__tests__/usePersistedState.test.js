import { renderHook, act, render, fireEvent, screen } from '@testing-library/react'
import usePersistedState, { readPersisted } from '../usePersistedState'
import SectionCollapse from '../../components/dashboard/SectionCollapse'
import ChispuSuggestions from '../../components/dashboard/ChispuSuggestions'

beforeEach(() => window.localStorage.clear())

describe('usePersistedState', () => {
  test('recuerda el valor entre montajes', () => {
    const a = renderHook(() => usePersistedState('k1', 'type'))
    act(() => a.result.current[1]('sector'))
    a.unmount()
    const b = renderHook(() => usePersistedState('k1', 'type'))
    expect(b.result.current[0]).toBe('sector')
  })

  test('un valor fuera de la lista permitida cae al default', () => {
    window.localStorage.setItem('k2', JSON.stringify('ya-no-existe'))
    expect(readPersisted('k2', 'type', ['type', 'sector'])).toBe('type')
  })

  test('un booleano guardado con otro tipo cae al default', () => {
    window.localStorage.setItem('k3', '"si"')
    expect(readPersisted('k3', false)).toBe(false)
  })

  test('JSON roto no revienta', () => {
    window.localStorage.setItem('k4', '{oops')
    expect(readPersisted('k4', true)).toBe(true)
  })

  test('sin llave se comporta como useState', () => {
    const { result } = renderHook(() => usePersistedState(null, 1))
    act(() => result.current[1](2))
    expect(result.current[0]).toBe(2)
    expect(window.localStorage.length).toBe(0)
  })
})

describe('SectionCollapse', () => {
  test('respeta la elección guardada con el formato viejo', () => {
    window.localStorage.setItem('section-goals', '0')
    render(<SectionCollapse id="goals" title="Metas" defaultOpen><p>adentro</p></SectionCollapse>)
    expect(screen.queryByText('adentro')).toBeNull()
  })

  test('plegar se recuerda al volver', () => {
    const first = render(<SectionCollapse id="x" title="X" defaultOpen><p>adentro</p></SectionCollapse>)
    fireEvent.click(screen.getByRole('button'))
    first.unmount()
    render(<SectionCollapse id="x" title="X" defaultOpen><p>adentro</p></SectionCollapse>)
    expect(screen.queryByText('adentro')).toBeNull()
  })
})

describe('Chispu te sugiere plegable', () => {
  const findings = [{ id: 'no-country:a', code: 'no-country', itemId: 'a', severity: 'medium', textEs: 'Falta el país de A', textEn: 'Missing A country', action: null }]

  test('plegada conserva el conteo y se recuerda', () => {
    const first = render(<ChispuSuggestions findings={findings} lang="es" />)
    expect(screen.getByText('Falta el país de A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /chispu te sugiere/i }))
    expect(screen.queryByText('Falta el país de A')).toBeNull()
    expect(screen.getByText(/1 pendiente/)).toBeTruthy()
    first.unmount()
    render(<ChispuSuggestions findings={findings} lang="es" />)
    expect(screen.queryByText('Falta el país de A')).toBeNull()
  })
})
