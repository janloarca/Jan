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

const ROOT = path.resolve(__dirname, '../..')
const SURFACES = [
  'app/dashboard/error.jsx',
  'app/global-error.jsx',
  'components/RootErrorBoundary.jsx',
]

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('las pantallas de error dejan el detalle', () => {
  test('las tres arman el reporte con el helper COMPARTIDO', () => {
    for (const rel of SURFACES) {
      const src = read(rel)
      expect(src).toMatch(/buildErrorReport/)
      expect(src).toMatch(/from '@\/lib\/errorReport'/)
    }
  })

  test('las tres ofrecen copiarlo, porque en un telefono no hay consola', () => {
    for (const rel of SURFACES) {
      expect(read(rel)).toMatch(/Copiar para reportar/)
    }
  })

  // En una app de dinero, una pantalla de error sin esta frase asusta mas de lo
  // que informa. Es lo primero que se lee, antes que el detalle tecnico.
  test('las tres dicen primero que los datos estan a salvo', () => {
    for (const rel of SURFACES) {
      expect(read(rel)).toMatch(/datos están a salvo|datos estan a salvo/)
    }
  })

  // Sin esto, debilitar el walk (una ruta que cambia de nombre) dejaria los de
  // arriba en verde sin estar juzgando nada. Leccion de FASE JB3.
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
