// FASE IE. El spreadsheet que viaja adjunto en el correo mensual: la matriz
// de enero al mes cubierto, armada del lado del servidor desde el MISMO caché
// que alimenta la pantalla del Spreadsheet (users/{uid}/itemSnapshots).
//
// Decisión de honestidad que define todo el módulo: ese caché lo puebla el
// CLIENTE al abrir el Spreadsheet, así que el servidor puede encontrarlo
// incompleto. Un mes sin doc queda EN BLANCO y el correo lo dice ("open the
// Spreadsheet in the app to fill it"), nunca se recalcula a medias en el
// servidor: la mitad de los motores de reconstrucción (precios históricos,
// buckets de IBKR, rebobinado de eventos) viven en el cliente, y una
// reimplementación parcial daría números distintos a los de la pantalla, que
// es la clase exacta de divergencia que costó el +1148% de los reportes.
//
// Reglas heredadas de PortfolioSpreadsheet.jsx (mismas, no parecidas):
//  - entradas huérfanas del caché (ids de items borrados) NO cuentan (FASE GN);
//  - el bucket sintético de IBKR solo cuenta si el portafolio TODAVÍA tiene
//    items _source:'ibkr' (FASE GN);
//  - los pasivos restan del TOTAL;
//  - el valor guardado está en la moneda base del momento del guardado
//    (_currency): se convierte a la base actual al leer, igual que el cliente.

import { getItemValue, getTypeCategory, isExcludedFromNetWorth, CATEGORY_LABELS, CATEGORY_ORDER } from '../components/dashboard/utils'

// Debe coincidir con lib/historicalValues.js EXACTAMENTE. No se importa de ahí
// porque ese archivo arrastra authFetch → Firebase Auth, que revienta bajo
// Jest (misma razón y mismo string que PortfolioSpreadsheet.jsx).
const IBKR_UNKNOWN_KEY_PREFIX = '__ibkr_unknown__'

// Las claves de mes de enero al mes de `refDate`, en su año.
export function monthKeysFor(refDate) {
  const y = refDate.getUTCFullYear()
  const m = refDate.getUTCMonth() + 1
  const monthKeys = []
  for (let i = 1; i <= m; i++) monthKeys.push(`${y}-${String(i).padStart(2, '0')}`)
  return { year: y, monthKeys, refMonthKey: monthKeys[monthKeys.length - 1] }
}

function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

function round2(v) {
  return Math.round(v * 100) / 100
}

/**
 * Arma la matriz (array de arrays, lista para XLSX/CSV) desde el caché.
 *
 * @param {object[]} items      items ENRIQUECIDOS (valores ya en base)
 * @param {object}   monthDocs  { [mk]: { items: {...}, currency } } (solo meses presentes)
 * @param {string[]} monthKeys  columnas, en orden
 * @param {string}   liveMonthKey  mes cuya columna sale de los valores EN VIVO
 *                   (el mes cubierto cuando su doc no existe todavía: recién
 *                   cerrado, el valor de hoy es su mejor aproximación y es la
 *                   misma regla del cliente para el mes en curso)
 * @returns {{ rows: any[][], missingMonths: string[], totals: Object }}
 */
export function buildSpreadsheetRows({ items, monthDocs = {}, monthKeys = [], liveMonthKey = null, baseCurrency = 'USD', convert = null }) {
  const list = (items || []).filter((it) => it && it.id)
  const hasIbkrItems = list.some((it) => it._source === 'ibkr')

  // Valores por mes convertidos a la base ACTUAL (el doc guarda en la base del
  // momento del guardado; si el usuario cambió de moneda, sin esto la misma
  // fila mezclaría dos monedas sin avisar, FASE HV5 del lado del cliente).
  const histFor = (mk) => {
    const doc = monthDocs[mk]
    if (!doc || !doc.items) return null
    const savedCur = doc.currency
    if (!savedCur || savedCur === baseCurrency || !convert) return doc.items
    return Object.fromEntries(Object.entries(doc.items).map(([id, v]) => [
      id, { ...v, value: convert(v.value, savedCur, baseCurrency) },
    ]))
  }
  const hist = Object.fromEntries(monthKeys.map((mk) => [mk, histFor(mk)]))

  const missingMonths = monthKeys.filter((mk) => !hist[mk] && mk !== liveMonthKey)

  // Agrupado espejo del cliente: categoría (orden compartido) → institución.
  const catMap = new Map()
  for (const it of list) {
    const cat = getTypeCategory(it)
    if (!catMap.has(cat)) catMap.set(cat, new Map())
    const inst = it.institution || 'No institution'
    const attrs = catMap.get(cat)
    if (!attrs.has(inst)) attrs.set(inst, [])
    attrs.get(inst).push(it)
  }

  const header = ['Category', 'Asset', ...monthKeys.map(monthLabel)]
  const rows = [header]
  const totals = Object.fromEntries(monthKeys.map((mk) => [mk, null]))
  const add = (mk, v) => { totals[mk] = (totals[mk] || 0) + v }

  for (const catKey of CATEGORY_ORDER) {
    const insts = catMap.get(catKey)
    if (!insts) continue
    const label = CATEGORY_LABELS[catKey]?.en || catKey
    for (const [instName, instItems] of insts) {
      for (const it of instItems) {
        // Ojo con el signo: getItemValue ya devuelve NEGATIVO para una deuda,
        // pero el caché histórico guarda magnitudes positivas y es el LECTOR
        // quien re-aplica el signo (la misma asimetría que monthlyTotals del
        // cliente maneja con `(it.isDebt ? -1 : 1) * value`).
        const cells = monthKeys.map((mk) => {
          if (mk === liveMonthKey && !hist[mk]) {
            const v = round2(getItemValue(it))
            if (!isExcludedFromNetWorth(it)) add(mk, v)
            return v
          }
          const v = hist[mk]?.[it.id]?.value
          if (v == null) return null
          add(mk, (it.isDebt ? -1 : 1) * v)
          return round2(v)
        })
        rows.push([label, it.symbol || it.name || '', ...cells])
      }
      // El bucket sintético de IBKR (FASE FH): la MISMA clave que escribe
      // lib/historicalValues.js, contada solo si el broker sigue conectado.
      const bucketKey = `${IBKR_UNKNOWN_KEY_PREFIX}${instName}__${catKey}`
      const bucketCells = monthKeys.map((mk) => {
        const v = hist[mk]?.[bucketKey]?.value
        if (v == null) return null
        if (hasIbkrItems) add(mk, v)
        return round2(v)
      })
      if (hasIbkrItems && bucketCells.some((c) => c != null)) {
        rows.push([label, 'Unidentified positions', ...bucketCells])
      }
    }
  }

  rows.push(['TOTAL', '', ...monthKeys.map((mk) => (totals[mk] != null ? round2(totals[mk]) : null))])
  if (missingMonths.length > 0) {
    rows.push([])
    rows.push([`Months without data (${missingMonths.map(monthLabel).join(', ')}): open the Spreadsheet in the app once and they fill in on their own.`])
  }
  return { rows, missingMonths, totals }
}

// El workbook real, como Buffer para adjuntarlo. Import dinámico de xlsx por
// la misma razón que el cliente: solo quien de verdad genera el archivo paga
// la dependencia.
export async function renderSpreadsheetXlsx({ rows, year }) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 18 }, { wch: 22 }, ...rows[0].slice(2).map(() => ({ wch: 12 }))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Matrix ${year}`)
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  return { buffer, filename: `chispudo-spreadsheet-${year}.xlsx` }
}
