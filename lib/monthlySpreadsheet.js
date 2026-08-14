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
export function buildSpreadsheetRows(args) {
  const model = buildSpreadsheetModel(args)
  const rows = [['Category', 'Asset', ...model.monthKeys.map(monthLabel)]]
  for (const cat of model.categories) {
    for (const inst of cat.institutions) {
      for (const it of inst.items) rows.push([cat.label, it.name, ...it.values])
    }
  }
  rows.push(['TOTAL', '', ...model.totals])
  if (model.missingMonths.length > 0) {
    rows.push([])
    rows.push([`Months without data (${model.missingMonths.map(monthLabel).join(', ')}): open the Spreadsheet in the app once and they fill in on their own.`])
  }
  return { rows, missingMonths: model.missingMonths, totals: model.totals, model }
}

/**
 * El MODELO: categorías → instituciones → activos, con subtotal por categoría
 * y total general, cada uno por mes. Es la misma forma que la pantalla del
 * Spreadsheet presenta (FASE IE4), y de aquí salen tanto las filas planas
 * como el workbook con estilo: una sola pasada de reglas, nunca dos.
 */
export function buildSpreadsheetModel({ items, monthDocs = {}, monthKeys = [], liveMonthKey = null, baseCurrency = 'USD', convert = null }) {
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

  const totals = Object.fromEntries(monthKeys.map((mk) => [mk, null]))
  const add = (mk, v) => { totals[mk] = (totals[mk] || 0) + v }
  // Un subtotal solo existe si ALGUNA fila aportó ese mes: sin esto, un mes
  // sin dato imprimiría 0.00 y se leería como "esa categoría valía cero".
  const emptyAcc = () => Object.fromEntries(monthKeys.map((mk) => [mk, null]))

  const categories = []
  for (const catKey of CATEGORY_ORDER) {
    const insts = catMap.get(catKey)
    if (!insts) continue
    const label = CATEGORY_LABELS[catKey]?.en || catKey
    const catAcc = emptyAcc()
    const institutions = []

    for (const [instName, instItems] of insts) {
      const rows = []
      for (const it of instItems) {
        // Ojo con el signo: getItemValue ya devuelve NEGATIVO para una deuda,
        // pero el caché histórico guarda magnitudes positivas y es el LECTOR
        // quien re-aplica el signo (la misma asimetría que monthlyTotals del
        // cliente maneja con `(it.isDebt ? -1 : 1) * value`).
        const values = monthKeys.map((mk) => {
          if (mk === liveMonthKey && !hist[mk]) {
            const v = round2(getItemValue(it))
            if (!isExcludedFromNetWorth(it)) add(mk, v)
            catAcc[mk] = (catAcc[mk] || 0) + v
            return v
          }
          const v = hist[mk]?.[it.id]?.value
          if (v == null) return null
          const signed = (it.isDebt ? -1 : 1) * v
          add(mk, signed)
          catAcc[mk] = (catAcc[mk] || 0) + signed
          // La fila muestra el MISMO signo que aporta al subtotal: el caché
          // guarda la deuda como magnitud positiva, y mostrarla así dejaba una
          // fila de 800.00 bajo un subtotal de (800.00), o sea un subtotal que
          // no cuadra con lo que se ve. En vivo ya venía firmada (getItemValue
          // devuelve negativo), así que además las dos ramas coinciden.
          return round2(signed)
        })
        rows.push({ name: it.symbol || it.name || '', values, isDebt: !!it.isDebt })
      }

      // El bucket sintético de IBKR (FASE FH): la MISMA clave que escribe
      // lib/historicalValues.js, contada solo si el broker sigue conectado.
      const bucketKey = `${IBKR_UNKNOWN_KEY_PREFIX}${instName}__${catKey}`
      const bucketValues = monthKeys.map((mk) => {
        const v = hist[mk]?.[bucketKey]?.value
        if (v == null) return null
        if (hasIbkrItems) { add(mk, v); catAcc[mk] = (catAcc[mk] || 0) + v }
        return round2(v)
      })
      if (hasIbkrItems && bucketValues.some((c) => c != null)) {
        rows.push({ name: 'Unidentified positions', values: bucketValues, synthetic: true })
      }

      if (rows.length > 0) institutions.push({ name: instName, items: rows })
    }

    if (institutions.length > 0) {
      categories.push({
        key: catKey,
        label,
        institutions,
        subtotals: monthKeys.map((mk) => (catAcc[mk] != null ? round2(catAcc[mk]) : null)),
      })
    }
  }

  return {
    monthKeys,
    monthLabels: monthKeys.map(monthLabel),
    categories,
    totals: monthKeys.map((mk) => (totals[mk] != null ? round2(totals[mk]) : null)),
    missingMonths,
    baseCurrency,
    liveMonthKey,
  }
}

