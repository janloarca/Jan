/**
 * @jest-environment node
 */
// Guardián del EMBUDO PÚBLICO: la landing, el login y los dos documentos
// legales tienen que estar en UN solo idioma.
//
// Estas cuatro pantallas son las únicas que ve alguien que todavía no tiene
// cuenta, y son las únicas de la app que NO son bilingües: no tienen selector
// de idioma (el único vive dentro de SettingsModal, detrás del login), así que
// su idioma es una decisión fija del producto y no una preferencia.
//
// La decisión, ya tomada en tres pasos separados, es INGLÉS: FASE HZ2 pasó
// /terms y /privacy a inglés, FASE JJ reconstruyó la landing en inglés, y el
// login quedó atrás en español con dos etiquetas ("Email", "Password") en
// inglés, o sea contradiciéndose dentro de sí mismo Y contra la página de la
// que viene. Un visitante de LinkedIn leía una landing en inglés y al primer
// clic aterrizaba en otro idioma: exactamente lo que se lee como producto a
// medio hacer.
//
// El guardián mira el AST y no el texto crudo, así que los COMENTARIOS del
// código (que son en español en todo este repo, y deben seguirlo) no cuentan:
// Babel no los expone como StringLiteral ni como JSXText.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.join(__dirname, '..', '..')

// Las cuatro superficies del embudo. La app DETRÁS del login es bilingüe a
// propósito y no entra acá: ahí el idioma sí es preferencia del usuario.
const PUBLIC_SURFACES = [
  'app/page.jsx',
  'app/login/page.jsx',
  'app/terms/page.jsx',
  'app/privacy/page.jsx',
]

// Diacríticos y signos de apertura: inequívocos, ninguna palabra inglesa los
// lleva. Más un puñado de palabras españolas sin acento que sí aparecerían en
// copy real. Se evita a propósito una lista larga de palabras cortas ('es',
// 'la', 'con'): matchean dentro de identificadores y código, y un guardián con
// falsos positivos se termina desactivando, que es peor que no tenerlo.
const DIACRITICS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/
const SPANISH_WORDS = new RegExp(
  '\\b(' + [
    'cargando', 'iniciar', 'sesion', 'contrasena', 'crear cuenta', 'ingresa',
    'revisa', 'enviando', 'conectando', 'terminos', 'privacidad',
    'olvidaste', 'aceptas', 'continuar con', 'verificando', 'volviste',
    'demasiados', 'intenta de nuevo', 'no pudimos', 'no existe', 'ese email',
    'tu control', 'para mejor', 'abrir en', 'tus datos', 'gratis', 'monedas',
    'patrimonio', 'acciones', 'efectivo', 'hecho para',
  ].join('|') + ')', 'i'
)

// Un literal es "código" y no copy cuando no puede llegar a la pantalla.
const CODE_LIKE = /^(use client|use server)$|^[a-z-]+\/[a-z-]|^\/|^#|^https?:|^[\w.-]+@[\w.-]+$/i

function visibleStrings(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const ast = parser.parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  })
  const out = []
  const push = (value, line) => {
    const v = String(value).trim()
    if (!v || CODE_LIKE.test(v)) return
    out.push({ value: v, line })
  }
  traverse(ast, {
    JSXText(p) { push(p.node.value, p.node.loc && p.node.loc.start.line) },
    StringLiteral(p) {
      // Rutas de import y valores de atributos que nunca se leen en pantalla.
      const parent = p.parent
      if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'CallExpression' && parent.callee && parent.callee.type === 'Import')) return
      if (parent && parent.type === 'JSXAttribute') {
        const name = parent.name && parent.name.name
        const INVISIBLE = ['className', 'style', 'href', 'src', 'rel', 'target', 'id', 'htmlFor', 'type', 'autoComplete', 'inputMode', 'role', 'viewBox', 'fill', 'd', 'mode', 'size', 'state', 'variant', 'as', 'tone']
        if (INVISIBLE.includes(name)) return
      }
      if (parent && parent.type === 'ObjectProperty' && parent.key && parent.key.name && /color|background|border|shadow|transform|width|height|font/i.test(parent.key.name)) return
      push(p.node.value, p.node.loc && p.node.loc.start.line)
    },
  })
  return out
}

describe('el embudo público habla UN solo idioma', () => {
  for (const file of PUBLIC_SURFACES) {
    test(`${file} no tiene copy en español`, () => {
      const hits = visibleStrings(file).filter(
        (s) => DIACRITICS.test(s.value) || SPANISH_WORDS.test(s.value)
      )
      const report = hits.map((h) => `  ${file}:${h.line}  ${JSON.stringify(h.value.slice(0, 70))}`).join('\n')
      expect(hits.length === 0 ? '' : `\nCopy en español en una pantalla pública:\n${report}\n`).toBe('')
    })
  }

  // El guardián solo vale si de verdad juzga algo: si el extractor se rompe y
  // devuelve vacío, los tests de arriba pasarían sin mirar nada.
  test('el extractor de verdad encuentra copy (si no, lo de arriba pasa vacío)', () => {
    const landing = visibleStrings('app/page.jsx').map((s) => s.value)
    expect(landing).toEqual(expect.arrayContaining(['Not just stocks.']))
    const login = visibleStrings('app/login/page.jsx').map((s) => s.value)
    expect(login).toEqual(expect.arrayContaining(['Continue with Google']))
    expect(landing.length).toBeGreaterThan(20)
    expect(login.length).toBeGreaterThan(15)
  })
})

describe('la pantalla de carga de la landing no contradice a la landing', () => {
  // La landing es de IDIOMA FIJO en inglés, y su único uso de `lang` es el
  // loader que la precede. Con el default 'es' del resto de la app, un
  // visitante nuevo (sin preferencia guardada) leía "Cargando tu portafolio"
  // justo antes de una página entera en inglés.
  const src = fs.readFileSync(path.join(ROOT, 'app/page.jsx'), 'utf8')
  const line = src.split('\n').find((l) => l.includes("const [lang]"))

  test('sin preferencia guardada, el loader de la landing sale en inglés', () => {
    expect(line).toBeTruthy()
    // Sin nada en localStorage el ternario tiene que caer del lado 'en'.
    expect(line).toMatch(/localStorage\.getItem\('chispudo-lang'\) === 'es' \? 'es' : 'en'/)
  })

  test('una preferencia explícita en español se sigue respetando', () => {
    expect(line).toContain("=== 'es' ? 'es'")
  })

  test('con lang en inglés, la copia del loader es inglesa', () => {
    const { defaultMessage, loadingSteps } = require('../../components/ui/ChispudoLoader')
    expect(defaultMessage('initial-loading', 'en')).toBe('Loading your portfolio')
    expect(loadingSteps('en').join(' ')).not.toMatch(DIACRITICS)
    // Y el lado español sigue existiendo: esto no borró el bilingüismo del loader.
    expect(defaultMessage('initial-loading', 'es')).toBe('Cargando tu portafolio')
  })
})
