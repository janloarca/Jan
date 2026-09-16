// FASE OA. La auditoria de "un usuario nuevo agrega bonos": consistencia entre
// el alta, la Hoja, la grafica y los dividendos. Dos reportes reales del
// usuario abrieron la ronda: "al agregar bonos con 5 cada una con 1000 de
// valor me aparecia monto de 50000 mientras que debia ser 5000" y "al agregar
// un bono pagadero semestral no lo leyo en el spreadsheet los dividendos".
//
// Lo que se puede ejecutar se ejecuta (firma del cache, compuerta de fecha de
// la Hoja, el boletin). Lo que vive en JSX que jest no puede montar sin el
// dashboard entero se fija LEYENDO LA FUENTE (precedente moneyInputs.test.js,
// ibkrImportGate.test.js): cada guardian nombra el defecto que impide.

const fs = require('fs')
const path = require('path')

jest.mock('../authFetch', () => ({
  authFetch: jest.fn(),
  safeJson: jest.fn(async (res) => (res && res.json ? res.json() : null)),
}))

const { authFetch } = require('../authFetch')
const { getHistoricalItemValues } = require('../historicalValues')
const { spreadsheetInputSig, cachedMonthIsCurrent } = require('../spreadsheetSig')
const { analyzeDataCompleteness } = require('../dataCompleteness')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ---------------------------------------------------------------------------
// 1. La firma del cache mensual
// ---------------------------------------------------------------------------
describe('FASE OA: firma de insumos del cache de la Hoja', () => {
  it('es determinista y corta', () => {
    const a = spreadsheetInputSig([12, 'tx1|tx2', 'lot1', 'i1:BONO:1:5000:2025-01-01'])
    const b = spreadsheetInputSig([12, 'tx1|tx2', 'lot1', 'i1:BONO:1:5000:2025-01-01'])
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('cambia cuando cambia CUALQUIER insumo (un cupon nuevo, un lote, un campo del item)', () => {
    const base = [12, 'tx1|tx2', 'lot1', 'i1:BONO:1:5000:2025-01-01']
    const withCoupon = [12, 'tx1|tx2|tx3', 'lot1', 'i1:BONO:1:5000:2025-01-01']
    const withLot = [12, 'tx1|tx2', 'lot1|lot2', 'i1:BONO:1:5000:2025-01-01']
    const withQty = [12, 'tx1|tx2', 'lot1', 'i1:BONO:5:5000:2025-01-01']
    const s0 = spreadsheetInputSig(base)
    expect(spreadsheetInputSig(withCoupon)).not.toBe(s0)
    expect(spreadsheetInputSig(withLot)).not.toBe(s0)
    expect(spreadsheetInputSig(withQty)).not.toBe(s0)
  })

  it('un doc SIN firma (anterior a esta fase) no se da por bueno', () => {
    const cur = spreadsheetInputSig(['a'])
    expect(cachedMonthIsCurrent(undefined, cur)).toBe(false)
    expect(cachedMonthIsCurrent(null, cur)).toBe(false)
    expect(cachedMonthIsCurrent('', cur)).toBe(false)
  })

  it('un doc con la firma de HOY es confiable; con otra, no', () => {
    const cur = spreadsheetInputSig(['a'])
    expect(cachedMonthIsCurrent(cur, cur)).toBe(true)
    expect(cachedMonthIsCurrent(spreadsheetInputSig(['b']), cur)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. La Hoja: una accion sin fecha de adquisicion no vale "desde siempre"
// ---------------------------------------------------------------------------
describe('FASE OA: accion sin fecha en la Hoja', () => {
  const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-07', '2026-08', '2026-09']
  // El proveedor CONTESTA (un precio por mes): es el camino que gobierna la
  // compuerta nueva. Con el proveedor caido el item cae a la reconstruccion
  // estatica (congelada F), que ya gateaba por enero del anio de creacion.
  const PRICES = MONTHS.map((mk) => ({ date: `${mk}-15`, close: 100 }))
  beforeEach(() => {
    authFetch.mockReset()
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ currency: 'USD', prices: PRICES }) })
  })
  const stock = (o) => ({
    id: 's1', symbol: 'ACME', name: 'Acme', type: 'Stock', quantity: 10,
    currentPrice: 100, purchasePrice: 100, _originalPurchasePrice: 100, currency: 'USD',
    institution: 'Broker', _category: 'stocks', ...o,
  })

  it('con un lote fechado (el alta manual lo crea), los meses ANTERIORES al lote quedan vacios', async () => {
    const lots = [{ id: 'l1', symbol: 'ACME', quantity: 10, costBasis: 100, status: 'open', acquisitionDate: '2026-09-02' }]
    const res = await getHistoricalItemValues([stock({ createdAt: '2026-09-02T10:00:00Z' })], MONTHS, null, 'USD', lots, [], [])
    expect(res['2026-08']?.s1).toBeUndefined()
    expect(res['2026-02']?.s1).toBeUndefined()
    expect(res['2025-11']?.s1).toBeUndefined()
    expect(res['2026-09']?.s1?.value).toBeCloseTo(1000, 2)
  })

  it('sin lote ni fecha, cae a enero del anio en que se creo (la misma regla que un estatico)', async () => {
    const res = await getHistoricalItemValues([stock({ createdAt: '2026-03-10T10:00:00Z' })], MONTHS, null, 'USD', [], [], [])
    expect(res['2025-11']?.s1).toBeUndefined()
    expect(res['2025-12']?.s1).toBeUndefined()
    expect(res['2026-01']?.s1?.value).toBeCloseTo(1000, 2)
    expect(res['2026-09']?.s1?.value).toBeCloseTo(1000, 2)
  })

  it('regresion negativa: la compuerta vieja (sin fecha = desde siempre) ya no puede volver', async () => {
    const res = await getHistoricalItemValues([stock({ createdAt: '2026-09-02T10:00:00Z' })], MONTHS, null, 'USD', [], [], [])
    // Con la compuerta vieja, 2025-11 tendria 1000.
    expect(res['2025-11']?.s1).toBeUndefined()
  })

  it('control: una fecha de adquisicion REAL sigue mandando sobre el lote', async () => {
    const lots = [{ id: 'l1', symbol: 'ACME', quantity: 10, costBasis: 100, status: 'open', acquisitionDate: '2026-09-02' }]
    const res = await getHistoricalItemValues([stock({ acquisitionDate: '2025-12-15', createdAt: '2026-09-02T10:00:00Z' })], MONTHS, null, 'USD', lots, [], [])
    expect(res['2025-11']?.s1).toBeUndefined()
    expect(res['2025-12']?.s1?.value).toBeCloseTo(1000, 2)
  })
})

// ---------------------------------------------------------------------------
// 3. El boletin: un bono sin cupon configurado
// ---------------------------------------------------------------------------
describe('FASE OA: bono sin cupon en el boletin', () => {
  const NOW = new Date('2026-09-05T12:00:00Z')
  const run = (items) => analyzeDataCompleteness({ items, transactions: [], lots: [], baseCurrency: 'USD', now: NOW, convert: (a) => a })
  const bond = (o) => ({
    id: 'b1', name: 'Bono Azucar', symbol: 'BONO-AZUCAR', type: 'Bond', quantity: 1,
    currentPrice: 5000, purchasePrice: 5000, currency: 'USD', institution: 'IDC',
    acquisitionDate: '2026-01-10', createdAt: '2026-01-10', _newMoneyConfirmed: true, ...o,
  })
  const codes = (r) => (r.findings || r).map((f) => f.code)

  it('un bono sin tasa, sin monto y sin calendario recibe el hallazgo', () => {
    expect(codes(run([bond()]))).toContain('bond-no-income')
  })

  it('con tasa configurada no hay hallazgo', () => {
    expect(codes(run([bond({ incomeRate: 8, incomeMonths: [4, 10], incomeMonthsExplicit: true })]))).not.toContain('bond-no-income')
  })

  it('con monto fijo tampoco', () => {
    expect(codes(run([bond({ incomeAmount: 200, incomeMonths: [4, 10], incomeMonthsExplicit: true })]))).not.toContain('bond-no-income')
  })

  it('un alternativo sin ingreso NO lo recibe (puede legitimamente no pagar)', () => {
    expect(codes(run([bond({ type: 'Alternative' })]))).not.toContain('bond-no-income')
  })
})

// ---------------------------------------------------------------------------
// 4. Guardianes de fuente
// ---------------------------------------------------------------------------
describe('FASE OA: guardianes de fuente', () => {
  const add = stripComments(read('components/AddAccountModal.jsx'))
  const edit = stripComments(read('components/EditAccountModal.jsx'))
  const hoja = stripComments(read('components/dashboard/PortfolioSpreadsheet.jsx'))
  const patr = stripComments(read('components/dashboard/PatrimonioSpreadsheet.jsx'))
  const guided = stripComments(read('components/GuidedAssetSteps.jsx'))
  const route = stripComments(read('app/api/prices/portfolio-history/route.js'))
  const store = stripComments(read('hooks/useFirestoreItems.js'))
  const hook = stripComments(read('hooks/useDashboardData.js'))

  it('AddAccountModal: cambiar de tipo de activo BORRA la cantidad tecleada', () => {
    // El bug real: cantidad 5 en Acciones, volver, elegir Bono con monto 1000
    // guardaba un bono de 5 x 1000 y la Hoja lo leia como 5,000... x 5.
    const reset = add.match(/setForm\(prev => \(\{ \.\.\.prev, symbol: '', name: '',[^}]*\}\)\)/)
    expect(reset).not.toBeNull()
    expect(reset[0]).toContain("quantity: ''")
  })

  it('AddAccountModal: la cantidad efectiva es 1 para todo lo que no sea de mercado', () => {
    expect(add).toMatch(/const effectiveQuantity = \(\) => \(isMarketAsset \? parseQuantity\(form\.quantity\) : 1\)/)
    expect(add).toMatch(/const qty = effectiveQuantity\(\)\s*\n\s*const price = parseAmount\(form\.purchasePrice\)/)
    // y ningun otro sitio vuelve a leer form.quantity por su cuenta con un
    // default propio (era la forma en que el pie y las vistas previas
    // podian discrepar del guardado).
    expect(add).not.toMatch(/parseQuantity\(form\.quantity\) \|\| \(isBank/)
    expect(add).not.toMatch(/\(parseQuantity\(form\.quantity\) \|\| 1\)/)
  })

  it('AddAccountModal: la rama no-mercado escribe cantidad 1, nunca la del formulario', () => {
    const branch = add.slice(add.indexOf('} else {\n        item.symbol = form.symbol.trim() || form.name.trim()'))
    expect(branch.slice(0, 400)).toMatch(/item\.quantity = 1\n/)
    expect(branch.slice(0, 400)).not.toMatch(/item\.quantity = qty/)
  })

  it('AddAccountModal: "Agregar a posicion" sobre un activo de saldo SUMA y el deposito es solo lo nuevo', () => {
    // FASE OL: la aritmetica del merge se movio a lib/mergePosition.js (con
    // tests que la EJECUTAN); el modal tiene que pedirsela y no re-derivarla.
    const merge = stripComments(read('lib/mergePosition.js'))
    expect(merge).toMatch(/if \(!isMarketAsset && !item\?\.isDebt\) \{[\s\S]*?purchasePrice: oldPurchase \+ price/)
    expect(add).toMatch(/Object\.assign\(item, mergePositionFields\(\{/)
    expect(add).not.toMatch(/oldPurchase \+ price/)
    expect(add).toMatch(/const isMerge = !!duplicateWarning && !item\.isDebt/)
  })

  it('EditAccountModal: cambiar la cantidad de un bono pregunta por el flujo (delta del TOTAL)', () => {
    expect(edit).toMatch(/flowDelta = \(\(updated\.quantity \|\| 0\) \* \(updated\.purchasePrice \|\| 0\)\) - \(rawQty \* rawPP\)/)
  })

  it('PatrimonioSpreadsheet: el total tecleado se divide entre la cantidad antes de guardarse como precio', () => {
    expect(patr).toMatch(/const patch = \{ currentPrice: price \/ usableQty \}/)
  })

  it('PortfolioSpreadsheet: un mes cacheado se juzga por su FIRMA, y toda escritura la estampa', () => {
    const missing = hoja.slice(hoja.indexOf('const missingMonths = pastMonths.filter'), hoja.indexOf('if (missingMonths.length === 0)'))
    expect(missing).toMatch(/cachedMonthIsCurrent\(cachedSigRef\.current\[mk\], inputSig\)/)
    const saves = hoja.match(/onSaveItemSnapshots\([^)]*\)/g) || []
    expect(saves.length).toBe(3)
    for (const s of saves) expect(s).toMatch(/sig: inputSig/)
  })

  it('useFirestoreItems: el doc persiste `_sig` y la lectura lo devuelve como `__sigs`', () => {
    expect(store).toMatch(/\.\.\.\(sig \? \{ _sig: sig \} : \{\}\)/)
    expect(store).toMatch(/if \(data\._sig\) sigs\[key\] = data\._sig/)
    expect(store).toMatch(/__sigs: sigs/)
  })

  it('useDashboardData: el motor de dividendos se re-arma con la configuracion de ingreso, nunca con precio o cantidad', () => {
    const block = hook.slice(hook.indexOf('const scheduleSig = enrichedItems'), hook.indexOf('const runKey ='))
    expect(block).toMatch(/incomeMonths/)
    expect(block).toMatch(/incomeDestination/)
    expect(block).toMatch(/dividendAction/)
    expect(block).not.toMatch(/currentPrice|_originalPrice|\bquantity\b/)
    expect(hook).toMatch(/if \(dividendsProcessedRef\.current === runKey\) return/)
  })

  it('GuidedAssetSteps: la institucion va ANTES del monto en bonos y alternativos', () => {
    expect(guided).toMatch(/Bond: \['name', 'institution', 'amount'\]/)
    expect(guided).toMatch(/Alternative: \['name', 'institution', 'amount'\]/)
  })

  it('portfolio-history: el regex de simbolo solo juzga lo que se cotiza', () => {
    expect(route).toMatch(/if \(sym && isMarketPriced\(it\) && !SYMBOL_RE\.test\(sym\)\)/)
  })
})
