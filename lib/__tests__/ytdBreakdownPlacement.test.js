/**
 * FASE OZ. Guardián de FUENTE: el desglose del YTD es una sección HERMANA de
 * las dos cards superiores del tablero (col-span-full dentro del mismo grid),
 * nunca un panel anidado en NetWorthCard. Vive en JSX que jest no puede
 * montar sin el tablero entero, así que se fija leyendo los archivos.
 */
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('desglose del YTD: colocación en el tablero', () => {
  const page = strip(read('app/dashboard/page.jsx'))
  const card = strip(read('components/dashboard/NetWorthCard.jsx'))
  const section = strip(read('components/dashboard/YtdBreakdownSection.jsx'))
  const css = read('app/globals.css')

  // Rediseño, sección 1: el patrimonio pasó a ser un hero de ancho completo y
  // la gráfica baja a su propia fila. El desglose se abre desde el CTA de la
  // card del patrimonio, así que va JUSTO debajo de ella y antes de la gráfica.
  // Lo que FASE OZ fija se conserva: es hija del grid, no de la card.
  it('la sección se monta DENTRO del grid superior, entre el hero y la gráfica', () => {
    const gridStart = page.indexOf('stagger-1 grid grid-cols-1 gap-4 sm:gap-6')
    expect(gridStart).toBeGreaterThan(0)
    const networth = page.indexOf('<NetWorthCard', gridStart)
    const chart = page.indexOf('<PortfolioGrowthChart', gridStart)
    const ytd = page.indexOf('<YtdBreakdownSection', gridStart)
    const gridEnd = page.indexOf('</ErrorBoundary>', gridStart)
    expect(networth).toBeGreaterThan(gridStart)
    expect(ytd).toBeGreaterThan(networth)
    expect(chart).toBeGreaterThan(ytd)
    expect(chart).toBeLessThan(gridEnd)
  })

  it('la sección ocupa la fila entera (grid-column: 1 / -1) y no usa position absolute', () => {
    expect(section).toMatch(/className="col-span-full ytd-disclosure"/)
    expect(section).not.toMatch(/\babsolute\b/)
    expect(css).toMatch(/\.ytd-disclosure\s*\{[^}]*grid-template-rows:\s*0fr/)
    expect(css).toMatch(/transition:\s*grid-template-rows var\(--dur-base\)/)
  })

  it('NetWorthCard ya no trae el panel anidado: solo el CTA con sus atributos ARIA', () => {
    expect(card).toMatch(/<YtdBreakdownToggle/)
    expect(card).not.toMatch(/AccountTermsTable/)
    expect(card).not.toMatch(/showYTDDetail/)
    expect(card).not.toMatch(/De dónde viene tu YTD/)
    expect(section).toMatch(/aria-expanded=\{!!open\}/)
    expect(section).toMatch(/aria-controls=\{YTD_BREAKDOWN_ID\}/)
    expect(section).toMatch(/role="region"/)
  })

  it('el CTA dice lo pedido en los dos estados y el tooltip del YTD es solo ayuda', () => {
    expect(section).toMatch(/Ocultar desglose/)
    expect(section).toMatch(/Ver desglose del YTD/)
    expect(card).toMatch(/El rendimiento YTD compara el patrimonio actual con el valor al inicio del año\. Las transferencias entre cuentas propias no se consideran rendimiento\./)
  })
})
