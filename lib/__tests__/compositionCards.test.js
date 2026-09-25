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
