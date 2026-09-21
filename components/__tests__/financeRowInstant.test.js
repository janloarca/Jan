import { render, screen } from '@testing-library/react'
import FinanceTransactionList from '@/components/finance/FinanceTransactionList'

// jsdom no trae ResizeObserver. FinanceTransactionList monta SegmentedTabs
// para su filtro Todos/Ingresos/Gastos, y SegmentedTabs usa useEdgeFade, que
// instancia uno para medir su propio scroll. Es el primer test de este repo
// que combina "componente con SegmentedTabs" + "render() de testing-library",
// así que el hueco del entorno nunca se había topado con nada: se arregla el
// arnés (un stub mudo), nunca la app ni el hook real.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = global.ResizeObserver || ResizeObserverStub

// FASE OP. La fila mezclaba DOS zonas horarias: el día salía de `tx.date` (una
// cadena leída por recorte de texto) y la hora del instante en la zona del
// lector. Cuando el instante llega en forma Zulu, ese día es el UTC, así que una
// compra de las 20:00 del 16 en Guatemala se imprimía **"17/09/2026 20:00"**:
// el día de mañana con la hora de hoy.
//
// La suite corre fijada en America/Guatemala (FASE LF), que es lo que hace que
// esto se pueda probar: en UTC las dos lecturas coinciden y el test pasaría sin
// probar nada. De ahí el meta-test de abajo.
const ZULU = '2026-09-17T02:00:00Z' // = 16 sep 20:00 en Guatemala

const row = (over = {}) => ({
  id: 't1', type: 'EXPENSE', amount: 552, currency: 'GTQ',
  description: 'Simons', category: 'Otros Gastos',
  date: '2026-09-17', occurredAt: ZULU, _source: 'auto_shortcut', ...over,
})

describe('FASE OP: el día y la hora de una fila salen del MISMO instante', () => {
  it('meta: la suite corre al oeste de UTC, o esto no probaría nada', () => {
    expect(new Date(ZULU).getHours()).toBe(20)
    expect(new Date(ZULU).getDate()).toBe(16)
  })

  it('una compra de las 20:00 no se imprime con la fecha de mañana', () => {
    render(<FinanceTransactionList transactions={[row()]} lang="es" />)
    // Regresión NEGATIVA: esto era exactamente lo que se veía en pantalla.
    expect(screen.queryAllByText(/17\/09\/2026 20:00/).length).toBe(0)
    expect(screen.getAllByText(/16\/09\/2026 20:00/).length).toBeGreaterThan(0)
  })

  it('sin instante la fila conserva su fecha guardada, como siempre', () => {
    render(<FinanceTransactionList transactions={[row({ occurredAt: null, date: '2026-09-08' })]} lang="es" />)
    expect(screen.getAllByText(/08\/09\/2026/).length).toBeGreaterThan(0)
  })

  it('un instante ilegible no rompe la fila: cae a la fecha guardada', () => {
    render(<FinanceTransactionList transactions={[row({ occurredAt: 'no-es-una-fecha', date: '2026-09-08' })]} lang="es" />)
    expect(screen.getAllByText(/08\/09\/2026/).length).toBeGreaterThan(0)
  })

  it('una compra de mediodía no se mueve: día y hora ya coincidían', () => {
    render(<FinanceTransactionList
      transactions={[row({ occurredAt: '2026-09-15T18:34:00Z', date: '2026-09-15' })]} lang="es" />)
    expect(screen.getAllByText(/15\/09\/2026 12:34/).length).toBeGreaterThan(0)
  })
})
