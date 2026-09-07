/**
 * @jest-environment node
 */
// ⛔ TODA PANTALLA DE ERROR TIENE QUE DEJAR EL DETALLE.
//
// EL BUG. Habia TRES superficies de error y cada una decia algo distinto:
// `app/dashboard/error.jsx` lo tenia todo (FASE IB), `app/global-error.jsx`
// solo el mensaje, y `components/RootErrorBoundary.jsx` NADA. Y la que menos
// decia es justamente la que atrapa lo que las otras no.
//
// El usuario mando una captura de esa pantalla y no traia ni el mensaje ni el
// build, asi que "lo rompio el deploy de hoy" y "el telefono sigue pegado al
// bundle anterior" se veian identicos. Esa ambiguedad ya costo un dia entero y
// cuatro deploys (FASES HK/HM), y es exactamente lo que el build id resuelve.
//
// Este guardian lee los ARCHIVOS, no una copia de sus cadenas: una pantalla de
// error nueva que se olvide del bloque falla aca en vez de descubrirse el dia
// que alguien la necesita.

const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')

// ⛔ LAS PANTALLAS DE ERROR DE RUTA SE DESCUBREN, NO SE LISTAN.
//
// Esto era una lista hardcodeada de tres rutas, y por lo tanto una pantalla de
// error NUEVA pasaba sin ser juzgada: `app/finances/error.jsx` se agrego y el
// guardian no se habria enterado. Una lista escrita a mano es exactamente el
// hueco que FASE JI2 documenta ("un escaner con un hueco es peor que ninguno,
// porque deja la sensacion de haber barrido"), y el precio de tenerlo es que el
// dia que falte el bloque nadie se entera hasta que un usuario manda la captura
// que no sirve para nada.
function findRouteErrorScreens(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) findRouteErrorScreens(full, out)
    else if (entry.name === 'error.jsx') out.push(path.relative(ROOT, full))
  }
  return out
}

// Las dos que NO siguen el patron `app/**/error.jsx` van explicitas: el error
// global (reemplaza el layout raiz) y el boundary de React que atrapa lo que
// ninguna pantalla de ruta puede.
const EXTRA_SURFACES = [
  'app/global-error.jsx',
  'components/RootErrorBoundary.jsx',
]

const ROUTE_SURFACES = findRouteErrorScreens(path.join(ROOT, 'app'))
const SURFACES = [...ROUTE_SURFACES, ...EXTRA_SURFACES]

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('las pantallas de error dejan el detalle', () => {
  // Sin este piso, un cambio de estructura que deje el walk en cero dejaria
  // TODO lo de abajo en verde sin juzgar una sola pantalla. Leccion de FASE JB3.
  test('el walk de verdad encontro las pantallas de ruta', () => {
    expect(ROUTE_SURFACES.length).toBeGreaterThanOrEqual(2)
    expect(ROUTE_SURFACES).toContain('app/dashboard/error.jsx')
    expect(ROUTE_SURFACES).toContain('app/finances/error.jsx')
  })

  test('todas arman el reporte con el helper COMPARTIDO', () => {
    for (const rel of SURFACES) {
      const src = read(rel)
      expect(src).toMatch(/buildErrorReport/)
      expect(src).toMatch(/from '@\/lib\/errorReport'/)
    }
  })

  test('todas ofrecen copiarlo, porque en un telefono no hay consola', () => {
    for (const rel of SURFACES) {
      expect(read(rel)).toMatch(/Copiar para reportar/)
    }
  })

  // En una app de dinero, una pantalla de error sin esta frase asusta mas de lo
  // que informa. Es lo primero que se lee, antes que el detalle tecnico.
  test('todas dicen primero que los datos estan a salvo', () => {
    for (const rel of SURFACES) {
      expect(read(rel)).toMatch(/datos están a salvo|datos estan a salvo/)
    }
  })

  // El contexto de cliente (ruta, hora, navegador) solo existe en el navegador:
  // calcularlo durante el render desajusta la hidratacion, y una pantalla de
  // ERROR que a su vez provoca un error es lo ultimo que queremos (FASE JT ya
  // pago esa trampa).
  //
  // Se juzga sobre el AST y NO con un regex, y la razon es que el regex ya
  // paso por la razon equivocada: `(useEffect\(|componentDidCatch\()[\s\S]*
  // clientErrorContext\(` matchea igual con la llamada movida al render,
  // porque el `useEffect` del `console.error` aparece antes en el archivo. Un
  // test que pasa por la razon equivocada es peor que no tenerlo.
  //
  // La regla real: la funcion que ENCIERRA la llamada no puede ser el cuerpo
  // del componente. En un componente de funcion eso significa que tiene que
  // haber otra funcion por encima (el callback del efecto); en una clase, que
  // el metodo no sea `render`.
  test('el contexto de cliente se resuelve fuera del render', () => {
    for (const rel of SURFACES) {
      const code = read(rel)
      if (!code.includes('clientErrorContext')) continue
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
      })
      let calls = 0
      traverse(ast, {
        CallExpression(p) {
          if (p.node.callee?.name !== 'clientErrorContext') return
          calls++
          const fn = p.getFunctionParent()
          expect(fn).toBeTruthy()
          if (fn.isClassMethod()) {
            expect(`${rel}:${fn.node.key?.name}`).not.toMatch(/:render$/)
          } else {
            // Anidada dentro del componente, o sea es un callback y no el
            // cuerpo que corre en cada render.
            expect(`${rel}:${!!fn.getFunctionParent()}`).toBe(`${rel}:true`)
          }
        },
      })
      expect(`${rel}:${calls}`).toBe(`${rel}:1`)
    }
  })

  test('los archivos existen y de verdad se estan leyendo', () => {
    for (const rel of SURFACES) {
      expect(read(rel).length).toBeGreaterThan(400)
    }
  })
})