// ── El workbook con formato (FASE IE4) ────────────────────────────────────
//
// Por qué ExcelJS y no la librería `xlsx` que el resto del repo ya usa: la
// edición community de SheetJS IGNORA los estilos de celda al escribir (son
// función de la versión de pago), así que con ella el adjunto solo podía ser
// una rejilla de números crudos, que es exactamente lo que el usuario mostró.
// ExcelJS sí los escribe. Se importa dinámico y SOLO aquí (servidor): la
// pantalla del Spreadsheet y su botón de descarga NO se tocan.
//
// Paleta: la misma familia sobria del reporte impreso (FASE FK) y de los
// correos. Un solo azul de acento y grises; el color marca JERARQUÍA (qué es
// encabezado, qué es subtotal, qué es total), nunca decora ni califica un
// número, que es la convención de estado de cuenta que este repo ya fijó.
const INK = 'FF111827'
const HEADER_BG = 'FF1F2937'
const CAT_BG = 'FFF3F4F6'
const TOTAL_BG = 'FFE8EDF5'
const ACCENT = 'FF2563EB'
const MUTED = 'FF6B7280'
const GRID = 'FFE5E7EB'

// Contabilidad: negativos entre paréntesis (la convención del reporte
// impreso), y un guion para el cero exacto.
const NUM_FMT = '#,##0.00;(#,##0.00);"-"'

function monthRangeLabel(model) {
  const l = model.monthLabels
  if (l.length === 0) return ''
  return l.length === 1 ? l[0] : `${l[0]} - ${l[l.length - 1]}`
}

export async function renderSpreadsheetXlsx({ model, year }) {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Chispudo'
  wb.created = new Date(Date.UTC(year, 0, 1))
  const ws = wb.addWorksheet(`Portfolio ${year}`, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
  })

  const nCols = 2 + model.monthKeys.length
  const colLetter = (n) => {
    let s = ''
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
    return s
  }
  const lastCol = colLetter(nCols)

  ws.columns = [
    { width: 18 }, { width: 34 },
    ...model.monthKeys.map(() => ({ width: 13 })),
  ]

  // ── Título ──
  ws.mergeCells(`A1:${lastCol}1`)
  const t = ws.getCell('A1')
  t.value = 'Portfolio Spreadsheet'
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: INK } }
  ws.getRow(1).height = 24

  ws.mergeCells(`A2:${lastCol}2`)
  const sub = ws.getCell('A2')
  sub.value = `${monthRangeLabel(model)} ${year}  ·  Values in ${model.baseCurrency || 'USD'}`
  sub.font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
  ws.getRow(2).height = 16

  // Franja de acento: la misma señal de marca que el correo, sin colorear
  // ningún dato.
  ws.mergeCells(`A3:${lastCol}3`)
  ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
  ws.getRow(3).height = 3

  // ── Encabezado ──
  // El mes en curso se nombra, no se colorea: la pantalla lo marca con un
  // tinte, pero en una hoja que alguien va a filtrar y ordenar un rótulo
  // sobrevive a todo y un fondo no.
  const headLabels = model.monthLabels.map((l, i) =>
    model.monthKeys[i] === model.liveMonthKey ? `${l} (current)` : l)
  const head = ws.addRow(['Category', 'Asset', ...headLabels])
  head.height = 22
  head.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'right' }
  })

  const styleValueRow = (row, { bold = false, fill = null, italic = false, color = INK }) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: 'Calibri', size: 10.5, bold, italic, color: { argb: color } }
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.border = { bottom: { style: 'thin', color: { argb: GRID } } }
      if (col > 2) {
        cell.numFmt = NUM_FMT
        cell.alignment = { horizontal: 'right' }
      }
    })
  }

  // ── Categorías, instituciones y activos ──
  for (const cat of model.categories) {
    const catRow = ws.addRow([cat.label, '', ...cat.subtotals])
    styleValueRow(catRow, { bold: true, fill: CAT_BG })
    catRow.height = 18

    for (const inst of cat.institutions) {
      for (const it of inst.items) {
        // La institución va con el activo: sin ella, dos cuentas de efectivo
        // del mismo banco (o el mismo ticker en dos brokers) se imprimían con
        // el MISMO nombre en filas distintas, sin forma de distinguirlas (el
        // "IDC-CASH" repetido del archivo que mostró el usuario).
        const label = inst.name && inst.name !== 'No institution'
          ? `${it.name}  ·  ${inst.name}`
          : it.name
        const row = ws.addRow(['', label, ...it.values])
        styleValueRow(row, { italic: !!it.synthetic, color: it.synthetic ? MUTED : INK })
        row.getCell(2).alignment = { indent: 1 }
      }
    }
  }

  // ── Total ──
  const totalRow = ws.addRow(['TOTAL', '', ...model.totals])
  totalRow.height = 20
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } }
    cell.border = { top: { style: 'medium', color: { argb: HEADER_BG } } }
    if (col > 2) {
      cell.numFmt = NUM_FMT
      cell.alignment = { horizontal: 'right' }
    }
  })

  // ── Nota de meses en blanco ──
  if (model.missingMonths.length > 0) {
    ws.addRow([])
    const note = ws.addRow([`Months without data (${model.missingMonths.map(monthLabel).join(', ')}): open the Spreadsheet in the app once and they fill in on their own.`])
    ws.mergeCells(`A${note.number}:${lastCol}${note.number}`)
    note.getCell(1).font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: MUTED } }
    note.getCell(1).alignment = { wrapText: false }
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, filename: `chispudo-spreadsheet-${year}.xlsx` }
}
