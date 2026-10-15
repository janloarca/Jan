/**
 * @jest-environment node
 */
// FASE QK. Guardián de FUENTE de la consistencia entre puertas.
//
// Lo que estos cuatro cierres tienen en común es que NINGUNO falla ruidosamente:
// un prop que el montaje no pasa es `undefined` y el componente cae a su
// default, un `? x : null` por conteo simplemente esconde una entrada del menú,
// y un callback que nadie conecta no lanza nada. Es JavaScript válido, build y
// jest en verde, y la app se comporta distinto según por qué puerta entraste a
// la MISMA acción (la queja original: "cuando uno empieza y pone una acción es
// diferente a cuando uno pone el botón de + nuevo o cuando uno conecta su
// broker").
//
// Se lee el AST (nunca el texto crudo): los comentarios de estas mismas
// correcciones citan literalmente las formas prohibidas para explicar por qué
// estaban mal, y un regex sobre el texto las marcaría como código.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.join(__dirname, '..', '..')

function parse(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return parser.parse(code, { sourceType: 'module', plugins: ['jsx'] })
}

const nameOf = (n) => (n.type === 'JSXIdentifier' ? n.name : null)

// Todos los JSXOpeningElement de `tag` en un archivo, con sus atributos por nombre.
function elementsNamed(rel, tag) {
  const out = []
  traverse(parse(rel), {
    JSXOpeningElement(p) {
      if (nameOf(p.node.name) !== tag) return
      const attrs = {}
      for (const a of p.node.attributes) {
        if (a.type === 'JSXAttribute') attrs[a.name.name] = a.value
      }
      out.push({ node: p.node, attrs })
    },
  })
  return out
}

// Elementos con un atributo dado igual a un literal de cadena (ej. role="dialog").
function elementsWithAttr(rel, attr, value) {
  const out = []
  traverse(parse(rel), {
    JSXOpeningElement(p) {
      const hit = p.node.attributes.find((a) =>
        a.type === 'JSXAttribute' && a.name.name === attr && a.value && a.value.type === 'StringLiteral' && a.value.value === value)
      if (!hit) return
      const attrs = {}
      for (const a of p.node.attributes) if (a.type === 'JSXAttribute') attrs[a.name.name] = a.value
      out.push({ node: p.node, attrs })
    },
  })
  return out
}

// Texto de una expresión de atributo `{...}` cuando es un Identifier ('onClose'), si no null.
const identOf = (attrValue) =>
  attrValue && attrValue.type === 'JSXExpressionContainer' && attrValue.expression.type === 'Identifier'
    ? attrValue.expression.name
    : null

function walkAll(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walkAll(rel, acc)
    else if (/\.(jsx?|mjs)$/.test(e.name)) acc.push(rel)
  }
  return acc
}

describe('FASE QK: la Hoja monta el alta con lo mismo que el tablero', () => {
  const sheet = elementsNamed('app/spreadsheet/page.jsx', 'AddAccountModal')
  const board = elementsNamed('app/dashboard/page.jsx', 'AddAccountModal')

  it('control: los dos montajes existen (si no, todo lo demás pasa vacío)', () => {
    expect(sheet.length).toBeGreaterThanOrEqual(1)
    expect(board.length).toBeGreaterThanOrEqual(1)
  })

  it.each(['onAddLot', 'activePortfolio', 'onAddTransaction', 'onCreateDestination', 'defaults'])(
    'el montaje de la Hoja pasa `%s`', (prop) => {
      expect(sheet[0].attrs).toHaveProperty(prop)
    }
  )

  it('todo lo que el tablero le pasa al alta que importa para los datos, la Hoja también', () => {
    // Las props que escriben o etiquetan; las demás (profileTaxResidence, lang...)
    // son presentación. Si el tablero gana una prop de datos nueva, esta lista
    // es donde se decide si la Hoja la necesita.
    const DATA = ['onAdd', 'onAddTransaction', 'onAddLot', 'onExecuteContribution', 'onCreateDestination', 'existingItems', 'activePortfolio']
    for (const p of DATA) {
      expect(board[0].attrs).toHaveProperty(p)
      expect(sheet[0].attrs).toHaveProperty(p)
    }
  })
})

