// FASE SK. Guardián de FUENTE del cableado de las cuentas conciliadas (los
// bloques viven en memos que jest no monta sin el tablero entero; la lógica
// pura está en ledgerReconcile.test.js).
const fs = require('fs')
const path = require('path')

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p) => strip(fs.readFileSync(path.join(__dirname, '../..', p), 'utf8'))
const chart = read('components/dashboard/PortfolioGrowthChart.jsx')
const page = read('app/dashboard/page.jsx')
const hook = read('hooks/useDashboardData.js')
const modal = read('components/FileImportModal.jsx')
const planner = read('lib/ledgerReconcile.js')

describe('cuentas conciliadas: cableado', () => {
  it('la gráfica recibe los cierres del broker y quita los flujos reemplazados', () => {
    expect(page).toMatch(/ledgerAccounts=\{settings\?\.ledgerAccounts \|\| null\}/)
    expect(chart).toMatch(/dropLedgerSupersededFlows\(assetOnlyFlows\(transactionsProp, debtIds\), ledgerIds\)/)
  })

  it('YTD/MTD/ALL de la cuenta usan sus cierres; el % es el TWR del broker', () => {
    expect(chart).toMatch(/const LEDGER_PERIODS = \['YTD', 'MTD', 'ALL'\]/)
    expect(chart).toMatch(/if \(ledgerPoints\) return ledgerPoints/)
    expect(chart).toMatch(/growthPct = useCardDay \? dayChange\.pct : \(ledgerTwr \? ledgerTwr\.pct : windowGrowth\.growthPct\)/)
  })

  it('C (YTD del tablero) quita los flujos reemplazados y atribuye el ledger a su cuenta', () => {
    expect(hook).toMatch(/dropLedgerSupersededFlows\(dropManualBrokerFlows\(assetOnlyFlows\(viewTransactions, debtIds\), ibkrIds\), ledgerIds\)/)
    expect(hook).toMatch(/tx\._source === LEDGER_SOURCE && tx\._ledgerAccount/)
  })

  it('"Conciliar con mi cuenta" no llama ni necesita la sincronización con el broker', () => {
    for (const src of [planner]) {
      expect(src).not.toMatch(/handleIBKRSync|\/api\/brokers|fetch\(|authFetch|vanished/i)
    }
    const fn = modal.slice(modal.indexOf('const doLedgerReconcile'), modal.indexOf('const ibkrMissingHistory'))
    expect(fn.length).toBeGreaterThan(100)
    expect(fn.length).toBeLessThan(6000)
    expect(fn).not.toMatch(/handleIBKRSync|\/api\/brokers|authFetch|fetch\(/)
    expect(fn).toMatch(/onBulkImport\(plan\.bulk/)
  })

  it('el modal recibe lo que la conciliación necesita', () => {
    expect(page).toMatch(/existingTransactions=\{transactions\} onSaveSettings=\{saveSettings\}/)
  })
})
