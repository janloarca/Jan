import fs from 'fs'
import path from 'path'
import * as parser from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default || _traverse
const ROOT = process.cwd()
const DIRS = ['app', 'components']
const SKIP = new Set(['node_modules', '.next', '.git', '__tests__'])

// ⛔ TODO MODAL SE MONTA DENTRO DE `<ModalMount>`.
//
// El guardián hermano (modalAnimation.test.js) verifica que cada modal PIDA la
// animación. Este verifica la otra mitad, que es la que de verdad se olvida:
// que el sitio donde se RENDERIZA lo mantenga montado mientras esa animación
// corre. Sin el envoltorio, el modal tiene la clase y aun así desaparece en el
// primer frame, o sea el defecto se ve exactamente igual que antes del arreglo.
//
// Es la misma clase de hueco que costó esta fase: FASE JE2 afirmó "una regla
// cubre a los 21" y nueve modales quedaron afuera sin que nada lo dijera. Una
// propiedad que se sostiene por disciplina y no por un test vuelve a romperse.

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sourceFiles(p, out)
    else if (/\.jsx$/.test(e.name)) out.push(p)
  }
  return out
}

// Un componente es "un modal" si su archivo dibuja un overlay de pantalla
// completa. Se deriva del código, nunca de una lista escrita a mano, que es
// justo lo que se desactualiza.
function modalComponents() {
  const names = new Set()
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const f of sourceFiles(abs)) {
      const src = fs.readFileSync(f, 'utf8')
      if (!/fixed inset-0 z-/.test(src)) continue
      const base = path.basename(f, '.jsx')
      // Solo componentes con nombre propio de archivo (los de `page.jsx` se
      // renderizan como la ruta, no como una etiqueta JSX).
      if (/^[A-Z]/.test(base)) names.add(base)
    }
  }
  return names
}

// Estos se renderizan SIEMPRE montados y gobiernan su propia visibilidad con
// una prop (`open`), así que no hay nada que mantener montado: el envoltorio no
// aportaría nada. Lista explícita para que agregar uno sea una decisión.
const ALWAYS_MOUNTED = new Set(['CommandPalette', 'MobileNav'])

// Archivos que contienen un overlay pero cuyo componente NO es un modal: el
// overlay es de algo que dibujan adentro. Sin esta lista, montar la lista de
// movimientos en una página se leería como montar un modal sin envolver.
const NOT_A_PANEL = new Set(['FinanceTransactionList', 'Header', 'PortfolioSelector', 'IncomePlanCalendar'])

// Se desvanecen solos con su propio estado `visible` y una transición de
// opacidad, así que ya sobreviven su salida sin ayuda de nadie.
const SELF_FADING = new Set(['PageTour', 'OnboardingTour'])

function unwiredSites() {
  const modals = modalComponents()
  const problems = []
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const f of sourceFiles(abs)) {
      const src = fs.readFileSync(f, 'utf8')
      let ast
      try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] }) } catch { continue }
      const self = path.basename(f, '.jsx')
      traverse(ast, {
        JSXOpeningElement(p) {
          const n = p.node.name
          if (n.type !== 'JSXIdentifier') return
          const name = n.name
          if (name === self) return
          if (!modals.has(name)) return
          if (ALWAYS_MOUNTED.has(name) || NOT_A_PANEL.has(name) || SELF_FADING.has(name)) return
          // Un modal devuelto como RAÍZ (`if (fase) return <Modal/>`) es un
          // pase de mano: quien lo monta es el llamador, y ese sitio ya está
          // envuelto. Lo que hay que exigir envuelto es el modal EMBEBIDO en un
          // árbol más grande, porque ahí el guard que lo hace aparecer y
          // desaparecer vive en este archivo.
          // Ojo: el padre de un JSXOpeningElement es su PROPIO JSXElement, así
          // que hay que arrancar la búsqueda desde ahí o todo sale "embebido".
          const el = p.parentPath
          let embedded = false
          el.findParent((a) => {
            if (a.isJSXElement() || a.isJSXFragment()) { embedded = true; return true }
            return false
          })
          if (!embedded) return
          // ¿Algún ancestro es <ModalMount>?
          let wrapped = false
          p.findParent((a) => {
            if (a.isJSXElement()) {
              const o = a.node.openingElement.name
              if (o.type === 'JSXIdentifier' && o.name === 'ModalMount') { wrapped = true; return true }
            }
            return false
          })
          if (!wrapped) {
            problems.push(`${path.relative(ROOT, f)}:${n.loc ? n.loc.start.line : 0} monta <${name}> sin ModalMount`)
          }
        },
      })
    }
  }
  return problems
}

describe('todo modal se monta dentro de ModalMount', () => {
  test('no queda ningun sitio sin cablear', () => {
    expect(unwiredSites()).toEqual([])
  })

  // Sin esto el test de arriba podria pasar por la razon equivocada: un walk
  // que dejara de reconocer modales devolveria una lista vacia y verde.
  test('el barrido de verdad reconoce los modales', () => {
    const m = modalComponents()
    expect(m.size).toBeGreaterThan(15)
    expect(m.has('TransferModal')).toBe(true)
    expect(m.has('CashFlowModal')).toBe(true)
  })

  test('las excepciones siguen correspondiendo a modales reales', () => {
    const m = modalComponents()
    for (const name of [...ALWAYS_MOUNTED, ...NOT_A_PANEL, ...SELF_FADING]) expect(m.has(name)).toBe(true)
  })
})
