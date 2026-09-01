/**
 * @jest-environment node
 */
// Guardián contra los campos que se escriben a Firestore y no lee NADIE.
//
// Es una familia, no un descuido suelto. En dos meses aparecieron seis, cada
// uno encontrado por accidente mientras se arreglaba otra cosa:
//
//   _confirmedBy      (FASE LC)  se estampaba SIEMPRE, así que el guard de
//                                "no escribas si el parche está vacío" no podía
//                                dispararse nunca: un write por fila en cada
//                                re-import sobre datos idénticos.
//   touched           (FASE LB)  un parámetro que el cuerpo nunca leía y que
//                                describía un mecanismo que no era el real.
//   syncedPct         (FASE LE)  auto-reportado por el cliente, otorgaba una
//                                insignia que otras personas leen.
//   lastSync          (FASE LE)  el vault lo LEÍA y nadie lo escribía: siempre
//                                null, o sea el espejo del mismo defecto.
//   prefs.profileName (FASE KB)  los correos lo leían y ningún writer lo ponía:
//                                todos los PDF salieron sin nombre.
//   formatShortDate   (FASE ME5) cero consumidores, y encima con un bug adentro.
//
// El daño no es el byte guardado. Un campo escrito y nunca leído es cómo
// alguien más adelante cree que sirve para algo: se apoya en él, o "arregla"
// el lector que falta y con eso enciende una función que nadie diseñó. Y su
// espejo (leído y nunca escrito) es peor todavía, porque el lector se comporta
// como si el dato existiera y lo que corre es la rama del `undefined`.
//
// LO QUE MIRA, y por qué son DOS reglas y no una:
//
//   (1) Una llave de un objeto literal que va como ARGUMENTO a una función que
//       persiste (la lista WRITERS de abajo). Precisa, y es la única que puede
//       ver un campo sin prefijo como `totalContributedUSD`.
//
//   (2) Cualquier llave con UN guion bajo al frente, en cualquier objeto de
//       producción. En este repo ese prefijo es la convención de metadatos
//       propios (`_source`, `_linkedItemId`, `_needsReview`...): nunca es una
//       prop de React ni un estilo en línea, así que se puede exigir sin ruido.
//
//   Hace falta la (2) porque casi ningún payload se escribe en línea: se arma
//   como `const feeTx = {...}` y se pasa después, y ahí la regla (1) no ve
//   nada. Medido: con solo la regla (1) el barrido reportaba 4 campos; con las
//   dos, 13. `_paidFromItemId` (un gasto pagado desde una cuenta que no
//   aparecía en esa cuenta) vive exactamente en ese hueco.
//
//   Lectura = `x.campo`, `x?.campo`, `x['campo']` o una desestructuración, en
//   cualquier archivo de PRODUCCIÓN. Los tests no cuentan como lectura: un
//   campo que solo su propio test lee sigue estando muerto en la app, que es
//   exactamente el caso de `syncedPct`.
//
// LO QUE NO PUEDE VER, dicho de frente:
//
//   · Una llave computada (`{ [k]: v }`) no tiene nombre en el AST, así que ni
//     se cuenta como escritura ni el guardián puede afirmar nada sobre ella.
//     Los interruptores de notificación se escriben así y por eso no aparecen.
//   · Las lecturas se cuentan por NOMBRE, no por objeto: si un campo `foo` se
//     lee de OTRA cosa en cualquier parte del repo, este guardián lo da por
//     leído. Es deliberado (rastrear el objeto exigiría dataflow) y solo puede
//     producir falsos NEGATIVOS.
//
// O sea: es un límite de recall, no de precisión. Lo que el guardián reporta es
// real, y lo que se le escapa se sigue encontrando a mano, como hasta ahora.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks', 'test-utils']
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public'])

// Las funciones detrás de las cuales un objeto literal termina en Firestore:
// el SDK crudo, los escritores del hook de datos, y los props con los que un
// modal se los pide al tablero (que es donde vivían tres de los seis de
// arriba).
const WRITERS = new Set([
  'setDoc', 'updateDoc', 'addDoc', 'set', 'update', 'create',
  'saveSettings', 'saveProfile', 'saveGoals', 'saveSnapshot', 'saveItemSnapshots',
  'updateItem', 'addItem', 'bulkImport',
  'addTransaction', 'updateTransaction',
  'addFinanceTransaction', 'updateFinanceTransaction',
  'onSaveSettings', 'onSaveProfile', 'onSaveGoals', 'onSaveCredentials',
  'onSaveCredentialsPending', 'onAddTransaction', 'onUpdateTransaction',
  'onAdd', 'onSave', 'onUpdate', 'onExecuteContribution', 'executeSaleAtomic',
])

