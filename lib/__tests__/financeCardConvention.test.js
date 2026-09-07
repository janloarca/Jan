/**
 * @jest-environment node
 */
// ⛔ UNA SOLA GENERACIÓN DE CARD EN FLUJO.
//
// EL DEFECTO QUE ESTO IMPIDE, y es literalmente cómo se llegó a él: Flujo creció
// por acumulación. Las cards viejas quedaron en `card p-4` con el título escrito
// a mano (`<h3 className="text-sm font-semibold" style={{color:...}}>`, 14px,
// sentence-case, tinta primaria) y las cinco que se agregaron después usan
// `card p-4 sm:p-5` + `.card-title` (13px, MAYÚSCULAS, --text-muted, tracking).
// Sentadas en la MISMA columna, la diferencia se lee como desprolijidad aunque
// nadie pueda nombrarla.
//
// Sin guardián, la próxima card se escribe copiando la de al lado y en seis
// meses hay una tercera generación. Este lee los ARCHIVOS, nunca una copia de
// sus cadenas, que es el mismo patrón de `moneyInputConvention` y
// `darkHexInLightTheme`.

const fs = require('fs')
const path = require('path')

const DIR = path.resolve(__dirname, '../..', 'components/finance')

// Un archivo que no dibuja ninguna `.card` no tiene nada que juzgar: es un
// modal, un popover o una lista que vive DENTRO de otra card.
const CARD_RE = /className="card[ "]/

// Excepciones EXPLÍCITAS y con su razón. Una lista sin razones es una lista que
// crece sola hasta que el guardián no juzga nada.
//
// `ALLOW` saca al archivo de TODAS las reglas: no es una card de contenido.
const ALLOW = [
  {
    file: 'MonthStatusBar.jsx',
    why: 'es una barra de estado de UNA línea, no una card de contenido: subirla a p-5 la haría competir con el resumen que va justo abajo, y no lleva título porque su contenido ES el estado',
  },
]

// `ALLOW_TITLE` es más angosto y por eso vale aparte: la card SÍ tiene que
// respetar el padding compartido, lo que no le toca es el encabezado.
const ALLOW_TITLE = [
  {
    file: 'FinanceSummaryCards.jsx',
    why: 'son tres KPI (Entró/Salió/Quedó): su rótulo es el caption ARRIBA de la cifra, el mismo patrón de HOY/YTD del tablero. Un card-title con punto de color sobre cada una pesaría más que los propios números, que son lo que se viene a leer',
  },
]

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx'))
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

// Los archivos que de verdad dibujan una card de contenido.
const cardFiles = files.filter((f) => CARD_RE.test(read(f)) && !ALLOW.some((a) => a.file === f))

describe('las cards de Flujo comparten UNA convención', () => {
  // Sin esto, un walk que deja de encontrar archivos (un rename del directorio,
  // un regex que se estrecha) pasa en verde sin estar juzgando nada. Lección de
  // FASE JB3: un test que pasa por la razón equivocada es peor que no tenerlo.
  test('de verdad está juzgando cards, no una lista vacía', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(cardFiles.length).toBeGreaterThanOrEqual(9)
  })

  test('toda card lleva el padding compartido: p-4 sm:p-5', () => {
    const bad = []
    for (const f of cardFiles) {
      // `card p-4` sin su `sm:p-5` es la firma de la generación vieja: 16px de
      // inset donde el resto de la app pone 20px desde 640px para arriba.
      for (const m of read(f).matchAll(/className="card ([^"]*)"/g)) {
        const cls = m[1]
        if (/\bp-4\b/.test(cls) && !/\bsm:p-5\b/.test(cls)) bad.push(`${f}: className="card ${cls}"`)
      }
    }
    expect(bad.length === 0 ? '' : `\ncards con padding viejo:\n  ${bad.join('\n  ')}\n`).toBe('')
  })

  test('toda card titula con .card-title, nunca con un h3 a mano', () => {
    const bad = cardFiles
      .filter((f) => !ALLOW_TITLE.some((a) => a.file === f))
      .filter((f) => !read(f).includes('card-title'))
    expect(bad.length === 0 ? '' : `\ncards sin card-title:\n  ${bad.join('\n  ')}\n`).toBe('')
  })

  // El título a mano tiene una firma exacta, y prohibirla es lo que impide que
  // alguien agregue `card-title` en un sitio y deje el viejo en otro del mismo
  // archivo (que pasaría el test de arriba sin arreglar nada).
  test('no queda ningún título de card escrito a mano', () => {
    const bad = []
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (/<h3 className="text-sm font-semibold/.test(line)) bad.push(`${f}:${i + 1}`)
      })
    }
    expect(bad.length === 0 ? '' : `\ntítulos a mano:\n  ${bad.join('\n  ')}\n`).toBe('')
  })

  // Una excepción muerta (un archivo renombrado o borrado) hace que la lista
  // deje de describir la realidad, y a partir de ahí nadie confía en ella.
  test('la lista de excepciones no tiene entradas muertas', () => {
    for (const a of [...ALLOW, ...ALLOW_TITLE]) {
      expect(files).toContain(a.file)
      expect(typeof a.why).toBe('string')
      expect(a.why.length).toBeGreaterThan(20)
    }
  })
})
