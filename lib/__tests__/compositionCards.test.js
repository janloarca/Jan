/**
 * Rediseño, sección 2. Guardián de FUENTE: Asignación de Activos y Análisis
 * comparten UN alto fijo (desde lg) y el mismo segundo nivel de chips, y
 * ninguna de las siete formas de agrupar desapareció al esconderse detrás de
 * "Más".
 */
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')
const alloc = read('components/dashboard/AssetAllocation.jsx')
const analysis = read('components/dashboard/AnalysisTabs.jsx')
const css = read('app/globals.css')

describe('cards de composición', () => {
  it('las dos usan la MISMA variable de alto', () => {
    expect(css).toMatch(/--composition-card-h:\s*\d+px/)
    expect(alloc).toMatch(/lg:h-\[var\(--composition-card-h\)\]/)
    expect(analysis).toMatch(/lg:h-\[var\(--composition-card-h\)\]/)
  })

  it('el cuerpo desplaza dentro del alto fijo en vez de estirar la card', () => {
    expect(alloc).toMatch(/flex-1 min-h-0 lg:overflow-y-auto/)
    expect(analysis).toMatch(/flex-1 min-h-0 lg:overflow-y-auto/)
  })

  it('Asignación: tres vistas a la vista y las otras cuatro detrás de "Más"', () => {
    for (const k of ['type', 'institution', 'sector', 'returnType', 'geography', 'currency', 'maturity']) {
      expect(alloc).toContain(`key: '${k}'`)
    }
    expect(alloc).toMatch(/<SubTabs/)
    expect(analysis).toMatch(/<SubTabs/)
  })

  it('el conteo de posiciones va en todas las vistas, no solo en Institución', () => {
    expect(alloc).not.toMatch(/view === 'institution' && \(\s*<span className="text-xs[^"]*"[^>]*>\s*\{seg\.count\}/)
    expect(alloc).toMatch(/\{seg\.count\} \{t\('pos\.', 'pos\.'\)\}/)
  })
})

// Rediseño, sección 3 (FASE PC). Las acciones pasan a una fila a lo ancho, y
// TODAS siguen a la vista: el usuario eligió explícitamente no esconderlas
// detrás de un menú "Más acciones" (Vender, Transferir e Importar ya
// estuvieron escondidas antes y un usuario no encontraba cómo vender).
describe('sección 3: fila de acciones', () => {
  const page = read('app/dashboard/page.jsx')
  const actions = read('components/dashboard/QuickActionsCard.jsx')

  it('las acciones van DESPUÉS de las dos cards de composición y de Invertido', () => {
    const an = page.indexOf('<CardBoundary id="AN-00"')
    const inv = page.indexOf('<CardBoundary id="INV-01"')
    const act = page.indexOf('<CardBoundary id="ACT-01"')
    expect(an).toBeGreaterThan(-1)
    expect(inv).toBeGreaterThan(an)
    expect(act).toBeGreaterThan(inv)
  })

  it('ninguna acción se esconde detrás de un menú', () => {
    for (const k of ['cashflow', 'add', 'sell', 'transfer', 'import', 'sync', 'review', 'alerts']) {
      expect(actions).toContain(`key: '${k}'`)
    }
    // Sin comentarios: el propio comentario del componente nombra el menú que
    // NO existe, y un guardián que lee prosa pasaría o fallaría por la razón
    // equivocada.
    const code = actions.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/Más acciones|More actions/)
  })

  it('el tablero y la card de tipo de cambio usan la MISMA regla para mostrarse', () => {
    expect(page).toMatch(/showsRateTable\(portfolioItems\)/)
    expect(read('components/dashboard/ExchangeRatesCard.jsx')).toMatch(/showsRateTable\(items\)/)
  })
})

// Rediseño, sección 4 (FASE PD). En una columna las acciones van justo debajo
// del patrimonio (al fondo quedaban a ~2,600px de scroll); desde lg vuelven a
// la fila de abajo. Es UN solo elemento montado dos veces, y el tour tiene que
// aterrizar en la copia que se ve.
describe('sección 4: móvil', () => {
  const page = read('app/dashboard/page.jsx')
  const tour = read('components/dashboard/OnboardingTour.jsx')

  it('la copia de teléfono va después del patrimonio y antes de la gráfica', () => {
    const hero = page.indexOf('<NetWorthCard')
    const phone = page.indexOf('<CardBoundary id="ACT-01-M" className="lg:hidden">{quickActions}</CardBoundary>')
    const chart = page.indexOf('<CardBoundary id="OR-01">')
    expect(hero).toBeGreaterThan(-1)
    expect(phone).toBeGreaterThan(hero)
    expect(chart).toBeGreaterThan(phone)
  })

  it('la copia de escritorio se esconde por debajo de lg, y las dos son el MISMO elemento', () => {
    expect(page).toContain('<CardBoundary id="ACT-01" className="hidden lg:block">{quickActions}</CardBoundary>')
    // Una sola llamada a QuickActionsCard: dos copias de las props se separan.
    expect(page.match(/<QuickActionsCard\b/g)).toHaveLength(1)
  })

  it('el tour busca la copia VISIBLE del ancla, no la primera del DOM', () => {
    expect(tour).toMatch(/function findVisible\(selector\)/)
    expect(tour).toMatch(/getClientRects\(\)\.length > 0/)
    expect(tour).not.toMatch(/document\.querySelector\(currentDemo\.anchor\)/)
  })
})