describe('buildErrorReport', () => {
  const { buildErrorReport, runningBuild } = require('../errorReport')

  test('el mensaje y el build SIEMPRE salen, aunque el error venga vacio', () => {
    const r = buildErrorReport(null, {})
    expect(r).toMatch(/mensaje: Error inesperado\./)
    expect(r).toMatch(/build: /)
  })

  test('incluye digest, ruta, hora y navegador cuando existen', () => {
    const r = buildErrorReport({ message: 'boom', digest: 'abc123' }, {
      context: { where: '/dashboard?x=1', when: '2026-08-25T14:06:00.000Z', ua: 'Safari/iOS' },
    })
    expect(r).toMatch(/mensaje: boom/)
    expect(r).toMatch(/digest: abc123/)
    expect(r).toMatch(/pantalla: \/dashboard\?x=1/)
    expect(r).toMatch(/cuando: 2026-08-25/)
    expect(r).toMatch(/navegador: Safari\/iOS/)
  })

  test('un campo ausente no imprime una linea vacia', () => {
    const r = buildErrorReport({ message: 'boom' }, {})
    expect(r).not.toMatch(/digest:/)
    expect(r).not.toMatch(/pantalla:/)
    expect(r).not.toMatch(/navegador:/)
  })

  // El arbol de componentes viene minificado en produccion, pero su FORMA dice
  // en que pantalla ocurrio. Se recorta: un stack entero no cabe en una captura.
  test('el arbol de componentes se recorta a unas pocas lineas', () => {
    const stack = Array.from({ length: 40 }, (_, i) => `    at C${i}`).join('\n')
    const r = buildErrorReport({ message: 'x' }, { componentStack: stack })
    expect(r).toMatch(/componente: at C0 \/ at C1 \/ at C2 \/ at C3$/m)
    expect(r).not.toMatch(/at C9\b/)
  })

  // El frame REAL de produccion trae origen, hash y linea:columna. Medido en el
  // navegador: cuatro frames asi se comian OCHO lineas visuales del bloque, o
  // sea rompian justo lo que el reporte existe para lograr (que quepa en una
  // captura). Se conserva la ruta logica del chunk, que es lo que informa.
  test('un frame de produccion se acorta a nombre + chunk', () => {
    const stack = [
      '    at s (https://chispu.xyz/_next/static/chunks/app/dashboard/page-7c0f9cab749ed048.js:1:2314)',
      '    at i (https://chispu.xyz/_next/static/chunks/app/layout-cf1b39d9b15e80f4.js:1:2917)',
      '    at u (https://chispu.xyz/_next/static/chunks/2117-404d22f4e395098b.js:1:16917)',
    ].join('\n')
    const r = buildErrorReport({ message: 'x' }, { componentStack: stack })
    expect(r).toMatch(/componente: at s \(app\/dashboard\/page\) \/ at i \(app\/layout\) \/ at u \(2117\)/)
    expect(r).not.toMatch(/https:/)
    expect(r).not.toMatch(/7c0f9cab/)
    expect(r).not.toMatch(/:1:2314/)
  })

  // Un frame sin URL (el formato de desarrollo) se conserva tal cual.
  test('un frame sin URL no se toca', () => {
    const r = buildErrorReport({ message: 'x' }, { componentStack: '    at NetWorthCard\n    at Dashboard' })
    expect(r).toMatch(/componente: at NetWorthCard \/ at Dashboard/)
  })

  test('runningBuild nunca devuelve vacio', () => {
    expect(String(runningBuild()).length).toBeGreaterThan(0)
  })
})
