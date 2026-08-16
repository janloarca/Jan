import fs from 'fs'
import path from 'path'
import {
  RING_R, RING_C, RING_CX, RING_CY, RING_VIEWBOX,
  SWEEP_FRACTION, sweepDash, progressDashOffset,
} from '@/lib/brandRing'

// FASE JD. La geometría del anillo de marca, que hasta ahora vivía COPIADA en
// ChispudoRefreshButton y ChispudoLoader.

describe('geometría del anillo', () => {
  it('la circunferencia se deriva del radio, no es un número escrito aparte', () => {
    expect(RING_C).toBeCloseTo(2 * Math.PI * RING_R, 10)
  })

  it('el centro cae en el medio del viewBox de 32', () => {
    expect(RING_VIEWBOX).toBe('0 0 32 32')
    expect(RING_CX).toBe(16)
    expect(RING_CY).toBe(16)
    // El radio + el trazo tiene que caber dentro del viewBox.
    expect(RING_R).toBeLessThan(16)
  })
})

describe('sweepDash', () => {
  it('el arco es el 22% y el hueco el 78%: los dos tramos suman la vuelta entera', () => {
    expect(SWEEP_FRACTION).toBe(0.22)
    const [arc, gap] = sweepDash().split(' ').map(Number)
    expect(arc).toBeCloseTo(RING_C * 0.22, 10)
    expect(arc + gap).toBeCloseTo(RING_C, 10)
  })

  it('acepta otra fracción sin romper la suma', () => {
    const [arc, gap] = sweepDash(0.4).split(' ').map(Number)
    expect(arc).toBeCloseTo(RING_C * 0.4, 10)
    expect(arc + gap).toBeCloseTo(RING_C, 10)
  })
})

describe('progressDashOffset', () => {
  it('0% deja el anillo vacío y 100% lo deja lleno', () => {
    expect(progressDashOffset(0)).toBeCloseTo(RING_C, 10)
    expect(progressDashOffset(100)).toBeCloseTo(0, 10)
  })

  it('el piso mantiene visible la primera etapa en vez de dibujar un anillo vacío', () => {
    // Sin piso, 0% no dibuja nada; con piso, dibuja ese mínimo.
    expect(progressDashOffset(0, 0.08)).toBeCloseTo(RING_C * 0.92, 10)
    // Y un porcentaje real por encima del piso manda sobre el piso.
    expect(progressDashOffset(50, 0.08)).toBeCloseTo(RING_C * 0.5, 10)
  })

  it('null o undefined se tratan como 0, no como NaN', () => {
    expect(progressDashOffset(null)).toBeCloseTo(RING_C, 10)
    expect(progressDashOffset(undefined)).toBeCloseTo(RING_C, 10)
  })
})

// El punto de extraer el módulo es que no vuelvan a existir copias. Un
// refactor que "des-comparta" la geometría pasaría todos los tests de arriba
// sin problema, así que este es el que de verdad protege la decisión.
describe('nadie vuelve a definir la geometría por su cuenta', () => {
  const RING_DRAWERS = [
    'components/ui/ChispudoRefreshButton.jsx',
    'components/ui/ChispudoLoader.jsx',
    'components/ui/BusyLabel.jsx',
  ]

  RING_DRAWERS.forEach((rel) => {
    it(`${rel} importa de lib/brandRing en vez de redefinir R/C`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
      expect(src).toMatch(/from '@\/lib\/brandRing'/)
      // Las formas exactas que estaban duplicadas antes.
      expect(src).not.toMatch(/const R = 13\.5/)
      expect(src).not.toMatch(/2 \* Math\.PI \* R/)
      expect(src).not.toMatch(/C \* 0\.22/)
    })
  })

  it('el barrido se define UNA vez, en globals.css, y ningún componente lo repite', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css.match(/@keyframes chispuSweep\b/g)).toHaveLength(1)
    RING_DRAWERS.forEach((rel) => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
      expect(src).not.toMatch(/@keyframes chispu\w*Sweep/)
    })
  })
})
