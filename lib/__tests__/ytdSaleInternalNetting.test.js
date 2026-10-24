/** @jest-environment node */
// Guardian de FUENTE: una venta que deja el efectivo en otra cuenta propia
// (_destinationItemId) tiene que netearse como movimiento interno en el
// reparto del YTD por cuenta. Sin la rama SELL, la cuenta que recibe leia el
// efectivo como ganancia (BTC vendido, +$390 en Banrural).
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '../../hooks/useDashboardData.js'), 'utf8')

describe('YTD por cuenta: la venta con destino es movimiento interno', () => {
  it('tiene una rama SELL que mapea origen y destino a cuentas', () => {
    const i = src.indexOf("type === 'SELL'")
    expect(i).toBeGreaterThan(-1)
    const block = src.slice(i, i + 900)
    expect(block).toMatch(/fromKey = tx\._linkedItemId/)
    expect(block).toMatch(/toKey = tx\._destinationItemId/)
  })
})
