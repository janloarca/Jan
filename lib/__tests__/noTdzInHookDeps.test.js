/**
 * @jest-environment node
 */
// Guardián contra la trampa que ya tumbó el dashboard DOS veces.
//
// Un array de dependencias de useCallback/useMemo/useEffect se evalúa en CADA
// render, o sea de forma SÍNCRONA en el punto donde está escrito. Si nombra un
// binding declarado con `const`/`let` MÁS ABAJO en el mismo componente, ese
// binding todavía está en su temporal dead zone y el acceso lanza
// ReferenceError: "Cannot access 'X' before initialization". No es un valor
// undefined silencioso: es un crash que tumba el árbol entero antes de pintar
// nada, y en producción el nombre viene minificado ("Cannot access 'nL'..."),
// así que el mensaje no dice cuál era la variable.
//
//   FASE HC:  handleRefresh          → deps [refetchBenchmark]  (declarado abajo)
//   FASE IA:  handleIBKRPillClick    → deps [showToast]         (declarado abajo)
//
// Ninguna de las dos la atrapó `npm run build` ni `npx jest`: es JavaScript
// perfectamente VÁLIDO, solo que roto en tiempo de ejecución. Y este repo no
// tiene ESLint, así que `react-hooks/exhaustive-deps` (que además empujaría a
// AGREGAR justo la dependencia que rompe) nunca corrió.
//
// Este test parsea cada archivo y falla si una deps array nombra un binding
// declarado después. `var` y las declaraciones de función se izan, así que no
// cuentan; solo `const`, `let` y `class` tienen TDZ.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public'])
const HOOKS = new Set(['useCallback', 'useMemo', 'useEffect', 'useLayoutEffect', 'useImperativeHandle'])
const TDZ_KINDS = new Set(['const', 'let'])

function sourceFiles(dir, out = []) {
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

function tdzInDepsIn(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
  })
  const found = []
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee
      const name = callee.type === 'Identifier' ? callee.name
        : (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') ? callee.property.name
        : null
      if (!name || !HOOKS.has(name)) return
      const deps = p.node.arguments[p.node.arguments.length - 1]
      if (!deps || deps.type !== 'ArrayExpression') return

      for (const el of deps.elements) {
        if (!el || el.type !== 'Identifier') continue
        const binding = p.scope.getBinding(el.name)
        if (!binding) continue
        // Solo const/let/class tienen TDZ. var y function se izan.
        const kind = binding.kind
        const isClass = binding.path.isClassDeclaration && binding.path.isClassDeclaration()
        if (!TDZ_KINDS.has(kind) && !isClass) continue
        // Un binding de módulo (import, o const a nivel de archivo antes del
        // componente) también se declara antes por posición, así que la
        // comparación de posición cubre los dos casos sin distinguirlos.
        const declStart = binding.path.node.start
        if (declStart == null || el.start == null) continue
        if (declStart > el.start) {
          found.push(
            `${path.relative(ROOT, file)}:${el.loc?.start.line} — ${name} deps nombran "${el.name}", `
            + `declarado con ${kind} en la línea ${binding.path.node.loc?.start.line} (después): ReferenceError de TDZ en cada render`
          )
        }
      }
    },
  })
  return found
}

describe('sin TDZ en arrays de dependencias de hooks', () => {
  test('ninguna deps array nombra un binding declarado más abajo', () => {
    const problems = []
    for (const file of sourceFiles(ROOT)) problems.push(...tdzInDepsIn(file))
    expect(problems).toEqual([])
  })

  test('el checker atrapa la forma exacta de FASE HC y FASE IA', () => {
    // Fixture con la forma real: el callback se declara ANTES del valor que
    // nombra en sus dependencias. Si un refactor futuro debilita el walk de
    // arriba, esto falla acá en vez de pasar en silencio.
    const tmp = path.join(require('os').tmpdir(), `tdz-fixture-${process.pid}.js`)
    fs.writeFileSync(tmp, `
      function Componente() {
        const alPresionar = useCallback(() => { avisar('hola') }, [avisar])
        const avisar = useCallback((m) => console.log(m), [])
        return { alPresionar, avisar }
      }
    `)
    try {
      const found = tdzInDepsIn(tmp)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('"avisar"')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  test('un binding declarado ANTES no se reporta', () => {
    // El caso sano, que es la enorme mayoría: no puede dar falso positivo o el
    // guardián sería inservible.
    const tmp = path.join(require('os').tmpdir(), `tdz-ok-${process.pid}.js`)
    fs.writeFileSync(tmp, `
      function Componente() {
        const avisar = useCallback((m) => console.log(m), [])
        const alPresionar = useCallback(() => { avisar('hola') }, [avisar])
        return { alPresionar, avisar }
      }
    `)
    try {
      expect(tdzInDepsIn(tmp)).toEqual([])
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
