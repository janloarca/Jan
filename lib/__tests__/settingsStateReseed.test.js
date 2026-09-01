/**
 * @jest-environment node
 */
// Guardián: todo control de Ajustes sembrado de `settings` tiene que RESEMBRARSE
// cuando el valor guardado cambie.
//
// El defecto, reportado con captura por el usuario (FASE IE9): `useState` corre
// UNA sola vez, así que un control cuyo valor inicial sale de `settings?.X` se
// queda con su default para toda esa apertura del modal si el documento no
// había llegado — o si su lectura FALLÓ, que es exactamente lo que pasó ahí: la
// cuota diaria de Firestore agotada. El usuario vio los tres interruptores de
// correo en apagado estando suscrito.
//
// Aquel arreglo cubrió `emailPrefs` y dejó los otros cuatro (`notifPrefs`,
// `friendsEnabled`, `baseCurrency`, `benchmarkSymbol`) con el mismo defecto:
// no es que se haya escrito mal, es que el arreglo se aplicó a un solo hermano.
// Este guardián existe para que el quinto no vuelva a quedarse afuera.
//
// Y la mitad que hace que no sea cosmético: los tres primeros MIENTEN sobre el
// estado (default encendido, así que a quien los apagó le dicen que están
// prendidos), pero `baseCurrency` además ESCRIBE — `handleSave` persiste ese
// estado, o sea con `settings` sin llegar, apretar Guardar reemplaza la moneda
// base real por USD, y contra ella se convierte cada cifra de la app.
//
// LO QUE MIRA: dentro de `SettingsModal`, cada `useState` cuyo inicializador
// menciona `settings?.` o `settings[` tiene que tener su setter llamado dentro
// de algún `useEffect` del mismo archivo. No verifica que las DEPENDENCIAS del
// efecto sean las correctas (eso exige entender la intención); verifica que el
// control no se quede sembrado una sola vez, que es el defecto que se repitió.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const FILE = path.resolve(__dirname, '../../components/SettingsModal.jsx')

function analyze() {
  const ast = parser.parse(fs.readFileSync(FILE, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  })

  const seeded = [] // { state, setter, line }
  const reseeded = new Set() // setters llamados dentro de un useEffect

  traverse(ast, {
    // const [x, setX] = useState(<algo que menciona settings>)
    VariableDeclarator(p) {
      const { id, init } = p.node
      if (!init || init.type !== 'CallExpression') return
      if (init.callee.type !== 'Identifier' || init.callee.name !== 'useState') return
      if (id.type !== 'ArrayPattern' || id.elements.length < 2) return
      const state = id.elements[0]
      const setter = id.elements[1]
      if (!state || !setter || state.type !== 'Identifier' || setter.type !== 'Identifier') return

      // ¿el inicializador lee `settings`?
      let readsSettings = false
      p.get('init').traverse({
        Identifier(q) { if (q.node.name === 'settings') readsSettings = true },
      })
      if (!readsSettings) return
      seeded.push({ state: state.name, setter: setter.name, line: p.node.loc.start.line })
    },

    // useEffect(() => { ... setX(...) ... }, [...])
    CallExpression(p) {
      if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 'useEffect') return
      p.traverse({
        CallExpression(q) {
          if (q.node.callee.type === 'Identifier') reseeded.add(q.node.callee.name)
        },
      })
    },
  })

  return { seeded, reseeded }
}

const { seeded, reseeded } = analyze()

describe('un control de Ajustes no puede quedarse sembrado una sola vez', () => {
  it('el escáner encuentra los controles de verdad', () => {
    // Si esto se rompiera, todo lo de abajo pasaría en verde sin mirar nada.
    const names = seeded.map((s) => s.state)
    expect(names).toEqual(expect.arrayContaining(['baseCurrency', 'notifPrefs', 'emailPrefs', 'friendsEnabled']))
  })

  it('cada uno se resiembra cuando cambia el valor guardado', () => {
    const missing = seeded
      .filter((s) => !reseeded.has(s.setter))
      .map((s) => `  ${s.state} (línea ${s.line}): nadie llama ${s.setter} dentro de un useEffect`)
    expect(missing.join('\n')).toBe('')
  })
})
