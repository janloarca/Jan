import fs from 'fs'
import path from 'path'
import { parseAmount } from '../numberParse'

// ⛔ Las pantallas que mueven dinero entre cuentas no pueden volver a leer un
// monto con `parseFloat` ni a pedirlo con `<input type="number">`.
//
// Las dos mitades son el MISMO bug visto de dos lados, y los dos ya le pasaron
// a un usuario real:
//
//   · `type="number"` devuelve '' ante lo que no puede parsear, y con teclado
//     en español el separador decimal es COMA, así que el campo se VACÍA tecla
//     por tecla (FASE KV: "BTC no me dejaba poner 0.0001").
//   · `parseFloat('12.500')` devuelve 12.5, o sea mil veces menos, EN SILENCIO
//     (FASE JA: "teclear 12.500,00 guardaba 12.5 con el banner verde").
//
// `parseAmount` (lib/numberParse.js) entiende las dos convenciones y existe
// justamente para esto. El guardián lee los ARCHIVOS, nunca una copia de sus
// cadenas, para que no pueda quedarse atrás.
//
// ALCANCE: solo las dos pantallas de transferencia. Quedan ~44 `type="number"`
// más en otras 18 pantallas (metas, alertas de precio, comparador, calibración,
// perfil financiero...), medidos y NO tocados: barrerlos es su propio trabajo y
// varios no son montos de dinero. Cuando se barran, ensanchar esta lista.
const GUARDED = ['components/TransferModal.jsx', 'components/CashFlowModal.jsx']

// Pantallas que TAMBIEN archivan dinero tecleado a mano pero que tienen un
// `type="number"` legitimo (un entero acotado, no un monto). Ahi la regla del
// input la aplica moneyInputConvention.test.js, que barre el repo entero y
// permite `type="number"` junto a `inputMode="numeric"`; lo que se exige aqui
// es solo la mitad del LECTOR.
//
// QuarterlyHistoryModal normalizaba a mano y leia "9.919,38" como 9.91938: mil
// veces menos, sin error, y archivado como 'ibkr_quarterly', que supera a
// nuestras reconstrucciones. Es la pantalla donde se teclean catorce cifras
// seguidas, o sea la de mayor costo por error.
const PARSE_ONLY = ['components/dashboard/QuarterlyHistoryModal.jsx']

// Un `type="number"` DENTRO de un comentario es solo la explicación de por qué
// no se usa: se descartan los comentarios antes de juzgar.
const stripComments = (src) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('las pantallas que mueven dinero leen los montos con parseAmount', () => {
  for (const rel of GUARDED) {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))

    it(`${rel} no pide un monto con type="number"`, () => {
      expect(src).not.toMatch(/type="number"/)
    })

    it(`${rel} no lee ningún monto con parseFloat`, () => {
      expect(src).not.toMatch(/parseFloat\(/)
    })

    it(`${rel} importa parseAmount`, () => {
      expect(src).toMatch(/from '@\/lib\/numberParse'/)
    })
  }

  for (const rel of PARSE_ONLY) {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))

    it(`${rel} no lee ningún monto con parseFloat`, () => {
      expect(src).not.toMatch(/parseFloat\(/)
    })

    it(`${rel} importa parseAmount`, () => {
      expect(src).toMatch(/from '@\/lib\/numberParse'/)
    })
  }
})

// El comportamiento concreto que los tres tests de arriba protegen, para que
// quede claro qué se pierde si alguien los debilita.
describe('por qué importa', () => {
  it('la convención LatAm: 12.500 son doce mil quinientos, no 12.5', () => {
    expect(parseFloat('12.500')).toBe(12.5)
    expect(parseAmount('12.500')).toBe(12500)
  })

  it('una coma decimal se lee, no se pierde', () => {
    expect(parseFloat('0,5')).toBe(0)
    expect(parseAmount('0,5')).toBe(0.5)
  })

  it('la forma US sigue funcionando igual', () => {
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56, 6)
    expect(parseAmount('2500')).toBe(2500)
  })

  it('un NAV trimestral en formato LatAm: 9.919,38 son casi diez mil', () => {
    // La normalizacion a mano que vivia en QuarterlyHistoryModal daba 9.91938.
    expect(parseAmount('9.919,38')).toBeCloseTo(9919.38, 6)
    expect(parseAmount('130.450,00')).toBeCloseTo(130450, 6)
  })
})
