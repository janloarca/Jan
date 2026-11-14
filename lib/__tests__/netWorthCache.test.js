import { readNetWorthCache, writeNetWorthCache, netWorthCacheKey } from '../netWorthCache'

const NOW = Date.UTC(2026, 10, 14, 15, 0, 0)
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => { window.localStorage.clear() })

describe('netWorthCache (primer pintado, FASE SB A2)', () => {
  test('lo escrito se lee igual, con su moneda y sus cifras', () => {
    writeNetWorthCache('u1', { netWorth: 27292.25, baseCurrency: 'USD', returnYTD: 2.38, ytdChange: 508.29, dailyChange: { abs: -41.8, pct: -0.42 }, savedAt: NOW })
    const c = readNetWorthCache('u1', 'USD', NOW + 1000)
    expect(c).toMatchObject({ netWorth: 27292.25, baseCurrency: 'USD', returnYTD: 2.38, ytdChange: 508.29, dailyChange: { abs: -41.8, pct: -0.42 } })
  })

  test('dos usuarios en el mismo navegador no se cruzan', () => {
    writeNetWorthCache('u1', { netWorth: 100, baseCurrency: 'USD', savedAt: NOW })
    expect(readNetWorthCache('u2', 'USD', NOW)).toBeNull()
    expect(netWorthCacheKey('u1')).not.toBe(netWorthCacheKey('u2'))
  })

  test('otra moneda base no se muestra: la cifra estaria en otra unidad', () => {
    writeNetWorthCache('u1', { netWorth: 100, baseCurrency: 'USD', savedAt: NOW })
    expect(readNetWorthCache('u1', 'GTQ', NOW)).toBeNull()
  })

  test('mas de 7 dias ya no describe el patrimonio de hoy', () => {
    writeNetWorthCache('u1', { netWorth: 100, baseCurrency: 'USD', savedAt: NOW })
    expect(readNetWorthCache('u1', 'USD', NOW + 6 * DAY)).not.toBeNull()
    expect(readNetWorthCache('u1', 'USD', NOW + 8 * DAY)).toBeNull()
  })

  test('una marca en el futuro (reloj corrido) se descarta', () => {
    writeNetWorthCache('u1', { netWorth: 100, baseCurrency: 'USD', savedAt: NOW + DAY })
    expect(readNetWorthCache('u1', 'USD', NOW)).toBeNull()
  })

  test('sin cifra valida no se escribe nada', () => {
    expect(writeNetWorthCache('u1', { netWorth: NaN, baseCurrency: 'USD' })).toBe(false)
    expect(writeNetWorthCache('', { netWorth: 1 })).toBe(false)
    expect(readNetWorthCache('u1', 'USD', NOW)).toBeNull()
  })

  test('JSON roto o localStorage que lanza: "no hay cache", nunca un error', () => {
    window.localStorage.setItem(netWorthCacheKey('u1'), '{no es json')
    expect(readNetWorthCache('u1', 'USD', NOW)).toBeNull()
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(readNetWorthCache('u1', 'USD', NOW)).toBeNull()
    spy.mockRestore()
    const spy2 = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota') })
    expect(writeNetWorthCache('u1', { netWorth: 1, baseCurrency: 'USD' })).toBe(false)
    spy2.mockRestore()
  })

  test('un HOY incompleto no se inventa', () => {
    writeNetWorthCache('u1', { netWorth: 100, baseCurrency: 'USD', dailyChange: { abs: 5 }, savedAt: NOW })
    expect(readNetWorthCache('u1', 'USD', NOW).dailyChange).toBeNull()
  })
})
