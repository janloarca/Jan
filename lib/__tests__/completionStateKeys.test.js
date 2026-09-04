/**
 * @jest-environment node
 */
// Guardián FASE NT: toda llave que un predicado del checklist de brokers
// desestructura tiene que existir en el literal `brokerCompletionState` de
// useDashboardData.
//
// El caso real: `ibkrNavDays` (el paso "traer tus últimos ~365 días" del viaje
// de IBKR) se computaba en brokerCompletionState desde FASE IH y un merge
// posterior (#157) lo borró del literal. El predicado `({ ibkrNavDays }) =>
// (ibkrNavDays || 0) > 0` no falla ante una llave ausente: devuelve false, así
// que el paso 2 quedó "pendiente" para siempre, el viaje tope en 75% y la
// barra sin su check, sin que ningún test ni el build lo vieran. El guardián
// de contratos de hooks (hookContractComplete) no lo caza porque la llave se
// lee del ARGUMENTO del predicado, no del return del hook.
//
// Se lee la FUENTE con el parser de Babel que jest ya trae, nunca una copia
// de las llaves: con una lista propia se podría borrar el campo del hook y
// seguir en verde.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const parse = (rel) => parser.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
  sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
})

// Las llaves del objeto literal asignado a `const brokerCompletionState = useMemo(() => ({...}))`.
function completionStateKeys() {
  const ast = parse('hooks/useDashboardData.js')
  const keys = new Set()
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id?.name !== 'brokerCompletionState') return
      p.traverse({
        ObjectExpression(o) {
          // El primer objeto literal dentro del useMemo es el estado.
          if (keys.size) return
          for (const prop of o.node.properties) {
            if (prop.key) keys.add(prop.key.name || prop.key.value)
          }
        },
      })
    },
  })
  return keys
}

// Toda llave que un predicado (`done`, `skippable`, `attention`) de los pasos
// de IBKR desestructura de su primer parámetro. Solo los arreglos de IBKR: el
// paso genérico de los demás brokers (`GENERIC_STEP`) lee `connected`/
// `imported` de OTRO estado, que no es el de este guardián.
const IBKR_ARRAYS = new Set(['IBKR_STEPS', 'IBKR_JOURNEY_STEPS'])
function predicateKeys(rel) {
  const ast = parse(rel)
  const keys = new Set()
  traverse(ast, {
    VariableDeclarator(v) {
      if (!IBKR_ARRAYS.has(v.node.id?.name)) return
      v.traverse({
        ObjectProperty(p) {
          const name = p.node.key?.name
          if (!['done', 'skippable', 'attention'].includes(name)) return
          const fn = p.node.value
          if (!fn || !['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type)) return
          const param = fn.params[0]
          if (!param || param.type !== 'ObjectPattern') return
          for (const prop of param.properties) {
            if (prop.type === 'ObjectProperty' && prop.key) keys.add(prop.key.name)
          }
        },
      })
    },
  })
  return keys
}

describe('brokerCompletionState cubre toda llave que los predicados leen', () => {
  const state = completionStateKeys()

  it('control positivo: el escáner encontró el estado y los predicados', () => {
    expect(state.size).toBeGreaterThanOrEqual(5)
    expect(state.has('ibkrConnected')).toBe(true)
    expect(predicateKeys('lib/brokerCompletion.js').size).toBeGreaterThanOrEqual(3)
    expect(predicateKeys('lib/ibkrJourney.js').has('ibkrNavDays')).toBe(true)
  })

  for (const rel of ['lib/brokerCompletion.js', 'lib/ibkrJourney.js']) {
    it(`${rel}: ninguna llave leída falta en el estado`, () => {
      const missing = [...predicateKeys(rel)].filter((k) => !state.has(k))
      expect(missing).toEqual([])
    })
  }
})
