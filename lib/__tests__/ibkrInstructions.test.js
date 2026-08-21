import fs from 'fs'
import path from 'path'
import { getBrokerHowTo } from '../brokerHowTo'

// ⛔ FASE KE. Guardián de las instrucciones de IBKR.
//
// Estos no son tests de estilo: cada uno fija un defecto que YA mandó a un
// usuario a un callejón sin salida. Lo que tienen en común es que la app se
// contradecía a sí misma en archivos distintos, que es la misma enfermedad de
// las dos copias que este repo ya documenta para el código.
//
// Se lee el ARCHIVO, no una copia de las cadenas: con su propia lista se podría
// cambiar el copy y seguir en verde, que es exactamente lo que esto existe para
// impedir.

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const ibkr = getBrokerHowTo('ibkr')
const details = (steps) => (steps || []).flatMap((s) => [s.detail?.es || '', s.detail?.en || '', s.es || '', s.en || ''])

describe('el formato XML se pide en la ruta de API', () => {
  // El Flex Web Service devuelve el formato que la query tenga GUARDADA. Con
  // CSV, la respuesta no matchea ninguna de las ramas del route y el cliente
  // sondea hasta agotar su presupuesto: TIMEOUT sin una sola pista de que el
  // problema era el formato. El paso de XML existía solo en el bloque csv.
  it('lo nombra en español Y en inglés, no solo en uno', () => {
    const esText = (ibkr.api.steps || []).map((s) => `${s.es} ${s.detail?.es || ''}`).join(' ')
    const enText = (ibkr.api.steps || []).map((s) => `${s.en} ${s.detail?.en || ''}`).join(' ')
    expect(esText).toMatch(/XML/)
    expect(enText).toMatch(/XML/)
  })
})

describe('"Select All" en los CAMPOS de cada sección', () => {
  // Agregar la sección no incluye sus columnas: una sección con filas y sin los
  // campos que leemos llega vacía, y el desglose forense lo reporta como
  // "N filas, 0 importado", que el propio código lee como bug NUESTRO.
  it('lo dicen los dos caminos, archivo y API, en los dos idiomas', () => {
    for (const block of ['csv', 'api']) {
      const esText = (ibkr[block].steps || []).map((s) => `${s.es} ${s.detail?.es || ''}`).join(' ')
      const enText = (ibkr[block].steps || []).map((s) => `${s.en} ${s.detail?.en || ''}`).join(' ')
      expect(esText).toMatch(/Select All/)
      expect(enText).toMatch(/Select All/)
    }
  })
})

describe('un solo período para un Flex Query, en toda la app', () => {
  // El defecto: TRES superficies le decían al usuario que pusiera el período en
  // "Year to Date" mientras la instrucción principal pide "Last 365 Calendar
  // Days". Y en enero YTD son días, así que seguir ese consejo ACORTA el
  // historial, que es lo contrario de lo que esos avisos piden.
  //
  // "Year to Date" sí es legítimo para un Activity STATEMENT (ahí es un rango
  // cualquiera), así que el guardián no prohíbe el texto: prohíbe que aparezca
  // en la MISMA línea que "Flex Query".
  const FILES = ['components/IBKRSyncModal.jsx', 'app/dashboard/page.jsx', 'lib/brokerHowTo.js']

  it('ninguna línea le pide a un Flex Query el período "Year to Date"', () => {
    const offenders = []
    for (const rel of FILES) {
      read(rel).split('\n').forEach((line, i) => {
        if (line.includes('Year to Date') && /Flex Query/i.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('el período que las instrucciones piden sigue siendo el mismo texto', () => {
    const all = details(ibkr.api.steps).join(' ')
    expect(all).toMatch(/Last 365 Calendar Days/)
  })
})

describe('el Activity Statement no se ofrece como fuente del valor diario', () => {
  // Las instrucciones dicen "no uses Statements → Activity: ese formato no trae
  // el valor diario de la cuenta", y el rescate del NAV faltante ofrecía ese
  // mismo reporte diciendo que "trae el historial de valor". Además el parser
  // de statements necesita una tabla de NAV con columna de fecha que ese
  // reporte no tiene. El usuario bajaba el Excel y el historial seguía vacío.
  it('las instrucciones siguen desaconsejándolo', () => {
    const all = details(ibkr.csv.steps).join(' ')
    expect(all).toMatch(/no trae el valor diario|no daily account value/i)
  })

  it('el rescate ya no promete que trae el historial de valor', () => {
    const src = read('components/IBKRSyncModal.jsx')
    expect(src).not.toMatch(/Activity Statement \(XLS\): trae el historial de valor/)
    expect(src).not.toMatch(/Activity Statement \(XLS\): it carries the value history/)
  })
})
