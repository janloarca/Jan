import { contrastRatio } from '@/lib/colorMath'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// El guardián que impide que un color de tema OSCURO se pinte en tema CLARO.
//
// De dónde sale: el usuario usa tema claro, y un barrido sobre el Patrimonio
// encontró NUEVE hexes escritos a mano que son valores del tema oscuro usados
// como TEXTO. Medidos sobre la card blanca daban entre 1.44:1 y 2.77:1, cuando
// el piso de WCAG AA para texto es 4.5:1. El peor (`#fcd34d`) era amarillo
// pálido sobre blanco: prácticamente invisible.
//
// Por qué `globals.css` no los salva: el bloque de remapeo (`:296-320`) reescribe
// las CLASES de Tailwind (`.text-white`, `.text-slate-*`) con `!important`, pero
// un hex dentro de un `style` inline no es una clase y nunca pasa por ahí.
//
// Por qué un barrido no basta y esto tiene que ser un test: sin guardián, el
// próximo componente vuelve a copiar el hex del tema oscuro y nadie se entera
// hasta que alguien mira la pantalla en claro. Es la misma razón por la que
// `palette.test.js` lee `globals.css` en runtime en vez de llevar su propia
// copia de los hexes.
//
// ⚠️ Si esto falla, la respuesta NO es agregar el archivo a la lista de
// excepciones. Es cambiar el hex por su variable de tema.

const ROOT = join(__dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')

// TODA la app. Empezó cubriendo solo el Patrimonio porque era lo que ese
// trabajo tocaba, y su propio comentario decía que extenderlo era una línea
// cuando tocara: esta es esa línea.
//
// Ampliarlo destapó lo que el alcance viejo escondía: los modales que se abren
// DESDE el tablero fallaban el guardián del tablero (FileImportModal tenía tres
// `#fcd34d` a 1.44:1, el peor caso del repo), y la página compartida (la única
// que ven personas que no son el dueño) pintaba su cifra principal a 1.92:1.
const SCAN_DIRS = ['app', 'components']

function jsxFilesUnder(dir) {
  const abs = join(ROOT, dir)
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.jsx') || p.endsWith('.js')) out.push(p)
    }
  }
  walk(abs)
  return out
}

function tokensOf(blockRe) {
  const out = {}
  let m
  const re = new RegExp(blockRe.source, 'g')
  while ((m = re.exec(CSS))) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2].toLowerCase()
  }
  return out
}

const darkTokens = tokensOf(/:root\s*\{([\s\S]*?)\n\}/)
const lightTokens = tokensOf(/\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)

// Un valor del tema oscuro solo es peligroso si en tema claro vale OTRA cosa.
// `--accent-blue` (#2563EB) es idéntico en los dos, así que escribirlo a mano es
// feo pero no rompe nada y no dispara este guardián.
//
// `--text-primary` queda fuera: su valor oscuro es blanco puro, y el blanco se
// usa legítimamente como texto sobre un fondo de acento (un botón azul). Ese
// caso lo cubre la segunda regla, que mide contra el fondo real.
const FORBIDDEN = Object.entries(darkTokens)
  .filter(([token, darkHex]) => {
    if (token === '--text-primary') return false
    const lightHex = lightTokens[token]
    return lightHex && lightHex !== darkHex
  })
  // El PRIMER token gana: en `:root` los semánticos (`--accent-green`) vienen
  // antes que los de alerta (`--alert-success-icon`), y comparten valor. Sugerir
  // "usá --alert-success-icon" para una cifra de ganancia mandaría al token
  // equivocado.
  .reduce((acc, [token, hex]) => { if (!acc[hex]) acc[hex] = token; return acc }, {})

