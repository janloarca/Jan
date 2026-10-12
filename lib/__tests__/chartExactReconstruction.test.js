/**
 * FASE JD2: la gráfica decide si su reconstrucción es EXACTA (línea sólida) con
 * la misma regla que el servidor: !isMarketPriced. Una regex sobre `type` dibujaba
 * punteada la serie de una acción privada, que no cotiza.
 */
import fs from 'fs'
import path from 'path'
import { isMarketPriced } from '../../components/dashboard/utils'

const src = fs.readFileSync(
  path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('reconstructionIsExact', () => {
  test('usa isMarketPriced y no una regex sobre type', () => {
    const m = src.match(/const reconstructionIsExact = useMemo\(\(\) => \{([\s\S]*?)\}, \[scopedItems\]\)/)
    expect(m).not.toBeNull()
    expect(m[1]).toMatch(/isMarketPriced\(it\)/)
    expect(m[1]).not.toMatch(/stock\|crypto/i)
  })

  test('una acción privada es estática; una pública no', () => {
    expect(isMarketPriced({ type: 'Stock', subtype: 'private_common', symbol: 'ACME-INC' })).toBe(false)
    expect(isMarketPriced({ type: 'Stock', symbol: 'AAPL' })).toBe(true)
  })
})
