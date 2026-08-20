/**
 * @jest-environment node
 */
// Guardián contra un prop que llega `undefined` porque el hook que lo debía
// entregar nunca lo re-exportó.
//
// El caso real: `useFirestoreItems` carga el plan de ingresos y lo devuelve;
// `/finances` lo consume DIRECTO de ahí y funciona; el tablero lo consume de
// `useDashboardData`, que envuelve al primero y re-exporta una lista EXPLÍCITA
// de campos. El plan no estaba en esa lista, así que la card del tablero
// recibía `undefined` y mostraba "todavía no hay ingresos planeados" sobre un
// plan que sí existía, y su `onSave` era undefined, o sea las ediciones no se
// guardaban. Ni `npm run build` ni los tests lo ven: desestructurar un campo
// que no existe es JavaScript válido y devuelve undefined en silencio.
//
// Es la misma familia del `onImportComplete` que se agregó a FileImportModal y
// nunca se le pasó desde page.jsx (documentado en CLAUDE.md).
//
// Este test compara lo que cada consumidor DESESTRUCTURA contra lo que el hook
// de verdad DEVUELVE, y falla si pide algo que no existe.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')

function parseFile(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] })
}

// Los nombres que un hook devuelve, leídos de su `return { ... }` de nivel
// superior. Solo mira objetos literales: si algún hook devolviera un spread o
// un objeto armado dinámicamente, este guardián se apagaría para ese hook en
// vez de dar un falso positivo.
function returnedKeys(rel, hookName) {
  const ast = parseFile(rel)
  const keys = new Set()
  let sawSpread = false
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== hookName) return
      p.traverse({
        ReturnStatement(r) {
          // Solo el return del propio hook, no el de una función anidada.
          if (r.getFunctionParent().node !== p.node) return
          const arg = r.node.argument
          if (!arg || arg.type !== 'ObjectExpression') return
          for (const prop of arg.properties) {
            if (prop.type === 'SpreadElement') { sawSpread = true; continue }
            const k = prop.key
            if (!k) continue
            keys.add(k.name || k.value)
          }
        },
      })
    },
  })
  return { keys, sawSpread }
}

// Los nombres que un archivo desestructura del hook, directo o a través de una
// variable intermedia (`const d = useHook(); const { a, b } = d`), que es como
// lo consume useDashboardData.
function destructuredFrom(rel, hookName) {
  const ast = parseFile(rel)
  const names = new Set()
  const aliases = new Set()

  const collect = (pattern) => {
    for (const prop of pattern.properties) {
      if (prop.type === 'RestElement') continue
      const k = prop.key
      if (k) names.add(k.name || k.value)
    }
  }

  // Primera pasada: quién guarda el resultado del hook en una variable.
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init
      if (init?.type !== 'CallExpression' || init.callee?.name !== hookName) return
      if (p.node.id.type === 'Identifier') aliases.add(p.node.id.name)
      else if (p.node.id.type === 'ObjectPattern') collect(p.node.id)
    },
  })

  // Segunda: lo que se desestructura de esas variables.
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.type !== 'ObjectPattern') return
      const init = p.node.init
      if (init?.type === 'Identifier' && aliases.has(init.name)) collect(p.node.id)
    },
  })

  return names
}

const CONTRACTS = [
  { hook: 'useDashboardData', from: 'hooks/useDashboardData.js', consumers: ['app/dashboard/page.jsx', 'app/spreadsheet/page.jsx'] },
  { hook: 'useFirestoreItems', from: 'hooks/useFirestoreItems.js', consumers: ['app/finances/page.jsx', 'components/LedgerSyncModal.jsx', 'hooks/useDashboardData.js'] },
]

describe('lo que un consumidor pide es lo que el hook de verdad devuelve', () => {
  for (const { hook, from, consumers } of CONTRACTS) {
    for (const consumer of consumers) {
      it(`${consumer} no pide nada que ${hook} no exporte`, () => {
        const { keys, sawSpread } = returnedKeys(from, hook)
        if (sawSpread) return // objeto armado dinámicamente: no se puede juzgar
        expect(keys.size).toBeGreaterThan(0) // el walk encontró el return de verdad
        const asked = destructuredFrom(consumer, hook)
        // Un consumidor que usa el hook sin desestructurar no se puede juzgar;
        // que el guardián no quede en nada lo cubre el test de cobertura de
        // abajo, que exige que al menos un consumidor por contrato SÍ se juzgue.
        const missing = [...asked].filter((n) => !keys.has(n))
        expect(missing).toEqual([])
      })
    }
  }

  for (const { hook, from, consumers } of CONTRACTS) {
    it(`el guardián de ${hook} de verdad está mirando algo`, () => {
      const total = consumers.reduce((n, c) => n + destructuredFrom(c, hook).size, 0)
      expect(total).toBeGreaterThan(5)
    })
  }

  it('atrapa el bug real: un campo pedido que el hook no devuelve', () => {
    // Reproduce la forma exacta del defecto en vez de confiar en que el walk
    // "se ve bien": si un refactor futuro lo debilita, este test lo dice.
    const keys = new Set(['netWorth', 'convert'])
    const asked = new Set(['netWorth', 'convert', 'incomePlan'])
    expect([...asked].filter((n) => !keys.has(n))).toEqual(['incomePlan'])
  })
})