describe('FASE QK: "Guíame paso a paso" no depende de cuántos activos haya', () => {
  const header = elementsNamed('app/dashboard/page.jsx', 'Header')

  it('control: el Header del tablero declara onGuided', () => {
    expect(header.length).toBeGreaterThanOrEqual(1)
    expect(header[0].attrs).toHaveProperty('onGuided')
  })

  it('onGuided es un handler a secas, nunca un ternario por conteo que lo vuelve null', () => {
    // Antes: onGuided={portfolioItems.length === 0 ? handleOpenGuided : null}.
    // dashboardActions filtra por onClick truthy, así que la entrada se iba del
    // menú para siempre en cuanto había un activo.
    for (const el of elementsNamed('app/dashboard/page.jsx', 'Header')) {
      expect(identOf(el.attrs.onGuided)).not.toBeNull()
    }
  })
})

describe('FASE QK: onImportComplete no vuelve a ser un prop muerto', () => {
  it('ningún archivo de código lo declara ni lo pasa (si vuelve, tiene que tener caller)', () => {
    const hits = []
    for (const rel of [...walkAll('app'), ...walkAll('components'), ...walkAll('hooks')]) {
      traverse(parse(rel), {
        Identifier(p) { if (p.node.name === 'onImportComplete') hits.push(`${rel}:${p.node.loc.start.line}`) },
        JSXIdentifier(p) { if (p.node.name === 'onImportComplete') hits.push(`${rel}:${p.node.loc.start.line}`) },
      })
    }
    expect(hits).toEqual([])
  })
})

describe('FASE QK: el paso de broker del recorrido guiado no se salta la pantalla de cierre', () => {
  it('el onClick que llama onConnectBroker NO llama onClose (lo cierra el usuario desde el cierre)', () => {
    let found = 0
    const offenders = []
    traverse(parse('components/dashboard/GuidedSetup.jsx'), {
      JSXAttribute(p) {
        if (p.node.name.name !== 'onClick') return
        let callsConnect = false
        const closers = []
        p.traverse({
          Identifier(q) { if (q.node.name === 'onConnectBroker') callsConnect = true },
          CallExpression(q) {
            if (q.node.callee.type === 'Identifier' && q.node.callee.name === 'onClose') closers.push(q.node.loc.start.line)
          },
        })
        if (!callsConnect) return
        found++
        offenders.push(...closers)
      },
    })
    expect(found).toBeGreaterThanOrEqual(1)
    expect(offenders).toEqual([])
  })
})

describe('FASE QK: los modales que mueven dinero no se descartan de un toque en el telón', () => {
  const MONEY = ['components/TransferModal.jsx', 'components/SellModal.jsx']

  it.each(MONEY)('%s: su role="dialog" usa onBackdropClick y no onClose pelado', (rel) => {
    const dialogs = elementsWithAttr(rel, 'role', 'dialog')
    expect(dialogs.length).toBeGreaterThanOrEqual(1)
    for (const d of dialogs) {
      expect(identOf(d.attrs.onClick)).not.toBe('onClose')
      // El camino correcto es una llamada: onBackdropClick(dirty).
      const v = d.attrs.onClick
      expect(v && v.type === 'JSXExpressionContainer').toBe(true)
    }
  })

  it('AddAccountModal: TODO diálogo del alta usa el telón con protección', () => {
    // Antes eran dos ramas (guiada y larga) y la guiada cerraba con `exit`
    // pelado. FASE QG (sesión paralela) quitó la guiada, así que hoy hay UN
    // diálogo; el test cuenta "al menos uno" y no "exactamente uno" para que
    // volver a tener una segunda rama exija protegerla también, en vez de
    // fallar por el número.
    const dialogs = elementsWithAttr('components/AddAccountModal.jsx', 'role', 'dialog')
    expect(dialogs.length).toBeGreaterThanOrEqual(1)
    for (const d of dialogs) {
      expect(identOf(d.attrs.onClick)).toBe('onBackdropClick')
    }
  })
})

describe('FASE QK: ningún dos-toques de borrado queda armado para siempre', () => {
  it('FinanceWipePanel desarma solo (useAutoDisarm)', () => {
    let uses = 0
    traverse(parse('components/settings/FinanceWipePanel.jsx'), {
      CallExpression(p) { if (p.node.callee.type === 'Identifier' && p.node.callee.name === 'useAutoDisarm') uses++ },
    })
    expect(uses).toBe(1)
  })
})
