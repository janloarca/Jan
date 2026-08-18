// Cómo escribe los números el estado de cuenta que tenemos enfrente.
//
// LatAm está partida en dos y ninguna de las dos mitades es rara:
//   punto decimal   → Guatemala, México, Perú, Costa Rica, Panamá, R. Dominicana
//   coma decimal    → Chile, Colombia, Argentina, Brasil, Uruguay, Paraguay, Bolivia
//
// Por qué esto es un módulo y no un detalle: el tokenizador de
// lib/parsers/guateCardStatements.js buscaba SOLO la forma con punto
// (`\d[\d,]*\.\d{2}`), y sobre una línea con coma decimal no falla ruidosamente,
// falla CALLADO y peor: en "SUPERMERCADO 1.234,56" encuentra "1.23" y lo entrega
// como un monto perfectamente válido. Mil veces menos, con cara de dato bueno.
// Hoy no muerde porque `detectCardStatement` devuelve null para todo lo que no
// sean los tres bancos guatemaltecos conocidos, así que un estado chileno cae al
// camino de IA; pero el día que alguien agregue un detector para otro país,
// TODAS sus filas entran mal sin que nada se queje.
//
// `parseAmount` (lib/numberParse.js) siempre supo leer las dos formas. El
// problema nunca estuvo ahí: estuvo en qué se le entrega.
//
// La convención se DEDUCE del documento, nunca del país: un archivo puede venir
// de un banco que imprime distinto de lo que su bandera sugiere, y la evidencia
// está impresa en el propio papel.

import { parseAmount } from '../numberParse'

// Evidencia INEQUÍVOCA: un número agrupado deja ver cuál separador es cuál sin
// ninguna ambigüedad posible. "1.234,56" solo se puede leer de una forma.
const STRONG_COMMA = /\d{1,3}(?:\.\d{3})+,\d{1,2}(?!\d)/g
const STRONG_DOT = /\d{1,3}(?:,\d{3})+\.\d{1,2}(?!\d)/g

// Evidencia DÉBIL: dos decimales al final de un número sin agrupar. "17,50" es
// casi siempre diecisiete cincuenta, pero "1,500" también podría ser mil
// quinientos, así que solo cuenta cuando no hay un tercer dígito detrás.
const WEAK_COMMA = /(?:^|[^\d.,])\d+,\d{2}(?![\d,])/g
const WEAK_DOT = /(?:^|[^\d.,])\d+\.\d{2}(?![\d.])/g

const countOf = (text, re) => (String(text || '').match(re) || []).length

/**
 * 'dot' | 'comma' | null (no hay evidencia suficiente para decidir).
 *
 * Null no es un fallo: es la respuesta honesta cuando el documento no dice lo
 * bastante, y el caller decide qué hacer con eso (los tres bancos ya conocidos
 * fijan su convención y no preguntan).
 */
export function detectNumberConvention(text) {
  const strongComma = countOf(text, STRONG_COMMA)
  const strongDot = countOf(text, STRONG_DOT)
  // Un solo número agrupado ya prueba la convención de todo el documento: un
  // estado de cuenta no mezcla las dos formas. Se pide margen por si un texto
  // arrastra una fecha o una referencia que se le parece.
  if (strongComma > strongDot) return 'comma'
  if (strongDot > strongComma) return 'dot'

  const weakComma = countOf(text, WEAK_COMMA)
  const weakDot = countOf(text, WEAK_DOT)
  // Sin agrupamiento hace falta más de un caso y una mayoría clara: con dos
  // señales empatadas cualquier respuesta sería un volado, y un volado acá
  // multiplica o divide por mil todos los montos del archivo.
  const total = weakComma + weakDot
  if (total < 3) return null
  if (weakComma >= weakDot * 2) return 'comma'
  if (weakDot >= weakComma * 2) return 'dot'
  return null
}

// Los dos tokenizadores. El de punto es LITERALMENTE el que ya vivía en
// guateCardStatements.js, con sus dos guardas aprendidas de estados reales:
//
//   - "\d[\d,]*\.\d{2}" y no "\d{1,3}(,...)*": un "1234.56" sin agrupar no
//     puede medio-matchear como "234.56".
//   - la forma pelada ".\d{2}" (Contecnica imprime ".00"/".06" en sus totales)
//     exige un espacio antes, o dispara dentro de direcciones y referencias
//     ("2C.20-83", "PAGO RECIBIDO...406") y la fila se descarta por traer
//     demasiados montos. Los dos casos salieron de estados de verdad.
//
// El de coma es su espejo exacto, para que un estado con coma decimal reciba el
// mismo trato y no uno de segunda.
const TOKEN_RE = {
  dot: /(?:^|\s)(\d[\d,]*\.\d{2}|\.\d{2})(-)?/g,
  comma: /(?:^|\s)(\d[\d.]*,\d{2}|,\d{2})(-)?/g,
}

/**
 * Todo monto de una línea, con su columna FINAL (los números van alineados a la
 * derecha, así que el final es lo que identifica la columna) y el menos final
 * que usa BAC.
 */
export function amountTokens(line, convention = 'dot') {
  const re = TOKEN_RE[convention] || TOKEN_RE.dot
  re.lastIndex = 0
  const out = []
  let m
  while ((m = re.exec(line)) !== null) {
    const value = parseAmount(m[1])
    if (!isFinite(value)) continue
    out.push({ value, negative: m[2] === '-', start: m.index, end: m.index + m[0].length })
  }
  return out
}

// Meses como los abrevian los bancos de la región, en español, portugués e
// inglés. Portugués entra porque Brasil es el mercado grande de la mitad con
// coma decimal, y sus tres abreviaturas propias (FEV, SET, OUT, DEZ) no
// coincidían con ninguna de las que ya había.
export const MONTHS = {
  ENE: 1, JAN: 1, FEB: 2, FEV: 2, MAR: 3, ABR: 4, APR: 4,
  MAY: 5, MAI: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8,
  SEP: 9, SEPT: 9, SET: 9, OCT: 10, OUT: 10, NOV: 11, DIC: 12, DEZ: 12, DEC: 12,
  // Nombres completos, que algunos estados imprimen sin abreviar.
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7,
  AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, MARÇO: 3, MAIO: 5, JUNHO: 6,
  JULHO: 7, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
}

export function monthFromName(name) {
  if (!name) return null
  const key = String(name).trim().toUpperCase().replace(/\.$/, '')
  return MONTHS[key] || null
}
