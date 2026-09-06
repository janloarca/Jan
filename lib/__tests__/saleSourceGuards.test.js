// FASE OD. Guardianes de FUENTE: las reglas viven en JSX y en el hook, que
// jest no monta sin el tablero entero (precedente moneyInputs.test.js).
const fs = require('fs')
const path = require('path')
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8')

describe('SellModal', () => {
  const src = read('components/SellModal.jsx')
  it('acredita un banco con creditFields (la misma funcion que las transferencias), nunca precio + monto', () => {
    expect(src).toMatch(/destFields = creditFields\(dest, proceedsInDest\)/)
    expect(src).not.toMatch(/origPriceOf\(dest\) \+ proceeds/)
  })
  it('arma las filas con buildSaleTransactions, el unico constructor', () => {
    expect(src).toMatch(/buildSaleTransactions\(\{/)
    expect(src).not.toMatch(/type: 'SELL'/)
  })
})

describe('useDashboardData', () => {
  const src = read('hooks/useDashboardData.js')
  it('los tres planificadores de reversa reciben reversalItems (precios raw), nunca enrichedItems', () => {
    expect(src).toMatch(/transferReversalPlan\(tx, reversalItems\)/)
    expect(src).toMatch(/cashflowReversalPlan\(tx, reversalItems\)/)
    expect(src).toMatch(/saleReversalPlan\(tx, reversalItems, lots, transactions\)/)
    expect(src).not.toMatch(/transferReversalPlan\(tx, enrichedItems\)/)
    expect(src).not.toMatch(/cashflowReversalPlan\(tx, enrichedItems\)/)
    expect(src).not.toMatch(/saleReversalPlan\(tx, enrichedItems/)
  })
})

describe('useFirestoreItems', () => {
  const src = read('hooks/useFirestoreItems.js')
  it('executeSaleAtomic estampa los cierres de lote en la fila SELL', () => {
    expect(src).toMatch(/_lotCloses: lotCloses/)
  })
})

describe('las dos superficies de borrado dicen que hace borrar una venta', () => {
  it.each(['components/dashboard/RecentTransactions.jsx', 'components/EditAccountModal.jsx'])('%s', (p) => {
    expect(read(p)).toMatch(/saleReversalLines\(saleReversalPlan\(tx, /)
  })
})
