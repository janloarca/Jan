/**
 * FASE ME6: guardianes de FUENTE de las dos convenciones de modal.
 *
 * (1) Esc-cierra vive en UN solo lugar (hooks/useEscClose.js, con pila para
 *     que un modal anidado no cierre también a su padre). Antes el mismo
 *     useEffect estaba copiado verbatim en 18 archivos y once modales reales
 *     no lo tenían: dos copias de la misma regla es cómo una se queda atrás,
 *     y acá además cada copia nueva REINTRODUCE el bug del doble cierre
 *     (un listener de window propio no sabe de la pila).
 *
 * (2) El telón de un modal es la clase .modal-backdrop (globals.css), que
 *     además trae la variante de tema claro que NINGUNA copia inline recibía:
 *     26 overlays re-implementaban el mismo rgba(0,0,0,0.3)+blur a mano y en
 *     tema claro se quedaban con el telón de oscuro.
 *
 * Leen los ARCHIVOS, no una copia de las cadenas: con una lista propia se
 * podría cambiar el código y seguir en verde.
 */
const fs = require('fs')
const path = require('path')

const ROOTS = ['components', 'app']

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      walk(p, out)
    } else if (e.name.endsWith('.jsx')) {
      out.push(p)
    }
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)))

describe('convenciones de modal (FASE ME6)', () => {
  test('ningún componente re-implementa el listener de Esc a nivel de window', () => {
    // La firma de la copia: un handler propio de Escape registrado en
    // window/document. Un onKeyDown de ELEMENTO (input que cancela su edición)
    // no matchea y sigue permitido.
    const offenders = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      const hasHandler = /const \w+ = \(e\) => \{ if \(e\.key === 'Escape'\)/.test(src)
      const hasWindowListener = /(window|document)\.addEventListener\('keydown'/.test(src)
      if (hasHandler && hasWindowListener) offenders.push(path.relative(process.cwd(), f))
    }
    expect(offenders).toEqual([])
  })

  test('ningún overlay re-implementa el telón inline (rgba 0.3 + glass-blur)', () => {
    const offenders = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      if (src.includes("background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)'")) {
        offenders.push(path.relative(process.cwd(), f))
      }
    }
    expect(offenders).toEqual([])
  })

  test('la clase .modal-backdrop existe y conserva su variante de tema claro', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/\.modal-backdrop \{/)
    expect(css).toMatch(/\[data-theme="light"\] \.modal-backdrop \{/)
  })
})
