/**
 * @jest-environment node
 */
// ⛔ NINGÚN `type="number"` para algo con decimales.
//
// El bug, reportado por el usuario: con teclado en español el separador decimal
// es COMA, y un `<input type="number">` devuelve `''` ante lo que no puede
// parsear, así que el campo SE BORRA TECLA POR TECLA ("BTC no me dejaba poner
// 0.0001"). La salida es `type="text" inputMode="decimal"`, que conserva el
// teclado numérico del teléfono, más un lector que entienda las dos
// convenciones (`parseAmount` / `parseQuantity` / `parseRate`).
//
// POR QUÉ ESTE GUARDIÁN EXISTE: la corrección se hizo a mano en SEIS archivos,
// en tres pasadas distintas, y cada vez quedaron campos atrás. No es descuido de
// nadie: son ~28 sitios en 20 archivos y no hay forma de verlos todos leyendo.
// Ni el build ni los tests pueden atraparlo, porque un input numérico es HTML
// perfectamente válido: el defecto solo aparece con un teclado en español,
// tecleando.
//
// CÓMO DECIDE, y por qué no es una lista de archivos: un campo que de verdad es
// un ENTERO ACOTADO (el día del mes, cuántos meses, un año) nunca lleva
// separador, así que el bug no lo alcanza y `type="number"` ahí está bien. En
// vez de mantener una lista externa que se desactualiza en cuanto alguien mueve
// una línea, la regla es que ese campo lo DECLARE en su propio markup con
// `inputMode="numeric"`, que además es la respuesta correcta de UX: teclado
// numérico SIN punto decimal.
//
// O sea: `type="number"` es legal solo junto a `inputMode="numeric"`. Cualquier
// otro caso o migra a `components/ui/AmountInput.jsx`, o dice de frente que es
// un entero.
//
// ⛔ SE PARSEA EL JSX, NO SE LEE CON UN REGEX, y la razón es un error que este
// mismo guardián cometió en su primera versión: buscar el `>` que cierra el tag
// con `indexOf` corta dentro de la PRIMERA función flecha que aparezca
// (`onChange={(e) => ...}`), así que todo `type="number"` escrito DESPUÉS de un
// handler quedaba fuera del tag y se saltaba EN SILENCIO. Con eso el guardián
// reportaba 21 sitios y los verdaderos eran 28: `SellModal`, `GoalTracker`,
// `InlineCreateAccount` y `ProjectionSimulator` pasaban en verde teniendo el
// bug. Un guardián que pasa por la razón equivocada es peor que no tenerlo.

const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const ROOTS = ['components', 'app']
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public'])

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

// El valor de un atributo JSX cuando es una cadena literal. Un valor calculado
// (`type={x}`) devuelve null: no se puede juzgar sin ejecutar, y adivinar sería
// peor que no mirar.
function literalAttr(node, name) {
  for (const a of node.attributes || []) {
    if (a.type !== 'JSXAttribute' || a.name?.name !== name) continue
    if (a.value?.type === 'StringLiteral') return a.value.value
    return null
  }
  return undefined
}

function offendersIn(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
  })
  const found = []
  traverse(ast, {
    JSXOpeningElement(p) {
      if (literalAttr(p.node, 'type') !== 'number') return
      if (literalAttr(p.node, 'inputMode') === 'numeric') return
      found.push(`${path.relative(ROOT, file)}:${p.node.loc.start.line}`)
    },
  })
  return found
}

describe('convención de campos numéricos', () => {
  const files = ROOTS.flatMap((r) => sourceFiles(path.join(ROOT, r)))
  const offenders = files.flatMap(offendersIn).sort()

  test('ningún type="number" con decimales: o AmountInput, o inputMode="numeric"', () => {
    expect(offenders).toEqual([])
  })

  // Sin este segundo test, debilitar el walk (una carpeta que se dejó de
  // recorrer, un parser que revienta y se traga) dejaría el primero en verde
  // para siempre sin estar juzgando nada. Es la lección de FASE JB3: un test que
  // pasa por la razón equivocada es peor que no tener test.
  test('el walk de verdad está leyendo el código', () => {
    expect(files.length).toBeGreaterThan(50)
    const withInputs = files.filter((f) => /<input/.test(fs.readFileSync(f, 'utf8')))
    expect(withInputs.length).toBeGreaterThan(10)
  })

  // Y que el parser encuentre un `type="number"` escrito DESPUÉS de una función
  // flecha, que es exactamente donde la versión con regex se equivocaba.
  test('atrapa un type="number" escrito después de un onChange', () => {
    const tmp = path.join(require('os').tmpdir(), `money-input-fixture-${process.pid}.jsx`)
    fs.writeFileSync(tmp, `
      export default function F({ setQ }) {
        return <input value={1} onChange={(e) => setQ(e.target.value)} type="number" step="any" />
      }
    `)
    try {
      expect(offendersIn(tmp)).toHaveLength(1)
    } finally { fs.unlinkSync(tmp) }
  })

  test('un entero declarado con inputMode="numeric" pasa', () => {
    const tmp = path.join(require('os').tmpdir(), `money-input-ok-${process.pid}.jsx`)
    fs.writeFileSync(tmp, `
      export default function F({ setDay }) {
        return <input onChange={(e) => setDay(e.target.value)} type="number" inputMode="numeric" min="1" max="31" />
      }
    `)
    try {
      expect(offendersIn(tmp)).toHaveLength(0)
    } finally { fs.unlinkSync(tmp) }
  })
})