// Excepciones, cada una con su razón. La regla para entrar acá es que el campo
// sea un HECHO que el documento debe conservar aunque hoy ninguna pantalla lo
// pregunte, no "todavía no lo cableé".
//
// Los cinco metadatos crudos de broker (_isShort, _weight, _bcOrdId,
// _etoroInstrumentId, _unrealizedPL) comparten una razón de grupo: son valores
// que la app NO puede re-derivar, solo volver a descargar del broker, sobre un
// registro que se importa una vez. Guardarlos cuesta un campo; perderlos cuesta
// otra corrida contra un servicio que ya bloqueó a este usuario una vez por
// intentos repetidos (FASE II3/KL).
const ALLOWED = {
  _calibratedAt:
    'FASE GI. La HORA exacta en que se tecleó un % de calibración. El ancla ya ' +
    'queda fijada a ese instante por el solve; esto es la constancia de cuándo ' +
    'se afirmó, sobre un dato que el usuario puede querer revisar meses después.',
  appliedAt:
    'FASE HV. Dentro de _liquidYield: cuándo se aceptó el rendimiento deducido. ' +
    'Constancia de una decisión sobre dinero que ya se escribió como movimiento.',
  dismissed:
    'FASE HV. Dentro de _liquidYield: distingue "lo acepté" de "dije que no era ' +
    'rendimiento". Lo que SUPRIME la pregunta es la firma, no este campo, pero ' +
    'sin él las dos respuestas quedarían indistinguibles en el documento.',
  closedPrice:
    'El precio al que se cerró un lote. `realizedGain` se deriva de él y sí se ' +
    'lee; el precio queda como el hecho del que esa cifra sale, sobre un ' +
    'registro permanente que no se puede re-derivar si el histórico cambia.',
  _autoCategory:
    'La CONFIANZA con la que el clasificador eligió la categoría (user / ' +
    'merchant / unknown). Lo que la app consume es `_needsReview`, derivado de ' +
    'ella; esto conserva el grano fino sobre una fila ya guardada, que es lo ' +
    'que permitiría medir después qué tan bien clasifica sin re-correr nada.',
  _fxRate:
    'La tasa que el BANCO de verdad aplicó en una transferencia entre monedas. ' +
    'Es derivable de los dos montos, y aun así se guarda: es el número que uno ' +
    'reclama contra su estado de cuenta, y dejarlo escrito es registrar lo que ' +
    'se calculó ESE día en vez de recalcularlo con supuestos de mañana.',
  _assetFlowSynth:
    'Marca una fila SINTÉTICA armada en memoria por el motor de retornos (un ' +
    'pago de deuda reexpresado como retiro); nunca se persiste. Distingue una ' +
    'fila inventada de una real para cualquiera que depure ese arreglo.',
  _isShort:
    'Metadato CRUDO del broker sobre la posición importada (IBKR). Se conserva ' +
    'en el registro para que una reconciliación futura no tenga que volver a ' +
    'bajar el reporte; ver la nota de grupo abajo.',
  _weight:
    'Metadato CRUDO del broker: el peso que el propio IBKR le asigna a la ' +
    'posición en su reporte. Mismo criterio de grupo que _isShort.',
  _bcOrdId:
    'El id de orden del propio Blockchain.com sobre el movimiento importado. Es ' +
    'la llave con la que ese movimiento se vuelve a encontrar del lado del ' +
    'broker: re-derivarlo no se puede, solo re-descargarlo.',
  _etoroInstrumentId:
    'El id de instrumento del propio eToro. Mismo caso que _bcOrdId: identifica ' +
    'la posición del lado del broker y no se puede re-derivar desde acá.',
  _unrealizedPL:
    'La ganancia no realizada tal como la reporta el broker (Saxo, ' +
    'TradeStation). La app calcula la suya con su propia convención; esta queda ' +
    'como la cifra del broker contra la cual comparar cuando no cuadren.',
  friendsHistory:
    'FASE IF2. Vive en `system/notificationsCron`, que ES el registro operativo ' +
    'del cron y no un documento de usuario. Se dejó FUERA del diagnóstico de ' +
    'Ajustes a propósito: esa pantalla contesta preguntas sobre el CORREO, y ' +
    'traerlo hasta el cliente sin dibujarlo solo movería el campo muerto una ' +
    'capa más adentro.',
}

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

const isTest = (file) => /__tests__|\.test\./.test(file)

function keyName(node, computed) {
  if (computed) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'StringLiteral') return node.value
  return null
}

