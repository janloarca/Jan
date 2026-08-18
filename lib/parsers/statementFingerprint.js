// Qué es este PDF que no reconocemos.
//
// Hoy un estado de cuenta de un banco no soportado cae al camino de IA sin decir
// nada. Funciona, pero deja al usuario sin saber si el archivo estaba mal o si
// simplemente no conocemos su banco, y me deja a mí sin la única información que
// hace falta para escribir el parser: cómo imprime ESE banco.
//
// Los tres parsers guatemaltecos que ya existen se escribieron mirando estados
// reales. Este módulo no intenta reemplazar eso adivinando: describe lo que ve
// para que el siguiente parser se escriba con evidencia y no con imaginación.
// Es la misma lección del botón "Reparar ahora": cuando algo cae en silencio,
// hacerlo visible ahorra las rondas de diagnóstico, no el arreglo.
//
// A propósito NO extrae movimientos. Un lector genérico que se equivoca sobre
// dinero es peor que uno que no existe, y la vara para aceptar una lectura en
// este repo es reconciliar contra los totales que el propio estado imprime.

import { detectNumberConvention } from './latamNumbers'
import { CURRENCY_CODES } from '../numberParse'

// Palabras que casi solo aparecen en un estado de cuenta de tarjeta, en los tres
// idiomas de la región. No alcanza ninguna sola: se piden dos, para que un
// recibo o un correo impreso no cuente como estado.
const STATEMENT_WORDS = [
  /\bestado de cuenta\b/i, /\bfecha de corte\b/i, /\bpago m[ií]nimo\b/i,
  /\bsaldo anterior\b/i, /\bl[ií]mite de cr[eé]dito\b/i, /\bfecha l[ií]mite\b/i,
  /\bmovimientos\b/i, /\bconsumos\b/i, /\btarjeta de cr[eé]dito\b/i,
  /\bfatura\b/i, /\bvencimento\b/i, /\bcart[aã]o de cr[eé]dito\b/i, /\blan[çc]amentos\b/i,
  /\bstatement\b/i, /\bminimum payment\b/i, /\bclosing date\b/i,
]

// Emisores conocidos en la región. Reconocer el nombre NO significa saber leer
// su formato: es un dato para el reporte, nunca una licencia para parsear.
const ISSUERS = [
  [/bac\s*credomatic|baccredomatic/i, 'BAC Credomatic'],
  [/banco industrial|contecnica/i, 'Banco Industrial'],
  [/g\s*&\s*t\s*continental/i, 'G&T Continental'],
  [/bancolombia/i, 'Bancolombia'], [/davivienda/i, 'Davivienda'],
  [/banco de bogot[aá]/i, 'Banco de Bogotá'], [/\bbbva\b/i, 'BBVA'],
  [/santander/i, 'Santander'], [/banorte/i, 'Banorte'], [/citibanamex|banamex/i, 'Citibanamex'],
  [/scotiabank/i, 'Scotiabank'], [/banco de chile/i, 'Banco de Chile'],
  [/banco estado|bancoestado/i, 'BancoEstado'], [/banco falabella/i, 'Banco Falabella'],
  [/itau|ita[uú]/i, 'Itaú'], [/bradesco/i, 'Bradesco'], [/nubank|nu pagamentos/i, 'Nubank'],
  [/banco naci[oó]n|banco de la naci[oó]n/i, 'Banco Nación'], [/galicia/i, 'Banco Galicia'],
  [/interbank/i, 'Interbank'], [/bcp\b|banco de cr[eé]dito del per[uú]/i, 'BCP'],
  [/banco popular/i, 'Banco Popular'], [/banreservas/i, 'Banreservas'],
  [/banco general/i, 'Banco General'], [/promerica/i, 'Promérica'],
  [/ficohsa/i, 'Ficohsa'], [/banco atl[aá]ntida/i, 'Banco Atlántida'],
  [/lafise/i, 'LAFISE'], [/banco nacional de costa rica|\bbncr\b/i, 'Banco Nacional de Costa Rica'],
]