// Un hex ENTRECOMILLADO: eso lo distingue de la prosa de un comentario, que en
// este repo menciona valores sueltos al explicar por qué se cambiaron.
const QUOTED_HEX = /['"](#[0-9a-fA-F]{6})['"]/g

// La única excepción, y con razón: `handleThemeToggle` sincroniza el
// `<meta name="theme-color">` del navegador, y para eso necesita el literal de
// CADA tema porque está eligiendo entre los dos. No hay variable que sirva ahí.
const ALLOW = [
  { file: 'app/dashboard/page.jsx', match: 'const tc = resolved', why: 'sincroniza el <meta theme-color> del navegador: elige entre los dos temas, así que necesita el literal de cada uno' },
  // Las dos mitades de lo mismo, una capa más arriba: el export `themeColor`
  // del viewport elige por media query y el script inline elige en runtime. Los
  // dos están ELIGIENDO entre los temas, así que necesitan el literal de cada
  // uno; no hay variable que sirva ahí.
  { file: 'app/layout.jsx', match: "media: '(prefers-color-scheme:", why: 'el themeColor del viewport declara el color de CADA tema por media query' },
  { file: 'app/layout.jsx', match: "var tc = theme ===", why: 'el script inline sincroniza el <meta theme-color>: elige entre los dos literales' },
  // `global-error.jsx` renderiza su PROPIO <html> y reemplaza el layout raíz,
  // así que las variables de tema pueden no existir cuando se pinta. Es una
  // superficie negra fija y consistente consigo misma (18.4:1 y 6.6:1 sobre
  // negro), no un token mal usado.
  { file: 'app/global-error.jsx', match: 'style={{ backgroundColor:', why: 'reemplaza el layout raíz: no puede contar con que los tokens existan' },
  { file: 'app/global-error.jsx', match: "color: '#94a3b8'", why: 'misma superficie negra fija que la línea de arriba' },
]

function scan(predicate) {
  const hits = []
  for (const dir of SCAN_DIRS) {
    for (const abs of jsxFilesUnder(dir)) {
      const rel = abs.slice(ROOT.length + 1)
      readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
        if (ALLOW.some((a) => a.file === rel && line.includes(a.match))) return
        predicate(line, (hex, extra) => hits.push({ where: `${rel}:${i + 1}`, hex, ...extra }))
      })
    }
  }
  return hits
}

describe('tema claro: ningún color del tema oscuro escrito a mano', () => {
  it('el CSS se pudo leer y hay tokens que difieren entre temas', () => {
    expect(Object.keys(FORBIDDEN).length).toBeGreaterThan(3)
    // Los dos que de verdad importan: verde de ganancia y rojo de pérdida.
    expect(FORBIDDEN['#34d399']).toBe('--accent-green')
    expect(FORBIDDEN['#f87171']).toBe('--accent-red')
  })

  it('no hay literales de la paleta oscura en el Patrimonio', () => {
    const hits = scan((line, add) => {
      for (const m of line.matchAll(QUOTED_HEX)) {
        const hex = m[1].toLowerCase()
        if (FORBIDDEN[hex]) add(hex, { token: FORBIDDEN[hex] })
      }
    })
    const msg = hits.map((h) => `  ${h.where}  ${h.hex}  ->  var(${h.token})`).join('\n')
    expect(hits.length === 0 ? '' : `\n${hits.length} literales de tema oscuro:\n${msg}\n`).toBe('')
  })
})

describe('tema claro: ningún color escrito a mano desaparece sobre blanco', () => {
  // La card en tema claro es blanca.
  //
  // El piso acá es 3:1, no 4.5:1, y la razón importa: un `color:` puede estar
  // pintando texto (piso 4.5) o un icono de lucide, que hereda `currentColor` y
  // es un OBJETO GRÁFICO (piso 3:1, WCAG SC 1.4.11). Desde un regex no se puede
  // distinguir uno del otro, así que este guardián usa el piso que aplica a los
  // dos y deja el 4.5 donde sí se puede exigir con precisión: `palette.test.js`
  // ya lo hace sobre los TOKENS que viajan como texto.
  //
  // Es la misma postura que ese archivo ya documenta al eximir --accent-orange y
  // --accent-cyan: "Un color no es texto solo por existir". Y no afloja nada
  // real: los nueve hexes que motivaron este trabajo miden entre 1.44 y 2.77,
  // o sea caen todos muy por debajo de 3.
  const CARD = '#FFFFFF'
  const FLOOR = 3.0
  // `color: '#fff'` sobre un fondo de acento es el patrón correcto y sale 1:1
  // contra blanco por definición. Se excluye por valor, no por archivo.
  const IS_WHITE = (h) => /^#f{3,6}$/i.test(h) || h.toLowerCase() === '#ffffff'
  // Solo posiciones de TEXTO. `borderColor` queda fuera a propósito: un borde es
  // un objeto gráfico y su piso es 3:1 (WCAG SC 1.4.11), no 4.5:1. Meterlos en
  // la misma lista mezclaría dos reglas distintas y ensuciaría la señal.
  const COLOR_POS = /\b(?:color|textColor)\s*:\s*(?:[^,;\n]*?\?)?[^,;\n]*?['"](#[0-9a-fA-F]{3,6})['"]/g

  it('ninguno baja del piso de objeto gráfico (3:1)', () => {
    const hits = scan((line, add) => {
      for (const m of line.matchAll(COLOR_POS)) {
        const hex = m[1]
        if (IS_WHITE(hex)) continue
        const r = contrastRatio(hex, CARD)
        if (r < FLOOR) add(hex, { ratio: +r.toFixed(2) })
      }
    })
    const msg = hits.map((h) => `  ${String(h.ratio).padStart(5)}:1  ${h.hex}  ${h.where}`).join('\n')
    expect(hits.length === 0 ? '' : `\n${hits.length} colores invisibles sobre la card blanca:\n${msg}\n`).toBe('')
  })
})