function scan() {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
  const writes = new Map() // campo -> Set('archivo:línea')
  const reads = new Set()

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const testFile = isTest(file)
    let ast
    try {
      ast = parser.parse(fs.readFileSync(file, 'utf8'), {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
      })
    } catch {
      continue
    }

    traverse(ast, {
      // Regla (2): el prefijo de un solo guion bajo es la convención de
      // metadatos propios del repo. `__` doble queda fuera: ahí viven cosas
      // ajenas (`__html` de React) y de arnés (`__writes`, `__id`, `__fake`).
      ObjectProperty(p) {
        if (testFile || p.node.computed) return
        const key = keyName(p.node.key, false)
        if (!key || !/^_[^_]/.test(key)) return
        if (!writes.has(key)) writes.set(key, new Set())
        writes.get(key).add(`${rel}:${p.node.key.loc.start.line}`)
      },
      CallExpression(p) {
        if (testFile) return
        const callee = p.node.callee
        const name = callee.type === 'Identifier'
          ? callee.name
          : (callee.type === 'MemberExpression' && callee.property.type === 'Identifier')
            ? callee.property.name
            : null
        if (!name || !WRITERS.has(name)) return
        // Recorre el objeto completo: anidados, spreads de literales y las dos
        // ramas de un ternario, que es como se escriben los campos
        // condicionales (`...(x ? { campo: v } : {})`).
        for (const arg of p.node.arguments) {
          if (!arg || arg.type !== 'ObjectExpression') continue
          const stack = [arg]
          while (stack.length) {
            const obj = stack.pop()
            for (const prop of obj.properties) {
              if (prop.type === 'SpreadElement') {
                if (prop.argument.type === 'ObjectExpression') stack.push(prop.argument)
                else if (prop.argument.type === 'ConditionalExpression') {
                  for (const branch of [prop.argument.consequent, prop.argument.alternate]) {
                    if (branch.type === 'ObjectExpression') stack.push(branch)
                  }
                }
                continue
              }
              if (prop.type !== 'ObjectProperty') continue
              const key = keyName(prop.key, prop.computed)
              if (key) {
                if (!writes.has(key)) writes.set(key, new Set())
                writes.get(key).add(`${rel}:${prop.key.loc.start.line}`)
              }
              if (prop.value && prop.value.type === 'ObjectExpression') stack.push(prop.value)
              if (prop.value && prop.value.type === 'ConditionalExpression') {
                for (const branch of [prop.value.consequent, prop.value.alternate]) {
                  if (branch.type === 'ObjectExpression') stack.push(branch)
                }
              }
            }
          }
        }
      },
      MemberExpression(p) {
        if (testFile) return
        if (p.node.computed) {
          if (p.node.property.type === 'StringLiteral') reads.add(p.node.property.value)
          return
        }
        if (p.node.property.type === 'Identifier') reads.add(p.node.property.name)
      },
      OptionalMemberExpression(p) {
        if (testFile) return
        if (p.node.computed) {
          if (p.node.property.type === 'StringLiteral') reads.add(p.node.property.value)
          return
        }
        if (p.node.property.type === 'Identifier') reads.add(p.node.property.name)
      },
      ObjectPattern(p) {
        if (testFile) return
        for (const prop of p.node.properties) {
          if (prop.type !== 'ObjectProperty') continue
          const key = keyName(prop.key, prop.computed)
          if (key) reads.add(key)
        }
      },
    })
  }

  const orphans = new Map()
  for (const [field, locs] of writes) {
    if (!reads.has(field)) orphans.set(field, [...locs].sort())
  }
  return orphans
}

// Una sola pasada para los tres tests: el AST del repo entero no es barato.
const ORPHANS = scan()

describe('ningún campo se persiste sin que algo lo lea', () => {
  it('no hay campos huérfanos fuera de la lista de excepciones', () => {
    const unexpected = [...ORPHANS.entries()].filter(([field]) => !(field in ALLOWED))
    const detail = unexpected
      .map(([field, locs]) => `  ${field}  —  ${locs.join(', ')}`)
      .join('\n')
    expect(detail ? `\n${detail}\n` : '').toBe('')
  })

  // Sin esto la lista se pudre: un campo que ya se cableó (o que se borró)
  // seguiría perdonado para siempre, y la próxima vez que alguien escriba uno
  // con ese nombre pasaría en verde. Mismo criterio que la lista de excepciones
  // del guardián de animación de modales (FASE JI2).
  it('la lista de excepciones no tiene entradas muertas', () => {
    const stale = Object.keys(ALLOWED).filter((field) => !ORPHANS.has(field))
    expect(stale).toEqual([])
  })

  it('cada excepción dice POR QUÉ, no solo que se perdona', () => {
    for (const [field, reason] of Object.entries(ALLOWED)) {
      expect(typeof reason).toBe('string')
      expect(reason.trim().length).toBeGreaterThan(60)
    }
  })
})

// El guardián solo vale si de verdad distingue escritura de lectura. Sin este
// control, un walk roto que no encontrara NINGUNA escritura pasaría en verde
// sobre un repo lleno de huérfanos.
describe('el escáner mide lo que dice medir', () => {
  it('encuentra escrituras y lecturas de verdad en el repo', () => {
    // `_source` se escribe en decenas de writers y se lee en todos lados: si el
    // walk estuviera roto, este campo aparecería como huérfano.
    expect(ORPHANS.has('_source')).toBe(false)
    // Y la lista de excepciones prueba que el lado de las escrituras encuentra
    // algo: si no encontrara nada, ORPHANS estaría vacío y el test de entradas
    // muertas de arriba fallaría.
    expect(ORPHANS.size).toBeGreaterThan(0)
  })
})
