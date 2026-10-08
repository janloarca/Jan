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

  test('una posición VENDIDA de IBKR cuenta en su institución solo con el broker conectado (FASE NS)', () => {
    const closedKey = '__ibkr_closed__Interactive Brokers__OWL'
    const monthDocs = {
      '2026-01': doc({
        aapl: { value: 100 },
        [closedKey]: { value: 300, symbol: 'OWL', institution: 'Interactive Brokers', category: 'stocks', _syntheticIbkr: true, _closedPosition: true },
      }),
    }
    const ibkrItem = { id: 'aapl', symbol: 'AAPL', type: 'Stock', institution: 'Interactive Brokers', _source: 'ibkr', quantity: 1, currentPrice: 100 }
    const withIbkr = buildSpreadsheetRows({ items: [ibkrItem], monthDocs, monthKeys: ['2026-01'], liveMonthKey: null })
    expect(findRow(withIbkr.rows, 'OWL (sold)')[2]).toBe(300)
    // Sin la vendida, el mes sumaba solo la viva: la fila del broker quedaba corta.
    expect(totalRow(withIbkr.rows)[2]).toBe(100 + 300)

    // Broker borrado: ni fila ni suma, igual que el bucket.
    const without = buildSpreadsheetRows({ items: ITEMS, monthDocs, monthKeys: ['2026-01'], liveMonthKey: null })
    expect(findRow(without.rows, 'OWL (sold)')).toBeUndefined()
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

// FASE JA. El contrato entre el ESCRITOR del caché (el efecto del mes en curso
// de PortfolioSpreadsheet) y sus DOS lectores (`monthlyTotals` del cliente y
// este `buildSpreadsheetModel` del servidor). El escritor guardaba el valor ya
// firmado y los dos lectores niegan, así que la doble negación volvía la deuda
// POSITIVA y una tarjeta de $5,000 inflaba el TOTAL de ese mes en $10,000.
describe('convención de signo del caché mensual: magnitudes escritas, signo aplicado al leer', () => {
  // La expresión exacta del escritor, copiada acá para que este test falle si
  // alguien la vuelve a cambiar de un lado sin el otro.
  const storedValue = (it, liveValue) => (it.isDebt ? -liveValue : liveValue)

  test('una deuda se guarda como MAGNITUD positiva', () => {
    const loan = { id: 'loan1', isDebt: true }
    // getItemValue devuelve -5000 para una deuda de 5,000.
    expect(storedValue(loan, -5000)).toBe(5000)
  })

  test('un activo se guarda tal cual', () => {
    expect(storedValue({ id: 'bond1' }, 6000)).toBe(6000)
  })

  test('lo escrito, leído por el lector real, RESTA del patrimonio', () => {
    const stored = storedValue({ isDebt: true }, -5000)
    const model = buildSpreadsheetModel({
      items: [
        { id: 'bond1', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, currentPrice: 6000 },
        { id: 'card1', name: 'Tarjeta', type: 'Debt', institution: 'Banco', isDebt: true, quantity: 1, currentPrice: 5000 },
      ],
      monthDocs: { '2026-01': doc({ bond1: { value: 6000 }, card1: { value: stored } }) },
      monthKeys: ['2026-01'], liveMonthKey: null,
    })
    expect(model.totals[0]).toBe(1000)
  })

  test('el valor FIRMADO que se escribía antes produce el bug de $10,000', () => {
    // Regresión negativa: guardar -5000 (lo que hacía el escritor viejo) hace
    // que el lector lo niegue de nuevo y la deuda SUME.
    const model = buildSpreadsheetModel({
      items: [
        { id: 'bond1', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, currentPrice: 6000 },
        { id: 'card1', name: 'Tarjeta', type: 'Debt', institution: 'Banco', isDebt: true, quantity: 1, currentPrice: 5000 },
      ],
      monthDocs: { '2026-01': doc({ bond1: { value: 6000 }, card1: { value: -5000 } }) },
      monthKeys: ['2026-01'], liveMonthKey: null,
    })
    expect(model.totals[0]).toBe(11000)
    expect(model.totals[0] - 1000).toBe(10000)
  })
})

// ⛔ FASE MN. La rama del mes EN VIVO excluía del TOTAL lo que el usuario sacó
// del patrimonio (`countInNetWorth: false`) y la rama HISTÓRICA lo sumaba sin
// condición: la misma fila contada distinto según la columna, o sea la fila
// TOTAL se contradecía a sí misma a lo ancho de la hoja.
describe('FASE MN: una cuenta por cobrar excluida no cuenta en NINGÚN mes', () => {
  const monthKeys = ['2026-01', '2026-02']
  const excluida = {
    id: 'r1', name: 'Préstamo a un amigo', type: 'Cuenta por cobrar',
    isReceivable: true, countInNetWorth: false,
    quantity: 1, currentPrice: 500, purchasePrice: 500, currency: 'USD',
  }
  const normal = {
    id: 'b1', name: 'Banco', type: 'Bank',
    quantity: 1, currentPrice: 1000, purchasePrice: 1000, currency: 'USD',
  }
  const docs = {
    '2026-01': { currency: 'USD', items: { r1: { value: 500 }, b1: { value: 1000 } } },
  }

  const build = () => buildSpreadsheetModel({
    items: [normal, excluida], monthDocs: docs, monthKeys,
    liveMonthKey: '2026-02', baseCurrency: 'USD',
  })

  it('el TOTAL del mes histórico la deja fuera, igual que el del mes en vivo', () => {
    const m = build()
    // Enero sale del caché, febrero de los valores en vivo: los dos = 1000.
    expect(m.totals).toEqual([1000, 1000])
  })

  it('regresión: sumándola, enero daba 1500 contra los 1000 de febrero', () => {
    const m = build()
    expect(m.totals[0]).not.toBe(1500)
    expect(m.totals[0]).toBe(m.totals[1])
  })

  // El subtotal de categoría SÍ la incluye, igual que la Hoja en pantalla: esa
  // asimetría es deliberada, y por eso la hoja lo DICE al pie.
  it('el subtotal de su categoría sí la incluye, y la hoja lo declara', () => {
    const m = build()
    const cat = m.categories.find((c) => c.institutions.some((i) => i.items.some((x) => x.name === excluida.name)))
    expect(cat.subtotals[0]).toBe(500)
    expect(m.hasExcludedFromTotal).toBe(true)
  })

  // Control POSITIVO: sin ninguna excluida no se declara nada y todo suma.
  it('control: sin cuentas excluidas el TOTAL las suma todas y no hay nota', () => {
    const m = buildSpreadsheetModel({
      items: [normal], monthDocs: { '2026-01': { currency: 'USD', items: { b1: { value: 1000 } } } },
      monthKeys, liveMonthKey: '2026-02', baseCurrency: 'USD',
    })
    expect(m.totals).toEqual([1000, 1000])
    expect(m.hasExcludedFromTotal).toBe(false)
  })
})

// FASE QA2. El Excel del correo tiene que decir lo mismo que la Hoja, y la Hoja
// superpone el saldo que el usuario tecleó de su estado de cuenta para un mes
// cerrado (lib/sheetObservations.js).
describe('observaciones de saldo en el Excel (FASE QA2)', () => {
  const fondo = { id: 'f1', name: 'Fondo', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 5023, currency: 'USD' }
  const otro = { id: 'o1', name: 'Otro', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 100, currency: 'USD' }
  const monthKeys = ['2026-08', '2026-09', '2026-10']
  const docs = {
    '2026-08': { currency: 'USD', items: { f1: { value: 4900 }, o1: { value: 100 } } },
    '2026-09': { currency: 'USD', items: { f1: { value: 5006 }, o1: { value: 100 } } },
  }
  const base = { items: [fondo, otro], monthDocs: docs, monthKeys, liveMonthKey: '2026-10', baseCurrency: 'USD', currentMonthKey: '2026-10' }

  it('la celda observada pisa la derivada, y SOLO esa celda', () => {
    const m = buildSpreadsheetModel({ ...base, observations: [{ itemId: 'f1', month: '2026-09', value: 5015 }] })
    const f = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Fondo')
    const o = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Otro')
    expect(f.values).toEqual([4900, 5015, 5023])
    expect(o.values).toEqual([100, 100, 100])
    // El total del mes observado usa el valor corregido.
    expect(m.totals[1]).toBe(5115)
    expect(m.observedCount).toBe(1)
  })

  it('sin observaciones el modelo es el de siempre (regresión negativa)', () => {
    const m = buildSpreadsheetModel(base)
    const f = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Fondo')
    expect(f.values).toEqual([4900, 5006, 5023])
    expect(m.observedCount).toBe(0)
  })

  it('el mes en curso real no se observa (lo gobierna la columna viva)', () => {
    const m = buildSpreadsheetModel({ ...base, observations: [{ itemId: 'f1', month: '2026-10', value: 1 }] })
    const f = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Fondo')
    expect(f.values[2]).toBe(5023)
    expect(m.observedCount).toBe(0)
  })

  it('el mes cubierto recién cerrado (sin doc, en vivo) SÍ acepta la observación', () => {
    // Envío del día 1 de noviembre: octubre es el mes cubierto y ya está cerrado.
    const m = buildSpreadsheetModel({ ...base, currentMonthKey: '2026-11', observations: [{ itemId: 'f1', month: '2026-10', value: 5030 }] })
    const f = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Fondo')
    expect(f.values[2]).toBe(5030)
  })

  it('una observación NO vuelve completo un mes sin caché: sigue declarado faltante', () => {
    const m = buildSpreadsheetModel({ ...base, monthDocs: { '2026-09': docs['2026-09'] }, observations: [{ itemId: 'f1', month: '2026-08', value: 4950 }] })
    expect(m.missingMonths).toEqual(['2026-08'])
    const f = m.categories.flatMap(c => c.institutions.flatMap(i => i.items)).find(x => x.name === 'Fondo')
    expect(f.values[0]).toBe(4950)
  })

  it('una observación de un ítem que ya no existe se ignora', () => {
    const m = buildSpreadsheetModel({ ...base, observations: [{ itemId: 'borrado', month: '2026-09', value: 999 }] })
    expect(m.observedCount).toBe(0)
    expect(m.totals[1]).toBe(5106)
  })

  it('un ítem de broker no se corrige a mano', () => {
    const ib = { ...fondo, _source: 'ibkr' }
    const m = buildSpreadsheetModel({ ...base, items: [ib, otro], observations: [{ itemId: 'f1', month: '2026-09', value: 5015 }] })
    expect(m.observedCount).toBe(0)
  })

  it('una deuda observada resta (el valor se teclea como magnitud)', () => {
    const deuda = { id: 'd1', name: 'Tarjeta', type: 'Debt', isDebt: true, institution: 'Banco', quantity: 1, currentPrice: 300, currency: 'USD' }
    const m = buildSpreadsheetModel({
      ...base, items: [deuda],
      monthDocs: { '2026-09': { currency: 'USD', items: { d1: { value: 250 } } } },
      observations: [{ itemId: 'd1', month: '2026-09', value: 280 }],
    })
    const d = m.categories.flatMap(c => c.institutions.flatMap(i => i.items))[0]
    expect(d.values[1]).toBe(-280)
    expect(m.totals[1]).toBe(-280)
  })

  it('el .xlsx lleva una nota que dice que hay saldos corregidos a mano', async () => {
    const m = buildSpreadsheetModel({ ...base, observations: [{ itemId: 'f1', month: '2026-09', value: 5015 }] })
    const { buffer } = await renderSpreadsheetXlsx({ model: m, year: 2026 })
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const text = []
    wb.worksheets[0].eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ''))))
    expect(text.join('\n')).toMatch(/1 balance in this sheet come from corrections you entered/)
  })
})
