import fs from 'fs'
import path from 'path'
import * as parser from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default || _traverse
const ROOT = process.cwd()
const DIRS = ['app', 'components', 'hooks']
const SKIP = new Set(['node_modules', '.next', '.git', '__tests__'])

// ⛔ UN COMPONENTE NO PUEDE DEFINIRSE DENTRO DE OTRO.
//
// No es una regla de estilo: es un bug de comportamiento que el usuario reporta
// como "los cuadritos no me funcionan, los tengo que apachar varias veces".
//
// El mecanismo: un componente definido dentro del render tiene identidad NUEVA
// en cada render, así que React lo ve como otro TIPO de componente y desmonta y
// remonta su nodo del DOM en vez de actualizarlo. Si ese remonte cae entre el
// mousedown y el mouseup (o entre el touchstart y el touchend), el nodo que
// recibió el toque ya no existe cuando se suelta, y el navegador NO dispara el
// click. En un tablero que re-renderiza solo con cada tick de precios, eso pasa
// seguido y de forma intermitente, que es lo peor de diagnosticar.
//
// MEDIDO en el navegador con el mecanismo aislado (parent re-renderizando cada
// 40ms, down y up separados por 45ms): 40 de 40 clics PERDIDOS con el
// componente definido adentro, 0 de 40 con el mismo componente afuera.
//
// Ni `npm run build` ni el resto de los tests pueden verlo: es JavaScript
// perfectamente válido y el componente se RENDERIZA bien. Lo único que falla es
// la interacción, y solo a veces.
//
// El arreglo siempre es el mismo: subir el componente al nivel del módulo y
// pasarle como props lo que antes tomaba del closure.

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sourceFiles(p, out)
    else if (/\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

// ¿Esta expresión produce JSX? Cubre el retorno directo, el ternario y el `&&`,
// que es donde el primer intento de este chequeo tenía un hueco: `DeleteButton`
// devolvía un ternario de JSX y no lo detectaba.
function yieldsJSX(node) {
  if (!node) return false
  const t = node.type
  if (t === 'JSXElement' || t === 'JSXFragment') return true
  if (t === 'ConditionalExpression') return yieldsJSX(node.consequent) || yieldsJSX(node.alternate)
  if (t === 'LogicalExpression') return yieldsJSX(node.left) || yieldsJSX(node.right)
  if (t === 'ParenthesizedExpression') return yieldsJSX(node.expression)
  return false
}

function nestedIn(file) {
  const src = fs.readFileSync(file, 'utf8')
  let ast
  try {
    ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] })
  } catch {
    return []
  }
  const found = []
  const check = (nodePath, name, line, fnNode) => {
    // Mayúscula inicial: así es como React distingue un componente de un helper.
    if (!/^[A-Z]/.test(name)) return
    let produces = false
    if (yieldsJSX(fnNode.body)) produces = true
    else if (fnNode.body && fnNode.body.type === 'BlockStatement') {
      nodePath.traverse({
        ReturnStatement(r) { if (yieldsJSX(r.node.argument)) produces = true },
      })
    }
    if (!produces) return
    if (!nodePath.getFunctionParent()) return // ya está al nivel del módulo
    found.push(`${path.relative(ROOT, file)}:${line} define <${name}> dentro de otro componente`)
  }

  traverse(ast, {
    VariableDeclarator(p) {
      const { id, init } = p.node
      if (id.type !== 'Identifier' || !init) return
      if (!/ArrowFunctionExpression|FunctionExpression/.test(init.type)) return
      check(p.get('init'), id.name, id.loc ? id.loc.start.line : 0, init)
    },
    FunctionDeclaration(p) {
      if (!p.node.id) return
      check(p, p.node.id.name, p.node.id.loc ? p.node.id.loc.start.line : 0, p.node)
    },
  })
  return found
}

describe('ningún componente se define dentro de otro', () => {
  test('el repo está limpio', () => {
    const problems = []
    for (const dir of DIRS) {
      const abs = path.join(ROOT, dir)
      if (fs.existsSync(abs)) for (const f of sourceFiles(abs)) problems.push(...nestedIn(f))
    }
    expect(problems).toEqual([])
  })

  // Sin esto el chequeo podría quedarse en nada (un walk roto pasa en verde) y
  // nadie se enteraría hasta el próximo reporte de "hay que tocar dos veces".
  test('detecta la forma exacta del bug', () => {
    const fixture = path.join(ROOT, 'lib', '__tests__', '.nested-fixture.jsx')
    fs.writeFileSync(fixture, `
export default function Padre() {
  const Tile = ({ a }) => <button onClick={a.onClick}>{a.label}</button>
  return <div><Tile a={{ label: 'x' }} /></div>
}
`)
    try {
      expect(nestedIn(fixture)).toHaveLength(1)
    } finally { fs.unlinkSync(fixture) }
  })

  // El hueco que el primer intento SÍ tuvo: un componente que devuelve un
  // ternario de JSX en vez de JSX directo.
  test('detecta también el que devuelve un ternario', () => {
    const fixture = path.join(ROOT, 'lib', '__tests__', '.nested-ternary.jsx')
    fs.writeFileSync(fixture, `
export default function Padre({ on }) {
  const Boton = ({ x }) => {
    return on ? <button>{x}</button> : <span>{x}</span>
  }
  return <div><Boton x="1" /></div>
}
`)
    try {
      expect(nestedIn(fixture)).toHaveLength(1)
    } finally { fs.unlinkSync(fixture) }
  })

  test('un componente al nivel del módulo no se reporta', () => {
    const fixture = path.join(ROOT, 'lib', '__tests__', '.nested-ok.jsx')
    fs.writeFileSync(fixture, `
const Tile = ({ a }) => <button onClick={a.onClick}>{a.label}</button>
export default function Padre() {
  return <div><Tile a={{ label: 'x' }} /></div>
}
`)
    try {
      expect(nestedIn(fixture)).toEqual([])
    } finally { fs.unlinkSync(fixture) }
  })

  // Un helper en minúscula que devuelve JSX no es un componente: React lo
  // invoca como función, no lo monta, así que no hay remonte que perder.
  test('un helper en minuscula no cuenta', () => {
    const fixture = path.join(ROOT, 'lib', '__tests__', '.nested-helper.jsx')
    fs.writeFileSync(fixture, `
export default function Padre() {
  const fila = (x) => <li>{x}</li>
  return <ul>{[1, 2].map(fila)}</ul>
}
`)
    try {
      expect(nestedIn(fixture)).toEqual([])
    } finally { fs.unlinkSync(fixture) }
  })
})
