/**
 * @jest-environment node
 */
// El spreadsheet adjunto del correo mensual se arma del lado del servidor
// desde el MISMO caché que la pantalla del Spreadsheet. Estos tests fijan las
// reglas heredadas del cliente (huérfanos fuera, bucket de IBKR solo con el
// broker conectado, pasivos restando, conversión de moneda) y la decisión de
// honestidad central: un mes sin doc queda EN BLANCO, jamás se inventa.

import { monthKeysFor, buildSpreadsheetRows, buildSpreadsheetModel, renderSpreadsheetXlsx } from '../monthlySpreadsheet'

const ITEMS = [
  { id: 'bond1', name: 'VITALI', symbol: null, type: 'Bond', institution: 'IDC', quantity: 1, currentPrice: 6000 },
  { id: 'cash1', name: 'Fondo Líquido', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 240 },
  { id: 'loan1', name: 'Préstamo', type: 'Debt', institution: 'Banco', isDebt: true, quantity: 1, currentPrice: 1000 },
]

const doc = (entries, currency = null) => ({ items: entries, currency })

function findRow(rows, assetLabel) {
  return rows.find((r) => r[1] === assetLabel)
}

function totalRow(rows) {
  return rows.find((r) => r[0] === 'TOTAL')
}

describe('monthKeysFor', () => {
  test('enero al mes de la fecha de referencia, en su año', () => {
    const { year, monthKeys, refMonthKey } = monthKeysFor(new Date('2026-07-31T22:00:00Z'))
    expect(year).toBe(2026)
    expect(monthKeys).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    expect(refMonthKey).toBe('2026-07')
  })

  test('un envío del 1 de enero cubre el año ANTERIOR completo', () => {
    // ref = 31 de diciembre → las 12 columnas de ese año.
    const { year, monthKeys } = monthKeysFor(new Date('2025-12-31T22:00:00Z'))
    expect(year).toBe(2025)
    expect(monthKeys).toHaveLength(12)
  })
})

describe('buildSpreadsheetRows', () => {
  test('mes con doc usa el caché; el mes cubierto sin doc usa valores en vivo; mes ausente queda en blanco', () => {
    const { rows, missingMonths } = buildSpreadsheetRows({
      items: ITEMS,
      monthDocs: { '2026-01': doc({ bond1: { value: 6000 }, cash1: { value: 0 } }) },
      monthKeys: ['2026-01', '2026-02', '2026-03'],
      liveMonthKey: '2026-03',
    })
    const bond = findRow(rows, 'VITALI')
    expect(bond[2]).toBe(6000)   // enero: del caché
    expect(bond[3]).toBeNull()   // febrero: sin doc, en blanco
    expect(bond[4]).toBe(6000)   // marzo (cubierto): en vivo
    expect(missingMonths).toEqual(['2026-02'])
    // La nota de meses faltantes existe y nombra cómo llenarlos.
    expect(rows[rows.length - 1][0]).toMatch(/open the Spreadsheet/i)
  })

  test('los pasivos restan del TOTAL y las filas huérfanas del caché no cuentan (FASE GN)', () => {
    const { rows } = buildSpreadsheetRows({
      items: ITEMS,
      monthDocs: {
        '2026-01': doc({
          bond1: { value: 6000 },
          cash1: { value: 240 },
          loan1: { value: 1000 },
          deadItem: { value: 9999 }, // id de una cuenta borrada: fuera
        }),
      },
      monthKeys: ['2026-01'],
      liveMonthKey: null,
    })
    expect(totalRow(rows)[2]).toBe(6000 + 240 - 1000)
  })

  test('el bucket de IBKR cuenta SOLO si el portafolio todavía tiene items del broker', () => {
    const bucketKey = '__ibkr_unknown__Interactive Brokers__stocks'
    const monthDocs = { '2026-01': doc({ [bucketKey]: { value: 5000 } }) }

    const withIbkr = buildSpreadsheetRows({
      items: [...ITEMS, { id: 'aapl', symbol: 'AAPL', type: 'Stock', institution: 'Interactive Brokers', _source: 'ibkr', quantity: 1, currentPrice: 100 }],
      monthDocs, monthKeys: ['2026-01'], liveMonthKey: null,
    })
    // El doc de enero SOLO trae el bucket: es lo único que suma ese mes.
    expect(findRow(withIbkr.rows, 'Unidentified positions')[2]).toBe(5000)
    expect(totalRow(withIbkr.rows)[2]).toBe(5000)

    // Broker borrado: ni fila ni suma (borrar una cuenta = nunca aparece), y
    // un mes sin NADA contable queda en blanco, no en cero.
    const without = buildSpreadsheetRows({ items: ITEMS, monthDocs, monthKeys: ['2026-01'], liveMonthKey: null })
    expect(findRow(without.rows, 'Unidentified positions')).toBeUndefined()
    expect(totalRow(without.rows)[2]).toBeNull()
  })

  test('un doc guardado en otra moneda base se convierte al leer (FASE HV5 del cliente)', () => {
    const convert = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const { rows } = buildSpreadsheetRows({
      items: ITEMS,
      monthDocs: { '2026-01': doc({ bond1: { value: 46200 } }, 'GTQ') },
      monthKeys: ['2026-01'],
      liveMonthKey: null,
      baseCurrency: 'USD',
      convert,
    })
    expect(findRow(rows, 'VITALI')[2]).toBe(6000)
  })

  test('el mes cubierto CON doc usa el doc, no los valores en vivo', () => {
    const { rows } = buildSpreadsheetRows({
      items: ITEMS,
      monthDocs: { '2026-03': doc({ bond1: { value: 5900 } }) },
      monthKeys: ['2026-03'],
      liveMonthKey: '2026-03',
    })
    expect(findRow(rows, 'VITALI')[2]).toBe(5900)
  })

  test('la columna en vivo respeta exclusiones del patrimonio en el TOTAL', () => {
    const { rows } = buildSpreadsheetRows({
      items: [
        ...ITEMS,
        { id: 'rcv', name: 'IOU', type: 'Receivable', isReceivable: true, countInNetWorth: false, institution: 'X', quantity: 1, currentPrice: 500 },
      ],
      monthDocs: {},
      monthKeys: ['2026-03'],
      liveMonthKey: '2026-03',
    })
    // La fila del por-cobrar se ve, pero el TOTAL no la suma.
    expect(findRow(rows, 'IOU')[2]).toBe(500)
    expect(totalRow(rows)[2]).toBe(6000 + 240 - 1000)
  })
})

