/**
 * @jest-environment node
 */
// La primera prueba real del correo imprimió "Bitcoin +0.00%": el endpoint que
// usaba no trae cambio de 7 días, así que el código fabricaba una serie plana
// y afirmaba que la cripto no se movió cuando en realidad no lo sabíamos.
// Estos tests fijan que un dato ausente produzca una fila SIN porcentaje.

import { makeBriefFetcher } from '../briefFetcher'
import { windowChangePct } from '../marketBrief'

const mockFetch = (payload, ok = true) => {
  global.fetch = jest.fn(async () => ({
    ok, status: ok ? 200 : 500, json: async () => payload,
  }))
}

afterEach(() => { delete global.fetch })

describe('serie de cripto para el brief', () => {
  test('con cambio semanal real, la serie reproduce ese cambio', async () => {
    mockFetch([{ id: 'bitcoin', current_price: 110, price_change_percentage_7d_in_currency: 10 }])
    const series = await makeBriefFetcher()('BTC', 'crypto')
    expect(series.closes[series.closes.length - 1]).toBe(110)
    // 110 desde 100 = +10%
    expect(windowChangePct(series.closes, 5)).toBeCloseTo(10, 4)
  })

  test('SIN cambio semanal devuelve un solo cierre: la fila sale sin % inventado', async () => {
    mockFetch([{ id: 'bitcoin', current_price: 63127, price_change_percentage_7d_in_currency: null }])
    const series = await makeBriefFetcher()('BTC', 'crypto')
    expect(series.closes).toEqual([63127])
    // Un solo punto no alcanza para medir una semana: null, no 0.
    expect(windowChangePct(series.closes, 5)).toBeNull()
  })

  test('el proveedor caído devuelve null y el instrumento se omite', async () => {
    mockFetch(null, false)
    expect(await makeBriefFetcher()('BTC', 'crypto')).toBeNull()
  })

  test('una sola llamada cubre BTC y ETH', async () => {
    mockFetch([
      { id: 'bitcoin', current_price: 100, price_change_percentage_7d_in_currency: 5 },
      { id: 'ethereum', current_price: 50, price_change_percentage_7d_in_currency: -2 },
    ])
    const fetcher = makeBriefFetcher()
    await fetcher('BTC', 'crypto')
    await fetcher('ETH', 'crypto')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
