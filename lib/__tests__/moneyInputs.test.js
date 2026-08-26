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
})
