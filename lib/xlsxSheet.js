// FASE IE5. El ESTILO de las hojas de cálculo que Chispudo produce, en un solo
// lugar: lo usan el adjunto del correo mensual (servidor) y el botón "Excel"
// del Spreadsheet (navegador). Dos copias del formato es exactamente cómo una
// se queda atrás, que es la lección que este repo ya documenta para los
// componentes compartidos y para los dos generadores de reporte.
//
// Por qué ExcelJS y no la librería `xlsx` que el resto del repo usa: la
// edición community de SheetJS IGNORA los estilos de celda al escribir (son
// función de la versión de pago), así que con ella el archivo solo podía ser
// una rejilla de números crudos. ExcelJS sí los escribe, y trae bundle de
// navegador, así que el MISMO código sirve en los dos lados.
//
// Devuelve un ArrayBuffer a propósito, no un Buffer: `Buffer` no existe en el
// navegador. Cada caller lo adapta (servidor: Buffer.from; cliente: Blob).
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
export const NUM_FMT = '#,##0.00;(#,##0.00);"-"'

function colLetter(n) {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

/**
 * @param {object} doc
 * @param {string} doc.title       Encabezado grande de la hoja.
 * @param {string} [doc.subtitle]  Período cubierto y moneda.
 * @param {string} doc.sheetName
 * @param {string[]} doc.columns   Encabezados de las columnas de datos (meses o años).
 * @param {string[]} [doc.labels]  Encabezados de las dos primeras columnas.
 * @param {Array} doc.rows         [{ kind:'category'|'item'|'total', label, values, muted }]
 * @param {string[]} [doc.notes]   Notas al pie.
 * @returns {Promise<ArrayBuffer>}
 */
export async function renderStyledSheet({ title, subtitle, sheetName, columns = [], labels = ['Category', 'Asset'], rows = [], notes = [] }) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Chispudo'
  const ws = wb.addWorksheet(sheetName, {
    // El encabezado y las dos primeras columnas se quedan fijos: sin esto, a
    // veinte filas de scroll ya no se sabe qué mes es cada columna.
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
  })

  const nCols = 2 + columns.length
  const lastCol = colLetter(nCols)
  ws.columns = [{ width: 18 }, { width: 34 }, ...columns.map(() => ({ width: 13 }))]

  // ── Título ──
  ws.mergeCells(`A1:${lastCol}1`)
  const t = ws.getCell('A1')
  t.value = title
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: INK } }
  ws.getRow(1).height = 24

  ws.mergeCells(`A2:${lastCol}2`)
  const sub = ws.getCell('A2')
  sub.value = subtitle || ''
  sub.font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
  ws.getRow(2).height = 16

  // Franja de acento: la misma señal de marca que el correo, sin colorear
  // ningún dato.
  ws.mergeCells(`A3:${lastCol}3`)
  ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
  ws.getRow(3).height = 3

  // ── Encabezado ──
  const head = ws.addRow([labels[0] || '', labels[1] || '', ...columns])
  head.height = 22
  head.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'right' }
  })

  // ── Filas ──
  for (const r of rows) {
    if (r.kind === 'total') {
      const row = ws.addRow([r.label, '', ...r.values])
      row.height = 20
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } }
        cell.border = { top: { style: 'medium', color: { argb: HEADER_BG } } }
        if (col > 2) { cell.numFmt = NUM_FMT; cell.alignment = { horizontal: 'right' } }
      })
      continue
    }

    const isCat = r.kind === 'category'
    const row = ws.addRow(isCat ? [r.label, '', ...r.values] : ['', r.label, ...r.values])
    if (isCat) row.height = 18
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = {
        name: 'Calibri', size: 10.5, bold: isCat, italic: !!r.muted,
        color: { argb: r.muted ? MUTED : INK },
      }
      if (isCat) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAT_BG } }
      cell.border = { bottom: { style: 'thin', color: { argb: GRID } } }
      if (col > 2) { cell.numFmt = NUM_FMT; cell.alignment = { horizontal: 'right' } }
    })
    if (!isCat) row.getCell(2).alignment = { indent: 1 }
  }

  // ── Notas ──
  if (notes.length > 0) {
    ws.addRow([])
    for (const n of notes) {
      const note = ws.addRow([n])
      ws.mergeCells(`A${note.number}:${lastCol}${note.number}`)
      note.getCell(1).font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: MUTED } }
    }
  }

  return wb.xlsx.writeBuffer()
}