// Una fila de movimiento empieza con una fecha. Se aceptan las formas que usan
// los estados de la región, incluida la de mes primero sin año que imprime BAC.
const DATE_ROW = /^\s*(\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-zÁÉÍÓÚáéíóúÇç]{3,10}[/-]\d{1,2})\b/

// Una línea de total, en los tres idiomas. Su presencia es lo que decide si un
// parser futuro va a poder reconciliar, que es el requisito para aceptarlo.
const TOTAL_LINE = /\b(total(?:es)?|saldo (?:actual|al corte|a la fecha)|sub-?total|d[eé]bitos|cr[eé]ditos|cargos|abonos|valor total)\b/i

const CARD_LAST4 = [
  /(?:terminada|terminaci[oó]n|final(?:izada)?|ending|final)\s*(?:en|in|with)?\s*[:\-]?\s*[*x]{0,4}\s*(\d{4})\b/i,
  /[*x]{4,}\s*(\d{4})\b/i,
]

const count = (lines, re) => lines.filter((l) => re.test(l)).length

/**
 * Describe un PDF que el camino determinístico no reconoció.
 *
 * Todo lo que devuelve es OBSERVACIÓN, nunca interpretación de montos: cuántas
 * filas parecen movimientos, en qué convención están escritos los números, qué
 * monedas aparecen y si el documento imprime sus propios totales.
 */
export function fingerprintStatement(text) {
  const raw = String(text || '')
  const lines = raw.split(/\r?\n/)

  const words = STATEMENT_WORDS.filter((re) => re.test(raw)).length
  const dateRows = count(lines, DATE_ROW)
  // Dos señales de vocabulario Y filas con forma de movimiento. Cualquiera de
  // las dos sola deja pasar demasiado: un correo impreso tiene fechas, y un
  // contrato de tarjeta tiene el vocabulario.
  const looksLikeStatement = words >= 2 && dateRows >= 5

  const issuers = ISSUERS.filter(([re]) => re.test(raw)).map(([, name]) => name)
  const currencies = CURRENCY_CODES.filter((c) => new RegExp(`\\b${c}\\b`).test(raw))

  const last4 = (() => {
    for (const re of CARD_LAST4) {
      const m = raw.match(re)
      if (m) return m[1]
    }
    return null
  })()

  return {
    looksLikeStatement,
    // Cuántas de las palabras de vocabulario aparecieron: separa "esto es
    // claramente un estado" de "esto tiene fechas y ya".
    statementWords: words,
    issuers,
    convention: detectNumberConvention(raw),
    currencies,
    last4,
    dateRows,
    totalLines: count(lines, TOTAL_LINE),
    pages: raw.split('\f').length,
  }
}

/**
 * El reporte en una línea, para pegar en un mensaje. Sin nombre, sin dirección,
 * sin número de tarjeta completo y sin un solo monto: describe la FORMA del
 * documento, no su contenido, porque el contenido es de quien lo recibió.
 */
export function describeFingerprint(fp, lang = 'es') {
  if (!fp) return ''
  const es = lang === 'es'
  const parts = [
    `${fp.pages} ${es ? 'página(s)' : 'page(s)'}`,
    `${fp.dateRows} ${es ? 'fila(s) con fecha' : 'dated rows'}`,
    `${fp.totalLines} ${es ? 'línea(s) de total' : 'total lines'}`,
    `${es ? 'números' : 'numbers'}: ${fp.convention === 'comma' ? '1.234,56' : fp.convention === 'dot' ? '1,234.56' : es ? 'sin determinar' : 'undetermined'}`,
  ]
  if (fp.currencies.length) parts.push(`${es ? 'monedas' : 'currencies'}: ${fp.currencies.join(', ')}`)
  if (fp.issuers.length) parts.push(`${es ? 'emisor' : 'issuer'}: ${fp.issuers.join(', ')}`)
  if (fp.last4) parts.push(`${es ? 'tarjeta' : 'card'}: ••${fp.last4}`)
  return parts.join(' · ')
}
