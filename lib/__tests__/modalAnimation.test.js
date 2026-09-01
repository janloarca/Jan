import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const DIRS = ['app', 'components']
const SKIP = new Set(['node_modules', '.next', '.git', '__tests__'])

// ⛔ TODO MODAL ENTRA Y SALE CON ANIMACIÓN.
//
// La regla vivía dentro de `.modal-glass` y su comentario afirmaba que "una
// regla cubre a los 21". Al ir a agregarle la SALIDA resultó falso: NUEVE
// modales reales traen su propio panel y por lo tanto nunca recibieron nada,
// así que la mitad de la app entraba con animación y la otra mitad de golpe,
// sin que nadie pudiera notarlo leyendo un archivo suelto.
//
// Este guardián existe para que eso no vuelva a pasar en silencio: un modal
// nuevo que no pida el movimiento falla acá, no dentro de seis meses cuando
// alguien note que "ese modal se siente distinto".
//
// La animación se pide con `.modal-glass` (que la incluye) o con `.modal-anim`
// (solo el movimiento, sin heredar fondo ni borde: es la que permite incluir a
// un modal con panel propio sin cambiarle un solo color).
//
// ⚠️ EL BARRIDO NO PUEDE FIJAR EL z-index. La primera versión de este guardián
// buscaba `fixed inset-0 z-50` y por eso se saltó a `BrokerConnectModal`, que
// usa `z-[60]` para apilarse sobre el modal que lo abre: un décimo modal sin
// animación que el guardián daba por cubierto. Un escáner con un hueco es peor
// que ninguno, porque deja la sensación de haber barrido.

// Overlays que NO son modales, cada uno con su razón. Es una lista explícita a
// propósito: agregar algo acá tiene que ser una decisión, no un descuido.
const NOT_MODALS = {
  'components/dashboard/MobileNav.jsx':
    'hoja inferior de navegación, no un panel centrado: su entrada es otro patrón',
  'app/dashboard/page.jsx':
    'ModalSkeleton, el placeholder mientras carga el chunk del modal REAL; animarlo lo haría entrar dos veces',
  'components/finance/FinanceTransactionList.jsx':
    'solo el telón: el panel es CategoryEditor, que sí la pide',
  'components/dashboard/Header.jsx':
    'captura-clics invisible detrás del menú Nuevo: no dibuja nada que animar',
  'components/dashboard/PortfolioSelector.jsx':
    'lo mismo, detrás del selector de portafolio',
}

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sourceFiles(p, out)
    else if (/\.jsx$/.test(e.name)) out.push(p)
  }
  return out
}

function overlayFiles() {
  const out = []
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const f of sourceFiles(abs)) {
      const src = fs.readFileSync(f, 'utf8')
      if (/fixed inset-0 z-/.test(src)) out.push([path.relative(ROOT, f), src])
    }
  }
  return out
}

describe('todo modal entra y sale con animacion', () => {
  test('cada overlay de modal pide el movimiento', () => {
    const sinAnimacion = []
    for (const [rel, src] of overlayFiles()) {
      if (NOT_MODALS[rel]) continue
      if (!/modal-glass|modal-anim/.test(src)) sinAnimacion.push(rel)
    }
    expect(sinAnimacion).toEqual([])
  })

  // Sin esto el test de arriba podría quedarse en nada (si el barrido dejara de
  // encontrar archivos, pasaría en verde sin juzgar a nadie).
  test('el barrido de verdad encuentra los modales', () => {
    expect(overlayFiles().length).toBeGreaterThan(20)
  })

  // Una entrada de la lista de excepciones que ya no corresponde a un archivo
  // con overlay es basura que esconde lo que el guardián debería estar viendo.
  test('la lista de excepciones no tiene entradas muertas', () => {
    const reales = new Set(overlayFiles().map(([rel]) => rel))
    const muertas = Object.keys(NOT_MODALS).filter((k) => !reales.has(k))
    expect(muertas).toEqual([])
  })

  // La animación y el tratamiento visual del panel tienen que seguir siendo
  // clases SEPARADAS: fusionarlas devolvería el problema original, porque un
  // modal con panel propio no puede adoptar `.modal-glass` sin cambiar de
  // colores. (AccountReviewModal FUE literalmente ese caso: panel blanco con
  // texto `text-slate-900`; en FASE ME se migró entero a tokens y hoy usa
  // `.modal-glass`, pero la separación sigue haciendo falta para cualquier
  // modal futuro con panel propio, p.ej. PrintSummary.)
  test('modal-anim existe y no arrastra colores', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toMatch(/\.modal-glass,\s*\n\.modal-anim\s*\{\s*\n\s*animation: modal-in/)
    // El bloque de `.modal-glass` no puede volver a traer la animación adentro.
    const bloque = css.slice(css.indexOf('.modal-glass {'), css.indexOf('.modal-glass {') + 400)
    expect(bloque.slice(0, bloque.indexOf('}'))).not.toMatch(/animation:/)
  })

  test('la salida existe para las dos clases y apaga la interaccion', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    expect(css).toContain('[data-modal-exit] > *')
    expect(css).toMatch(/\[data-modal-exit\] \.modal-glass,\s*\n\[data-modal-exit\] \.modal-anim/)
    // Durante la salida el modal sigue en el DOM: sin esto un clic apurado
    // dispararía una acción sobre un modal que el usuario ya cerró.
    const salida = css.slice(css.indexOf('[data-modal-exit] > *'))
    expect(salida.slice(0, salida.indexOf('}'))).toContain('pointer-events: none')
  })
})
