/**
 * @jest-environment node
 */
// FASE IE2. El contador del rate limit es POR RUTA + IP. El bug real (reporte
// con captura): ~30 rutas compartían UN contador por IP, así que el tráfico
// normal del dashboard (precios + tasas + historial, tope 60) consumía el
// minuto y el botón "Enviarme una prueba" (tope 5) respondía "Too many
// requests" sin que el usuario lo hubiera tocado ni una vez.

import { rateLimit } from '../rateLimit'

const req = (path, ip = '1.2.3.4') => ({
  url: `https://chispu.xyz${path}`,
  headers: { get: (h) => (h === 'x-real-ip' ? ip : null) },
})

describe('rateLimit: contador por ruta, no global por IP', () => {
  test('el tráfico pesado de una ruta NO consume el presupuesto de otra (el caso del botón de prueba)', async () => {
    const ip = '10.0.0.1'
    // 30 llamadas del dashboard a precios en el mismo minuto...
    for (let i = 0; i < 30; i++) {
      await rateLimit(req('/api/prices', ip), { maxRequests: 60 })
    }
    // ...y el PRIMER clic al botón de prueba (tope 5) sigue pasando.
    const test1 = await rateLimit(req('/api/notifications/test', ip), { maxRequests: 5 })
    expect(test1.limited).toBe(false)
    expect(test1.remaining).toBe(4)
  })

  test('el tope propio de cada ruta sigue aplicando', async () => {
    const ip = '10.0.0.2'
    for (let i = 0; i < 5; i++) {
      const r = await rateLimit(req('/api/notifications/test', ip), { maxRequests: 5 })
      expect(r.limited).toBe(false)
    }
    const sixth = await rateLimit(req('/api/notifications/test', ip), { maxRequests: 5 })
    expect(sixth.limited).toBe(true)
  })

  test('IPs distintas no comparten contador', async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimit(req('/api/notifications/test', '10.0.0.3'), { maxRequests: 5 })
    }
    const other = await rateLimit(req('/api/notifications/test', '10.0.0.4'), { maxRequests: 5 })
    expect(other.limited).toBe(false)
  })

  test('una URL ilegible cae al scope global en vez de reventar la ruta', async () => {
    const broken = { url: 'nota-url', headers: { get: () => '10.0.0.5' } }
    const r = await rateLimit(broken, { maxRequests: 5 })
    expect(r.limited).toBe(false)
  })
})