describe('buildSpreadsheetModel: subtotales por categoría (FASE IE4)', () => {
  test('cada categoría trae su subtotal y las filas siguen sumando el TOTAL', () => {
    const model = buildSpreadsheetModel({
      items: ITEMS,
      monthDocs: { '2026-01': doc({ bond1: { value: 6000 }, cash1: { value: 240 }, loan1: { value: 1000 } }) },
      monthKeys: ['2026-01'], liveMonthKey: null,
    })
    const byLabel = Object.fromEntries(model.categories.map((c) => [c.label, c]))
    expect(byLabel['Bonds'].subtotals[0]).toBe(6000)
    expect(byLabel['Cash & Banks'].subtotals[0]).toBe(240)
    // La deuda entra NEGATIVA al subtotal de su categoría, igual que al total.
    expect(byLabel['Liabilities'].subtotals[0]).toBe(-1000)
    const sumOfCats = model.categories.reduce((s, c) => s + (c.subtotals[0] || 0), 0)
    expect(sumOfCats).toBe(model.totals[0])
  })

  test('un mes sin ningún dato deja el subtotal en blanco, no en 0.00', () => {
    const model = buildSpreadsheetModel({
      items: ITEMS, monthDocs: {}, monthKeys: ['2026-01', '2026-02'], liveMonthKey: '2026-02',
    })
    const cat = model.categories[0]
    expect(cat.subtotals[0]).toBeNull()
    expect(cat.subtotals[1]).not.toBeNull()
  })

  test('el activo conserva su institución para poder distinguir homónimos', () => {
    const model = buildSpreadsheetModel({
      items: [
        { id: 'a', name: 'CASH', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 100 },
        { id: 'b', name: 'CASH', type: 'Bank', institution: 'Banco Industrial', quantity: 1, currentPrice: 200 },
      ],
      monthDocs: {}, monthKeys: ['2026-01'], liveMonthKey: '2026-01',
    })
    const names = model.categories[0].institutions.map((i) => i.name).sort()
    expect(names).toEqual(['Banco Industrial', 'IDC'])
  })
})

describe('renderSpreadsheetXlsx: formato real, no una rejilla cruda', () => {
  // La librería `xlsx` del repo IGNORA estilos al escribir (son de la versión
  // de pago), así que el adjunto salía sin colores ni negritas por más que se
  // pidieran. Estos tests leen el archivo GENERADO y verifican que el formato
  // llegó de verdad, no que el código lo intentó.
  const build = async () => {
    const model = buildSpreadsheetModel({
      items: ITEMS,
      monthDocs: { '2026-01': doc({ bond1: { value: 6000 }, cash1: { value: 240 }, loan1: { value: 1000 } }) },
      monthKeys: ['2026-01', '2026-02'], liveMonthKey: '2026-02',
    })
    return renderSpreadsheetXlsx({ model, year: 2026 })
  }

  test('produce un workbook real (firma ZIP de un .xlsx)', async () => {
    const { buffer, filename } = await build()
    expect(filename).toBe('chispudo-spreadsheet-2026.xlsx')
    expect(buffer.slice(0, 2).toString('latin1')).toBe('PK')
  })

  test('encabezado con fondo y texto blanco, congelado, y TOTAL en negrita', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { buffer } = await build()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]

    // Encabezado en la fila 4 (título, subtítulo, franja de acento arriba).
    const head = ws.getRow(4)
    expect(head.getCell(1).value).toBe('Category')
    expect(head.getCell(1).font.bold).toBe(true)
    expect(head.getCell(1).font.color.argb).toBe('FFFFFFFF')
    expect(head.getCell(1).fill.fgColor.argb).toBe('FF1F2937')

    // Paneles congelados: el encabezado y las dos primeras columnas se quedan.
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 4 })

    // El TOTAL existe, va en negrita y con formato de número.
    let totalRow = null
    ws.eachRow((r) => { if (r.getCell(1).value === 'TOTAL') totalRow = r })
    expect(totalRow).toBeTruthy()
    expect(totalRow.getCell(1).font.bold).toBe(true)
    expect(totalRow.getCell(3).numFmt).toContain('#,##0.00')
  })

  test('la deuda se imprime entre paréntesis, nunca en rojo ni con signo suelto', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { buffer } = await build()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    let seen = null
    ws.eachRow((r) => { if (r.getCell(1).value === 'Liabilities') seen = r })
    expect(seen).toBeTruthy()
    expect(seen.getCell(3).value).toBe(-1000)
    // Formato contable: el negativo va entre paréntesis.
    expect(seen.getCell(3).numFmt).toContain('(#,##0.00)')
  })

  test('el activo lleva su institución al lado, para distinguir homónimos', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { buffer } = await build()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.worksheets[0]
    const labels = []
    ws.eachRow((r) => { const v = r.getCell(2).value; if (typeof v === 'string') labels.push(v) })
    expect(labels.some((l) => l.includes('VITALI') && l.includes('IDC'))).toBe(true)
  })
})
