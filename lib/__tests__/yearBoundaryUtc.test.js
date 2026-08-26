/**
 * @jest-environment node
 */
// ⛔ LA FRONTERA DE UN AÑO SE CORTA EN UTC, EN TODOS ESTOS MODULOS.
//
// EL BUG. Habia TRES convenciones para una sola tarjeta: `ytdInvested.js` usaba
// `Date.UTC(y,0,1)`, `calendarYearGain` usaba `new Date(year,0,1)` (LOCAL), y
// `investedByYear.js` mezclaba las dos, leyendo una fecha de transaccion con
// `getUTCFullYear()` y un ts de serie con `getFullYear()` en lineas contiguas.
// En Guatemala (UTC-6) eso son seis horas: un movimiento del 1 de enero puede
// contarse como "invertido" de un año y netearse en el Dietz del otro, y las
// dos mitades de la MISMA tarjeta miden años distintos.
//
// POR QUE UTC ES LA CONVENCION CORRECTA, y no una preferencia:
//  · los `ts` de la serie salen de `Date.parse('YYYY-MM-DD')` (buildReportSeries),
//    o sea medianoche UTC;
//  · las fechas de transaccion son cadenas 'YYYY-MM-DD', que la cabecera de
//    lib/financeMonth.js ya prohibe leer en local ("en Guatemala getDate()
//    devuelve el dia ANTERIOR");
//  · `reportData.js` corre tambien en el SERVIDOR (correos, link compartido),
//    asi que con la convencion local el año de un usuario lo decidiria la zona
//    horaria del datacenter.
//
// ⛔ POR QUE ES UN GUARDIAN DE FUENTE Y NO UN TEST DE COMPORTAMIENTO. Cuando
// se escribio, `jest` no fijaba `TZ`, asi que con el runner en UTC
// `getFullYear()` y `getUTCFullYear()` devolvian lo MISMO y ningun test de
// valores podia notar la diferencia.
//
// ACTUALIZACION (FASE LF): `jest.config.js` ahora fija la suite en
// America/Guatemala justamente por eso, y el guardian de COMPORTAMIENTO vive
// en `lib/__tests__/calendarYearTz.test.js`. Los dos siguen haciendo falta y
// no se solapan: este caza el PATRON en la lista de modulos que clasifican por
// año (incluso en un modulo que hoy no tenga tests de valores), y el otro caza
// la CONSECUENCIA (que es lo unico que atrapa un desajuste en un archivo que
// esta lista no contemple). Borrar uno no deja cubierto lo del otro. Peor: el fixture de
// `investedByYear.test.js` construye su serie con timestamps LOCALES a
// proposito, o sea nunca corre el desajuste que corre produccion. Leer la
// fuente es lo unico que no depende de la zona del runner.

const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')

// Los modulos que deciden a que año pertenece un dato. No es todo el repo a
// proposito: una fecha que se MUESTRA se formatea en la zona del usuario y eso
// esta bien (formatDate ya lo maneja). Lo que no puede ser local es la
// frontera con la que se CLASIFICA.
const GUARDED = [
  'lib/ytdInvested.js',
  'lib/investedByYear.js',
  'lib/reportData.js',
]

// Leer un componente de fecha en la zona del runner. `getFullYear` es el que
// muerde en la frontera del año; los otros dos se prohiben por la misma razon
// (un mes y un dia clasificados en local tienen el mismo desfase).
const LOCAL_GETTERS = new Set(['getFullYear', 'getMonth', 'getDate'])

function offendersIn(rel) {
  const file = path.join(ROOT, rel)
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  })
  const found = []
  traverse(ast, {
    // `new Date(2026, 0, 1)` — un constructor con MAS de un argumento arma la
    // fecha en la zona local. Con un solo argumento (un ts, o una cadena ISO)
    // no hay frontera que construir.
    NewExpression(p) {
      const c = p.node.callee
      if (c.type !== 'Identifier' || c.name !== 'Date') return
      if ((p.node.arguments || []).length < 2) return
      found.push(`${rel}:${p.node.loc.start.line} new Date(...) con componentes locales; usa Date.UTC(...)`)
    },
    MemberExpression(p) {
      const prop = p.node.property
      if (p.node.computed || prop.type !== 'Identifier') return
      if (!LOCAL_GETTERS.has(prop.name)) return
      // Solo cuando de verdad se llama: `getFullYear` suelto (en un comentario
      // no llega acá, pero sí una referencia en un objeto) no clasifica nada.
      if (p.parent.type !== 'CallExpression' || p.parent.callee !== p.node) return
      found.push(`${rel}:${p.node.loc.start.line} .${prop.name}() lee en la zona del runner; usa .getUTC${prop.name.slice(3)}()`)
    },
  })
  return found
}

describe('la frontera del año se corta en UTC', () => {
  test('ningun modulo de clasificacion por año lee la fecha en local', () => {
    const problems = GUARDED.flatMap(offendersIn)
    expect(problems).toEqual([])
  })

  // Sin esto, debilitar el walk (un archivo que se dejo de recorrer, un parser
  // que revienta y se traga) dejaria el primero en verde para siempre sin estar
  // juzgando nada. Leccion de FASE JB3.
  test('el walk de verdad esta leyendo esos archivos', () => {
    for (const rel of GUARDED) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src.length).toBeGreaterThan(500)
      // Y que la convencion correcta este de verdad presente en cada uno.
      expect(/Date\.UTC\(|getUTCFullYear\(/.test(src)).toBe(true)
    }
  })

  test('atrapa las dos formas contra un fixture', () => {
    const tmp = path.join(require('os').tmpdir(), `year-boundary-${process.pid}.js`)
    fs.writeFileSync(tmp, `
      export function f(ts, year) {
        const a = new Date(year, 0, 1).getTime()
        const b = new Date(ts).getFullYear()
        return a + b
      }
    `)
    try {
      const rel = path.relative(ROOT, tmp)
      const found = offendersIn(rel)
      expect(found).toHaveLength(2)
      expect(found.join(' ')).toMatch(/Date\.UTC/)
      expect(found.join(' ')).toMatch(/getUTCFullYear/)
    } finally { fs.unlinkSync(tmp) }
  })

  test('la convencion correcta pasa', () => {
    const tmp = path.join(require('os').tmpdir(), `year-boundary-ok-${process.pid}.js`)
    fs.writeFileSync(tmp, `
      export function f(ts, year) {
        return Date.UTC(year, 0, 1) + new Date(ts).getUTCFullYear() + new Date(ts).getTime()
      }
    `)
    try {
      expect(offendersIn(path.relative(ROOT, tmp))).toEqual([])
    } finally { fs.unlinkSync(tmp) }
  })
})
