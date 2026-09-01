// FASE ME2 (Ronda 2 de la auditoría de diseño): "dinero que miente".
//
// Guardián de FUENTE, mismo precedente que moneyInputs.test.js e
// ibkrImportGate.test.js: estas celdas viven en estados de modal inalcanzables
// desde jest sin montar el componente con un archivo real (el preview del
// import bancario existe solo después de subir un CSV), así que la regla se
// fija leyendo el archivo. La ARITMÉTICA de signo/flujo ya está cubierta por
// lib/__tests__/financeAmount (cashFlowOf/flowSign/flowMagnitude); lo que
// esto vigila es el CABLEADO: qué expresión decide el color y qué número se
// imprime.
//
// El defecto que cierra: el color salía de `tx.type` y el signo de
// `flowSign(tx)`, así que un reembolso (EXPENSE con monto negativo) imprimía
// "+Q488.07" EN ROJO, y la tabla de ajustadas imprimía el monto CRUDO
// ("Q-488.07") en rojo fijo hasta para un ingreso.

const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')

describe('FileImportModal: color y signo salen los DOS del flujo', () => {
  const src = read('components/FileImportModal.jsx')

  test('ninguna celda decide el color por tx.type', () => {
    // La forma exacta del bug: color verde/rojo elegido por el TYPE de la fila.
    expect(src).not.toMatch(/type === 'INCOME' \? 'var\(--accent-green\)'/)
  })

  test('las celdas de monto usan cashFlowOf para el color', () => {
    const hits = src.match(/cashFlowOf\((tx|parsed|row)\) >= 0 \? 'var\(--accent-green\)' : 'var\(--text-negative\)'/g) || []
    // review + newTxs + likely + repeats = 4 tablas del preview bancario.
    expect(hits.length).toBeGreaterThanOrEqual(4)
  })

  test('la tabla de ajustadas ya no imprime el monto crudo', () => {
    // row.amount directo a pantalla era el "Q-488.07"; ahora va por
    // flowSign + flowMagnitude como sus tres hermanas.
    expect(src).not.toMatch(/\{row\.amount\.toLocaleString\(\)\}/)
    expect(src).toMatch(/flowSign\(row\)/)
    expect(src).toMatch(/flowMagnitude\(row\)/)
  })

  test('el preview de posiciones imprime la moneda de la fila, no $ fijo', () => {
    expect(src).toMatch(/item\.currency && item\.currency !== 'USD' \? `\$\{item\.currency\} ` : '\$'/)
  })
})

describe('EditAccountModal: el monto impreso va en absoluto (el signo lo pone isPositive)', () => {
  test('Math.abs sobre totalAmount en la fila del historial', () => {
    const src = read('components/EditAccountModal.jsx')
    // Sin el abs, un totalAmount negativo imprime "-Q-488.07" (el doble
    // negativo que lib/financeAmount.js:9 nombra literalmente).
    expect(src).toMatch(/\{isPositive \? '\+' : '-'\}\{tx\.currency \|\| form\.currency\} \{Math\.abs\(tx\.totalAmount \|\| 0\)\.toLocaleString\(\)\}/)
  })
})

describe('AssetDetailModal: montos en la moneda que les corresponde', () => {
  const src = read('components/dashboard/AssetDetailModal.jsx')

  test('committedCapital se convierte a base antes de entrar a computeVentureMetrics', () => {
    // Los capital calls se convierten; pasarlo crudo dejaba el PIC % mal
    // (contrato de lib/ventureMetrics: un solo currency para todos los flujos).
    expect(src).toMatch(/convert\(item\.committedCapital, item\.currency \|\| baseCurrency, baseCurrency\)/)
  })

  test('roundValuation se formatea en la moneda del ítem, nunca en base', () => {
    expect(src).toMatch(/formatCurrency\(item\.roundValuation, item\.currency\)/)
    expect(src).not.toMatch(/formatCurrency\(item\.roundValuation\)[^,]/)
  })
})

describe('PortfolioSpreadsheet: la fila de deuda habla UNA sola moneda', () => {
  test('la cuota mensual va por fmtD (la moneda original), no $ fijo', () => {
    const src = read('components/dashboard/PortfolioSpreadsheet.jsx')
    expect(src).toMatch(/\{fmtD\(item\.monthlyPayment\)\}/)
    expect(src).not.toMatch(/\$\{item\.monthlyPayment\.toLocaleString\(\)\}/)
  })
})

describe('ConnectionsModal: un neto negativo no se disfraza de positivo', () => {
  test('el valor de la institución conserva su signo', () => {
    const src = read('components/ConnectionsModal.jsx')
    expect(src).toMatch(/\{inst\.value < 0 \? '-' : ''\}\$\{?/)
  })
})
