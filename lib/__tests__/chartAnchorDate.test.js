import fs from 'fs'
import path from 'path'

// FASE LV2: guardián de FUENTE (el componente no se monta sin el tablero).
// ALL no puede arrancar después del ancla del año, y el punto de arranque de
// YTD lleva la fecha del snapshot-ancla.
const src = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8')

describe('fecha única del ancla del año en la gráfica', () => {
  it('el agrupado semanal de ALL fija el primer punto y el ancla del año', () => {
    expect(src).toMatch(/const pinned = new Set\(\[pts\[0\]\.ts\]\)/)
    expect(src).toMatch(/pinned\.has\(p\.ts\) \? `pin-\$\{p\.ts\}`/)
  })
  it('el punto sintético de YTD usa la fecha del snapshot-ancla', () => {
    expect(src).toMatch(/anchorTs >= yearStart && anchorTs <= pts\[0\]\.ts \? anchorTs : yearStart/)
  })
})
