// FASE SB (B9): una FECHA DE CALENDARIO (registro diario, snapshot, ancla del
// año, sesión del último cierre) se muestra desde su clave de día y nunca
// desde la medianoche UTC convertida a hora local, que al oeste de UTC
// retrocede un día. La suite corre en America/Guatemala (jest.config.js), y el
// meta-test de abajo falla si eso deja de ser cierto: en UTC los demás pasarían
// sin probar nada.
import { formatDate, formatShortDate, setLang } from '../../components/dashboard/utils'
import { dayPointLabel } from '../dayPointLabel'
import { ymOfDate } from '../dateParts'

beforeAll(() => setLang('en'))

test('meta: la suite corre al oeste de UTC', () => {
  expect(new Date('2026-01-01').getDate()).toBe(31)
  expect(new Date('2026-01-01').getFullYear()).toBe(2025)
})

describe('formatDate muestra el día de la clave', () => {
  test('cadena YYYY-MM-DD', () => {
    expect(formatDate('2026-01-01')).toMatch(/Jan 1, 2026/)
  })
  test('timestamp de la medianoche UTC del día (ancla del YTD)', () => {
    expect(formatDate(Date.UTC(2026, 0, 1))).toMatch(/Jan 1, 2026/)
  })
  test('clave del último cierre como `${day}T00:00:00Z`', () => {
    expect(formatDate('2026-11-13T00:00:00Z')).toMatch(/Nov 13, 2026/)
  })
  test('un instante real conserva su día local', () => {
    // 2026-11-14 03:00Z son las 21:00 del 13 en Guatemala.
    expect(formatDate('2026-11-14T03:00:00Z')).toMatch(/Nov 13, 2026/)
  })
})

test('formatShortDate no corre el mes del ancla del 1 de enero', () => {
  expect(formatShortDate('2026-01-01')).toMatch(/Jan 26/)
})

test('dayPointLabel rotula un registro diario con su fecha', () => {
  expect(dayPointLabel(Date.UTC(2026, 10, 13), 'en')).toMatch(/Nov 13/)
})

test('el año de un día calendario se lee del texto (selector de años de la Hoja)', () => {
  expect(ymOfDate('2026-01-01').y).toBe(2026)
})
