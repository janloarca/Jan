/**
 * @jest-environment node
 */
// Guardián contra el crash que el usuario reportó desde su iPhone (28 ago
// 2026): "null is not an object (evaluating 'eh.id')" en /spreadsheet, cada vez
// que editaba o agregaba.
//
// El mecanismo, reproducido con el hook real en
// hooks/__tests__/modalExitNullDeref.test.js:
//
//   const [editShown] = useModalExit(editItem)   // editShown RETIENE el valor
//   {editShown && <M key={editItem.id} .../>}    // ⛔ editItem ya es null acá
//
// useModalExit existe justamente para mantener el modal montado mientras corre
// su animación de salida (FASE JI), así que en el render del cierre el guard
// sigue ABIERTO y el estado crudo ya es null. Un cuerpo que lee el estado crudo
// hace `null.id` en ESE render: crash garantizado en cada cierre, no
// intermitente.
//
// FASE JI2 ya había escrito la regla para el wizard anidado ("dentro del guard
// el wizard lee `connectShown` y no el estado crudo, porque durante la salida
// ese estado ya es null y el componente se quedaría sin su broker a mitad de la
// animación") y NUNCA se aplicó a los demás sitios: quedaron cuatro, incluidos
// los dos modales que más se usan (editar una cuenta en el tablero y en la
// Hoja). Ni el build ni jest pueden verlo: es JSX perfectamente válido.
//
// La regla: dentro del guard de un modal con salida animada se lee el VALOR
// RETENIDO, jamás el estado crudo que lo alimenta.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const SCAN_DIRS = ['app', 'components', 'hooks']
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public', '__tests__'])

function sourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      sourceFiles(full, out)
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// El nombre crudo del que cuelga un guard: `shownName` → `rawName`, leído de
// `const [shownName, closingName] = useModalExit(rawName)`.
function retainedPairs(ast) {
  const pairs = new Map()
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init
      if (!init || init.type !== 'CallExpression') return
      const callee = init.callee
      if (!(callee && callee.type === 'Identifier' && callee.name === 'useModalExit')) return
      const arg = init.arguments[0]
      if (!arg || arg.type !== 'Identifier') return
      const id = p.node.id
      if (id.type !== 'ArrayPattern') return
      const shown = id.elements[0]
      if (!shown || shown.type !== 'Identifier') return
      pairs.set(shown.name, arg.name)
    },
  })
  return pairs
}

// ¿Este test de guard depende de `shownName`? Cubre las dos formas que el repo
// usa: `{shown && ...}` y `{shown === 'x' && ...}`.
function guardShownName(node, pairs) {
  let found = null
  const walk = (n) => {
    if (!n || typeof n !== 'object' || found) return
    if (n.type === 'Identifier' && pairs.has(n.name)) { found = n.name; return }
    if (n.type === 'LogicalExpression') { walk(n.left); walk(n.right); return }
    if (n.type === 'BinaryExpression') { walk(n.left); walk(n.right); return }
    if (n.type === 'UnaryExpression') { walk(n.argument) }
  }
  walk(node)
  return found
}

function rawReadsInGuards(file) {
  const code = fs.readFileSync(file, 'utf8')
  if (!code.includes('useModalExit')) return []
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread', 'dynamicImport'],
    errorRecovery: true,
  })
  const pairs = retainedPairs(ast)
  if (pairs.size === 0) return []

  const hits = []
  traverse(ast, {
    LogicalExpression(p) {
      if (p.node.operator !== '&&') return
      const shownName = guardShownName(p.node.left, pairs)
      if (!shownName) return
      const rawName = pairs.get(shownName)
      // El cuerpo del guard: todo lo que se renderiza cuando está abierto.
      p.get('right').traverse({
        Identifier(ip) {
          if (ip.node.name !== rawName) return
          // Solo referencias de LECTURA del binding: una propiedad
          // (`obj.rawName`) o una llave de objeto no son la variable.
          if (!ip.isReferencedIdentifier()) return
          const parent = ip.parent
          if (parent.type === 'MemberExpression' && parent.property === ip.node && !parent.computed) return
          if (parent.type === 'ObjectProperty' && parent.key === ip.node && !parent.computed) return
          hits.push({ file: path.relative(ROOT, file), line: ip.node.loc?.start.line, shownName, rawName })
        },
      })
    },
  })
  return hits
}

describe('un modal con salida animada nunca lee el estado CRUDO dentro de su guard', () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))

  it('el barrido de verdad encuentra guards que juzgar (si no, pasaría vacío)', () => {
    const withHook = files.filter((f) => fs.readFileSync(f, 'utf8').includes('useModalExit('))
    expect(withHook.length).toBeGreaterThanOrEqual(4)
  })

  it('ningún guard lee el estado crudo', () => {
    const hits = files.flatMap(rawReadsInGuards)
    const msg = hits
      .map((h) => `${h.file}:${h.line} — dentro de {${h.shownName} && ...} se lee "${h.rawName}", que es null durante la salida. Usa "${h.shownName}".`)
      .join('\n')
    expect(msg).toBe('')
  })
})
