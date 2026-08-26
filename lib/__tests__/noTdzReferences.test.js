/**
 * @jest-environment node
 */
// Guardián contra la trampa que ya tumbó pantallas TRES veces.
//
// `const`, `let` y `class` tienen temporal dead zone: leerlos ANTES de su
// declaración lanza ReferenceError ("Cannot access 'X' before initialization"),
// no un undefined silencioso. Es un crash que tumba el árbol entero antes de
// pintar nada, y en producción el nombre viene minificado ("Cannot access
// 'nL'...", "Cannot access 'ej'..."), así que el mensaje ni siquiera dice cuál
// era la variable.
//
//   FASE HC:  handleRefresh          → deps [refetchBenchmark]      (declarado abajo)
//   FASE IA:  handleIBKRPillClick    → deps [showToast]             (declarado abajo)
//   FASE IK:  useModalExit(showAddModal) en /spreadsheet            (declarado abajo)
//
// Las dos primeras eran arrays de dependencias, y el guardián anterior
// (noTdzInHookDeps) solo miraba ahí. La tercera fue una LLAMADA normal durante
// el render, así que pasó por debajo y dejó /spreadsheet caída para todos los
// usuarios. La regla que cubre a las tres es más general y no más frágil:
//
//   Una referencia es un crash garantizado si se evalúa de forma SÍNCRONA en
//   el mismo punto del programa donde está escrita, y su binding se declara
//   más abajo.
//
// "De forma síncrona" = no está dentro de una función anidada. Un callback
// (`useCallback(() => avisar(), [])`, un onClick, el cuerpo de un useEffect)
// se ejecuta DESPUÉS, cuando el binding ya existe, así que nombrar ahí algo
// declarado más abajo es correcto y cotidiano: no se reporta. Un array de
// dependencias, un argumento de llamada o el inicializador de otro const sí
// corren en el acto.
//
// Ninguna de las tres la atrapó `npm run build` ni `npx jest`: es JavaScript
// perfectamente VÁLIDO, solo roto en tiempo de ejecución. Y este repo no tiene
// ESLint, así que `no-use-before-define` nunca corrió.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public'])
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

function tdzReferencesIn(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
  })
  const found = []
  const seen = new Set()
  traverse(ast, {
    ReferencedIdentifier(p) {
      const binding = p.scope.getBinding(p.node.name)
      if (!binding) return

      // Solo const/let/class tienen TDZ. `var` y las declaraciones de función
      // se izan, así que usarlas antes es feo pero no revienta.
      const isClass = binding.path.isClassDeclaration && binding.path.isClassDeclaration()
      if (!TDZ_KINDS.has(binding.kind) && !isClass) return

      const declStart = binding.path.node.start
      if (declStart == null || p.node.start == null) return
      if (declStart <= p.node.start) return // declarado antes: sano

      // ¿La referencia corre YA, o queda diferida dentro de una función?
      // Si la función que la contiene no es la misma que contiene a la
      // declaración, entonces está anidada: se ejecuta después y es correcta.
      if (p.getFunctionParent() !== binding.path.getFunctionParent()) return

      // Su propio inicializador (`const a = a`) no aporta nada nuevo.
      if (p.findParent(parent => parent.node === binding.path.node)) return

      const key = `${p.node.name}:${p.node.start}`
      if (seen.has(key)) return
      seen.add(key)

      found.push(
        `${path.relative(ROOT, file)}:${p.node.loc?.start.line} — se lee "${p.node.name}", `
        + `declarado con ${isClass ? 'class' : binding.kind} en la línea ${binding.path.node.loc?.start.line} (después): `
        + 'ReferenceError de TDZ al ejecutarse'
      )
    },
  })
  return found
}

function withFixture(code, fn) {
  const tmp = path.join(require('os').tmpdir(), `tdz-${process.pid}-${Math.random().toString(36).slice(2)}.js`)
  fs.writeFileSync(tmp, code)
  try { return fn(tmp) } finally { fs.unlinkSync(tmp) }
}

describe('sin lecturas en temporal dead zone', () => {
  test('ningún archivo lee un binding declarado más abajo', () => {
    const problems = []
    for (const file of sourceFiles(ROOT)) problems.push(...tdzReferencesIn(file))
    expect(problems).toEqual([])
  })

  test('atrapa la forma de FASE IK: una llamada del render lee estado de más abajo', () => {
    // La que dejó /spreadsheet caída. El guardián viejo (solo deps arrays) no
    // la veía.
    withFixture(`
      function Pagina() {
        const [abrirShown] = useModalExit(showAdd)
        const [showAdd, setShowAdd] = useState(false)
        return { abrirShown, setShowAdd }
      }
    `, (tmp) => {
      const found = tdzReferencesIn(tmp)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('"showAdd"')
    })
  })

  test('atrapa la forma de FASE HC y FASE IA: deps que nombran algo de más abajo', () => {
    withFixture(`
      function Componente() {
        const alPresionar = useCallback(() => { avisar('hola') }, [avisar])
        const avisar = useCallback((m) => console.log(m), [])
        return { alPresionar, avisar }
      }
    `, (tmp) => {
      const found = tdzReferencesIn(tmp)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('"avisar"')
    })
  })

  test('un callback que nombra algo de más abajo NO se reporta', () => {
    // El caso sano y cotidiano: el cuerpo del callback corre después, cuando el
    // binding ya existe. Si esto diera falso positivo el guardián sería
    // inservible y alguien lo borraría.
    withFixture(`
      function Componente() {
        const alPresionar = useCallback(() => { avisar('hola') }, [])
        const avisar = (m) => console.log(m)
        useEffect(() => { avisar('hey') }, [])
        return { alPresionar }
      }
    `, (tmp) => {
      expect(tdzReferencesIn(tmp)).toEqual([])
    })
  })

  test('un binding declarado ANTES no se reporta', () => {
    withFixture(`
      function Componente() {
        const [showAdd, setShowAdd] = useState(false)
        const [abrirShown] = useModalExit(showAdd)
        return { abrirShown, setShowAdd }
      }
    `, (tmp) => {
      expect(tdzReferencesIn(tmp)).toEqual([])
    })
  })

  test('var y function se izan: no se reportan', () => {
    withFixture(`
      function Componente() {
        const a = ayudar()
        function ayudar() { return 1 }
        var b = 2
        return a + b
      }
    `, (tmp) => {
      expect(tdzReferencesIn(tmp)).toEqual([])
    })
  })
})
