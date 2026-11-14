import { guidedProgress } from '../guidedProgress'

describe('guidedProgress (FASE SC B2)', () => {
  test('cuenta lo resuelto contra el total fijado al abrir', () => {
    expect(guidedProgress(24, 21)).toEqual({ done: 3, total: 24, pct: 13, complete: false })
  })
  test('sin pendientes al abrir no hay barra', () => {
    expect(guidedProgress(0, 0)).toBeNull()
    expect(guidedProgress(null, 3)).toBeNull()
  })
  test('un hallazgo nuevo no vuelve negativo el avance', () => {
    expect(guidedProgress(5, 7).done).toBe(0)
  })
  test('todo resuelto marca completo', () => {
    expect(guidedProgress(5, 0)).toEqual({ done: 5, total: 5, pct: 100, complete: true })
  })
})
