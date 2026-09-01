import {
  detectFakeAggregateTrades,
  detectImportStampedAcquisitions,
  detectFakeCashReportItems,
  detectDuplicateCashDividends,
  detectCrossSourceDuplicateFlows,
  detectCrossSourceDuplicateTrades,
  detectAccountQualifiedIdDuplicates,
  detectSameTxnIdAcrossDates,
  detectMisstampedMonthlyNavSnapshots,
} from '@/lib/badDataCleanup'

describe('detectFakeAggregateTrades', () => {
  // The exact shape the "Trade Summary" misparse produced: no commission, no
  // cost basis, stamped at the import date. Currency defaults to a plausible
  // ISO code so these fixtures test the COHORT rule (step 2) in isolation —
  // the impossible-currency rule (step 3, tested separately below) is an
  // independent, ungated condition and would otherwise mask cohort-shape
  // failures. 12 distinct symbols so the cohort clears the >=10 floor.
  const fakeRow = (symbol, i, overrides = {}) => ({
    id: `fake-${symbol}`,
    type: i % 2 === 0 ? 'BUY' : 'SELL',
    symbol,
    date: '2026-07-27',
    createdAt: '2026-07-27T14:03:00.000Z',
    quantity: 3.0464,
    pricePerUnit: 15.61,
    totalAmount: 47.57,
    commission: 0,
    currency: 'USD',
    _ibkrRealizedPL: 0,
    _ibkrCostBasis: 0,
    _source: 'ibkr',
    ...overrides,
  })
  const symbols = ['EWH', 'AAPL', 'MSFT', 'NVO', 'PEP', 'DPZ', 'MO', 'VICI', 'RXRX', 'OKE', 'CRSP', 'GOOG']
  const fakeCohort = symbols.map((s, i) => fakeRow(s, i))

  const realTrade = {
    id: 'real-1', type: 'BUY', symbol: 'AAPL', date: '2026-05-01', createdAt: '2026-07-27T14:03:00.000Z',
    quantity: 10, pricePerUnit: 190, totalAmount: 1900, commission: 1, currency: 'USD',
    _ibkrCostBasis: 1900, _ibkrRealizedPL: 0, _source: 'ibkr',
  }

  it('flags a same-day cohort with zero commission and zero cost basis', () => {
    const hits = detectFakeAggregateTrades(fakeCohort)
    expect(hits).toHaveLength(symbols.length)
    expect(hits.map((h) => h.symbol).sort()).toEqual([...symbols].sort())
  })

  it('leaves a real trade alone (has commission and cost basis)', () => {
    expect(detectFakeAggregateTrades([...fakeCohort, realTrade])).not.toContainEqual(
      expect.objectContaining({ id: 'real-1' })
    )
  })

  it('does not flag a cohort smaller than 10 (not an aggregate export shape)', () => {
    expect(detectFakeAggregateTrades(fakeCohort.slice(0, 5))).toEqual([])
  })

  it('does not flag a same-day group with a repeated symbol (real partial fills do that)', () => {
    const withRepeat = [...fakeCohort, { ...fakeRow('EWH', 0), id: 'fake-EWH-2' }]
    expect(detectFakeAggregateTrades(withRepeat)).toEqual([])
  })

  it('ignores API-synced IBKR trades even with the same shape', () => {
    const apiSynced = fakeCohort.map((tx) => ({ ...tx, _ibkrTxnId: 'x1' }))
    expect(detectFakeAggregateTrades(apiSynced)).toEqual([])
  })

  it('flags an impossible (non-ISO) currency on its own, cohort or not', () => {
    const lone = fakeRow('EWH', 0, { id: 'lone-bad-currency', currency: 'United States Dollar' })
    expect(detectFakeAggregateTrades([lone, realTrade]).map((h) => h.id)).toEqual(['lone-bad-currency'])
  })

  it('does not flag a cohort of 250+ rows (safety cap: abort, do not delete)', () => {
    const huge = Array.from({ length: 250 }, (_, i) => fakeRow(`SYM${i}`, i))
    expect(detectFakeAggregateTrades(huge)).toEqual([])
  })
})

describe('detectImportStampedAcquisitions', () => {
  const item = (overrides) => ({
    id: 'it-1', symbol: 'EWH', _source: 'ibkr', _origin: 'file',
    acquisitionDate: '2026-07-27', createdAt: '2026-07-27T14:03:00.000Z',
    ...overrides,
  })

  it('flags an item whose acquisitionDate is stamped at the import date, only for a confirmed fake-trade symbol', () => {
    const hits = detectImportStampedAcquisitions([item()], new Set(['EWH']))
    expect(hits).toEqual([{ id: 'it-1', symbol: 'EWH', reason: 'import-stamped-acquisition-date' }])
  })

  it('leaves a symbol NOT in the confirmed cohort alone', () => {
    expect(detectImportStampedAcquisitions([item()], new Set(['AAPL']))).toEqual([])
  })

  it('returns nothing without a confirmed cohort', () => {
    expect(detectImportStampedAcquisitions([item()], new Set())).toEqual([])
  })

  it('leaves a genuinely older acquisition alone even for a flagged symbol', () => {
    const older = item({ acquisitionDate: '2023-06-23' })
    expect(detectImportStampedAcquisitions([older], new Set(['EWH']))).toEqual([])
  })
})

describe('detectFakeCashReportItems', () => {
  it('flags Cash Report line items misread as holdings', () => {
    const items = [
      { id: 'c1', symbol: 'CASH-Trades (Purchase)', _source: 'ibkr', institution: 'Interactive Brokers', currentPrice: 9898.39 },
      { id: 'c2', symbol: 'CASH-Deposits', _source: 'ibkr', institution: 'Interactive Brokers', currentPrice: 3950 },
      { id: 'c3', symbol: 'CASH-Ending Cash', _source: 'ibkr', institution: 'Interactive Brokers', currentPrice: 1.39 },
    ]
    expect(detectFakeCashReportItems(items).map((h) => h.id).sort()).toEqual(['c1', 'c2', 'c3'])
  })

  it('leaves a real ISO-currency cash balance alone', () => {
    const items = [{ id: 'real-cash', symbol: 'CASH-USD', _source: 'ibkr', institution: 'Interactive Brokers', currentPrice: 1.39 }]
    expect(detectFakeCashReportItems(items)).toEqual([])
  })

  it('leaves crypto-exchange CASH-<stablecoin> balances alone (different institution)', () => {
    const items = [{ id: 'usdt', symbol: 'CASH-USDT', _source: 'kraken', institution: 'Kraken', currentPrice: 500 }]
    expect(detectFakeCashReportItems(items)).toEqual([])
  })

  it('leaves manual items alone', () => {
    const items = [{ id: 'm1', symbol: 'CASH-Trades (Purchase)', _source: 'manual', institution: 'Interactive Brokers' }]
    expect(detectFakeCashReportItems(items)).toEqual([])
  })

  it('aborts instead of deleting when the match count is implausibly large', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, symbol: `CASH-Line${i}`, _source: 'ibkr', institution: 'Interactive Brokers',
    }))
    expect(detectFakeCashReportItems(items)).toEqual([])
  })
})

describe('detectDuplicateCashDividends', () => {
  const real = { id: 'real-div', type: 'DIVIDEND', symbol: 'PEP', date: '2026-01-06', totalAmount: 6.19, description: 'Cash Dividend', _source: 'ibkr' }
  const dupe = { id: 'dupe-div', type: 'DIVIDEND', symbol: 'CASH', date: '2026-01-06', totalAmount: 6.19, description: 'DIVIDEND', _source: 'ibkr' }

  it('flags a CASH-symbol dividend with a same-date, same-amount partner under the real symbol', () => {
    expect(detectDuplicateCashDividends([real, dupe]).map((h) => h.id)).toEqual(['dupe-div'])
  })

  it('leaves a CASH dividend alone with no real partner', () => {
    expect(detectDuplicateCashDividends([dupe])).toEqual([])
  })

  it('leaves an API-synced CASH dividend alone even with a partner (carries _ibkrTxnId)', () => {
    const apiDupe = { ...dupe, id: 'api-dupe', _ibkrTxnId: 'x1', description: 'Dividend' }
    expect(detectDuplicateCashDividends([real, apiDupe])).toEqual([])
  })

  it('leaves a description that is not the exact uppercase literal alone', () => {
    const titled = { ...dupe, id: 'titled', description: 'Dividend' }
    expect(detectDuplicateCashDividends([real, titled])).toEqual([])
  })

  it('requires the partner to be a DIFFERENT symbol', () => {
    const twoCash = { ...dupe, id: 'other-cash' }
    expect(detectDuplicateCashDividends([dupe, twoCash])).toEqual([])
  })
})

describe('detectCrossSourceDuplicateFlows', () => {
  // Real shape from a live account: the same $1,450 deposit landed twice —
  // once from a file import (id has no txn-id suffix) and once from the live
  // API sync (id gets a -${_ibkrTxnId} suffix), so they collided on every
  // field except id and survived as two docs instead of one.
  const fileDeposit = {
    id: '2026-01-27-CASH-DEPOSIT-145000', type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-27',
    totalAmount: 1450, description: 'Cash Receipts / Electronic Fund Transfers', _source: 'ibkr',
  }
  const apiDeposit = {
    id: '2026-01-27-CASH-DEPOSIT-145000-U987654321', type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-27',
    totalAmount: 1450, description: 'Electronic Fund Transfer', _source: 'ibkr',
    _ibkrAccountId: 'U12093588', _ibkrTxnId: 'U987654321',
  }

  it('flags the file-imported copy when a same-date same-amount API-synced twin exists', () => {
    expect(detectCrossSourceDuplicateFlows([fileDeposit, apiDeposit]).map((h) => h.id)).toEqual([fileDeposit.id])
  })

  it('leaves a file-imported flow alone when no API-synced twin exists', () => {
    expect(detectCrossSourceDuplicateFlows([fileDeposit])).toEqual([])
  })

  it('leaves an API-synced flow alone when no file-imported twin exists', () => {
    expect(detectCrossSourceDuplicateFlows([apiDeposit])).toEqual([])
  })

  it('does not match across different dates or amounts', () => {
    const otherDate = { ...apiDeposit, id: 'x1', date: '2026-01-28' }
    const otherAmount = { ...apiDeposit, id: 'x2', totalAmount: 1451 }
    expect(detectCrossSourceDuplicateFlows([fileDeposit, otherDate, otherAmount])).toEqual([])
  })

  it('does not match a WITHDRAWAL against a DEPOSIT of the same amount and date', () => {
    const withdrawal = { ...apiDeposit, id: 'w1', type: 'WITHDRAWAL' }
    expect(detectCrossSourceDuplicateFlows([fileDeposit, withdrawal])).toEqual([])
  })

  it('leaves manual entries alone', () => {
    const manual = { ...fileDeposit, id: 'm1', _source: 'manual' }
    expect(detectCrossSourceDuplicateFlows([manual, apiDeposit])).toEqual([])
  })

  it('reproduces the real account: three 2026 deposits doubled by cross-source import', () => {
    const file = [
      fileDeposit,
      { id: '2026-02-26-CASH-DEPOSIT-135000', type: 'DEPOSIT', symbol: 'CASH', date: '2026-02-26', totalAmount: 1350, description: 'Cash Receipts / Electronic Fund Transfers', _source: 'ibkr' },
      { id: '2026-04-10-CASH-DEPOSIT-115000', type: 'DEPOSIT', symbol: 'CASH', date: '2026-04-10', totalAmount: 1150, description: 'Cash Receipts / Electronic Fund Transfers', _source: 'ibkr' },
      { id: '2026-04-17-CASH-WITHDRAWAL-500', type: 'WITHDRAWAL', symbol: 'CASH', date: '2026-04-17', totalAmount: 5, description: 'Disbursement Initiated By Jan M Loarca Tabush', _source: 'ibkr' },
    ]
    const api = file.map((tx, i) => ({ ...tx, id: `${tx.id}-U${i}`, _ibkrAccountId: 'U12093588', _ibkrTxnId: `U${i}` }))
    const hits = detectCrossSourceDuplicateFlows([...file, ...api])
    expect(hits.map((h) => h.id).sort()).toEqual(file.map((f) => f.id).sort())
    // Doubled 2026 flow total (1450+1350+1150-5=3945) before the fix, halved back to 3945 after.
    const doubledTotal = [...file, ...api].reduce((s, t) => s + (t.type === 'WITHDRAWAL' ? -t.totalAmount : t.totalAmount), 0)
    expect(doubledTotal).toBeCloseTo(3945 * 2, 5)
  })
})

describe('detectMisstampedMonthlyNavSnapshots', () => {
  // The pre-fix parser stamped PortfolioAnalyst monthly NAV rows (YYYYMM,
  // month-END values) at month-START. A run of day-01 IBKR snapshots on
  // consecutive months is that bug's fingerprint.
  const snap = (date, overrides = {}) => ({
    id: date, date, netWorthUSD: 100000, totalActivosUSD: 100000, _source: 'ibkr', ...overrides,
  })
  const monthlyRun = [
    snap('2025-11-01'),
    snap('2025-12-01'),
    snap('2026-01-01'),
    snap('2026-02-01'),
  ]

  it('re-stamps a run of consecutive day-01 monthly snapshots to month-end', () => {
    const hits = detectMisstampedMonthlyNavSnapshots(monthlyRun)
    expect(hits).toHaveLength(4)
    expect(hits.map((h) => [h.date, h.newDate])).toEqual([
      ['2025-11-01', '2025-11-30'],
      ['2025-12-01', '2025-12-31'],
      ['2026-01-01', '2026-01-31'],
      ['2026-02-01', '2026-02-28'],
    ])
    expect(hits.every((h) => h.reason === 'misstamped-monthly-nav-snapshot')).toBe(true)
  })

  it('ignores an isolated day-01 snapshot (no consecutive run)', () => {
    expect(detectMisstampedMonthlyNavSnapshots([snap('2026-01-01')])).toEqual([])
    expect(detectMisstampedMonthlyNavSnapshots([
      snap('2026-01-01'), snap('2026-03-01'), snap('2026-05-01'),
    ])).toEqual([])
  })

  it('ignores a run shorter than 3', () => {
    expect(detectMisstampedMonthlyNavSnapshots([snap('2026-01-01'), snap('2026-02-01')])).toEqual([])
  })

  it('ignores day-01 snapshots from other sources (daily/manual)', () => {
    const mixed = [
      snap('2025-12-01', { _source: 'daily' }),
      snap('2026-01-01', { _source: 'daily' }),
      snap('2026-02-01', { _source: 'manual' }),
    ]
    expect(detectMisstampedMonthlyNavSnapshots(mixed)).toEqual([])
  })

  it('does not flag real daily snapshots that include a day-01 row', () => {
    const daily = [
      snap('2026-01-01'), snap('2026-01-02', { _source: 'daily' }),
      snap('2026-01-03', { _source: 'daily' }),
    ]
    expect(detectMisstampedMonthlyNavSnapshots(daily)).toEqual([])
  })

  it('breaks the run at a missing month and only flags runs of 3+', () => {
    const gapped = [
      snap('2025-10-01'), snap('2025-11-01'), // run of 2: not flagged
      snap('2026-01-01'), snap('2026-02-01'), snap('2026-03-01'), // run of 3
    ]
    const hits = detectMisstampedMonthlyNavSnapshots(gapped)
    expect(hits.map((h) => h.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })

  it('skips a re-stamp whose month-end date already has its own snapshot', () => {
    const withCollision = [...monthlyRun, snap('2026-01-31', { _source: 'daily' })]
    const hits = detectMisstampedMonthlyNavSnapshots(withCollision)
    expect(hits.map((h) => h.date)).not.toContain('2026-01-01')
    expect(hits).toHaveLength(3)
  })
})

describe('detectCrossSourceDuplicateTrades (FASE KG)', () => {
  const trade = (over = {}) => ({
    id: 'x', _source: 'ibkr', type: 'BUY', symbol: 'AAPL', date: '2026-01-15',
    totalAmount: 1500, ...over,
  })

  it('el caso real: el viaje sincroniza por API y despues sube el mismo XML', () => {
    const fromFile = trade({ id: '2026-01-15-AAPL-BUY-150000-T99', _ibkrTxnId: 'T99' })
    const fromApi = trade({ id: '2026-01-15-AAPL-BUY-150000' })
    const hits = detectCrossSourceDuplicateTrades([fromFile, fromApi])
    // Se borra la que NO tiene el id del broker, nunca la que si lo tiene.
    expect(hits.map((h) => h.id)).toEqual([fromApi.id])
  })

  it('sin pareja no marca nada: un usuario que solo sincroniza por API', () => {
    expect(detectCrossSourceDuplicateTrades([trade({ id: 'a' }), trade({ id: 'b', date: '2026-02-01' })])).toEqual([])
  })

  it('dos operaciones reales del archivo (cada una con su tradeID) no se tocan', () => {
    const a = trade({ id: 'a', _ibkrTxnId: 'T1' })
    const b = trade({ id: 'b', _ibkrTxnId: 'T2' })
    expect(detectCrossSourceDuplicateTrades([a, b])).toEqual([])
  })

  it('distinta fecha, simbolo, tipo o monto no son la misma operacion', () => {
    const withId = trade({ id: 'f', _ibkrTxnId: 'T1' })
    const otros = [
      trade({ id: 'a', date: '2026-01-16' }),
      trade({ id: 'b', symbol: 'MSFT' }),
      trade({ id: 'c', type: 'SELL' }),
      trade({ id: 'd', totalAmount: 1501 }),
    ]
    expect(detectCrossSourceDuplicateTrades([withId, ...otros])).toEqual([])
  })

  it('no toca lo manual ni lo que no es una operacion', () => {
    const withId = trade({ id: 'f', _ibkrTxnId: 'T1' })
    const manual = trade({ id: 'm', _source: 'manual' })
    const deposito = trade({ id: 'd', type: 'DEPOSIT', symbol: 'CASH' })
    expect(detectCrossSourceDuplicateTrades([withId, manual, deposito])).toEqual([])
  })

  it('freno de emergencia: mas de 1000 candidatas no borra nada', () => {
    const rows = [trade({ id: 'f', _ibkrTxnId: 'T1' })]
    for (let i = 0; i < 1001; i++) rows.push(trade({ id: `api-${i}` }))
    expect(detectCrossSourceDuplicateTrades(rows)).toEqual([])
  })
})

describe('detectAccountQualifiedIdDuplicates (FASE MO)', () => {
  // Un deposito de IBKR sin `transactionID` en la query: la unica forma de
  // distinguir dos cuentas es la cuenta misma.
  const dep = (over = {}) => ({
    _source: 'ibkr', type: 'DEPOSIT', symbol: 'CASH', date: '2026-01-20',
    totalAmount: 5000, _ibkrAccountId: 'U111', ...over,
  })
  const BASE = '2026-01-20-CASH-DEPOSIT-500000'

  it('borra el doc VIEJO cuando el nuevo es exactamente el mismo id mas la cuenta', () => {
    const viejo = dep({ id: BASE })
    const nuevo = dep({ id: `${BASE}-U111` })
    const hits = detectAccountQualifiedIdDuplicates([viejo, nuevo])
    expect(hits.map((h) => h.id)).toEqual([BASE])
  })

  it('el orden en que llegan no cambia cual sobrevive', () => {
    const viejo = dep({ id: BASE })
    const nuevo = dep({ id: `${BASE}-U111` })
    expect(detectAccountQualifiedIdDuplicates([nuevo, viejo]).map((h) => h.id)).toEqual([BASE])
  })

  // CONTROL NEGATIVO, y es el que sostiene todo el detector: dos depositos
  // REALES del mismo monto el mismo dia en cuentas distintas son dos cobros, y
  // con el arreglo del id ya viven en docs distintos. Ninguno es la version
  // vieja del otro (sus cuentas difieren), asi que no se toca nada.
  it('dos cuentas distintas con el mismo monto el mismo dia son dos depositos', () => {
    const a = dep({ id: `${BASE}-U111`, _ibkrAccountId: 'U111' })
    const b = dep({ id: `${BASE}-U222`, _ibkrAccountId: 'U222' })
    expect(detectAccountQualifiedIdDuplicates([a, b])).toEqual([])
  })

  // Sin la igualdad literal no se borra: una fila que solo se PAREZCA (misma
  // fecha, monto y cuenta) pero cuyo id no sea el del otro menos el sufijo no
  // es la version vieja de nadie.
  it('un id que no es exactamente el otro menos el sufijo no se toca', () => {
    const otro = dep({ id: 'algo-distinto' })
    const nuevo = dep({ id: `${BASE}-U111` })
    expect(detectAccountQualifiedIdDuplicates([otro, nuevo])).toEqual([])
  })

  it('sin ningun id ya calificado no hay contra que comparar: no borra nada', () => {
    expect(detectAccountQualifiedIdDuplicates([dep({ id: BASE })])).toEqual([])
  })

  it('una fila CON id del broker nunca entra: su llave nunca cambio', () => {
    const viejo = dep({ id: BASE, _ibkrTxnId: 'T9' })
    const nuevo = dep({ id: `${BASE}-U111`, _ibkrTxnId: 'T9' })
    expect(detectAccountQualifiedIdDuplicates([viejo, nuevo])).toEqual([])
  })

  it('una fila sin cuenta tampoco entra: su llave tampoco cambio', () => {
    const viejo = dep({ id: BASE, _ibkrAccountId: undefined })
    const nuevo = dep({ id: `${BASE}-U111` })
    expect(detectAccountQualifiedIdDuplicates([viejo, nuevo])).toEqual([])
  })

  it('no toca lo manual', () => {
    const viejo = dep({ id: BASE, _source: 'manual' })
    const nuevo = dep({ id: `${BASE}-U111`, _source: 'manual' })
    expect(detectAccountQualifiedIdDuplicates([viejo, nuevo])).toEqual([])
  })

  it('freno de emergencia: mas de 1000 candidatas no borra nada', () => {
    const rows = []
    for (let i = 0; i < 1001; i++) {
      const base = `2026-01-20-CASH-DEPOSIT-${500000 + i}`
      rows.push(dep({ id: base, totalAmount: 5000 + i / 100 }))
      rows.push(dep({ id: `${base}-U111`, totalAmount: 5000 + i / 100 }))
    }
    expect(detectAccountQualifiedIdDuplicates(rows)).toEqual([])
  })

  // Auto-auditoria de FASE MO: la primera version re-armaba la llave a mano y
  // aplicaba `Math.abs` a los centavos, asi que un deposito y un retiro del
  // MISMO monto el mismo dia caian en el mismo grupo y solo uno quedaba en el
  // mapa: el otro se quedaba sin revisar. Derivando los dos ids del ESCRITOR el
  // caso no existe, porque el signo entra a la llave igual que en el documento.
  it('un deposito y un retiro del mismo monto se resuelven cada uno por su lado', () => {
    const D = '2026-01-20-CASH-DEPOSIT-500000'
    const W = '2026-01-20-CASH-WITHDRAWAL--500000'
    const rows = [
      dep({ id: D, type: 'DEPOSIT', totalAmount: 5000 }),
      dep({ id: `${D}-U111`, type: 'DEPOSIT', totalAmount: 5000 }),
      dep({ id: W, type: 'WITHDRAWAL', totalAmount: -5000 }),
      dep({ id: `${W}-U111`, type: 'WITHDRAWAL', totalAmount: -5000 }),
    ]
    expect(detectAccountQualifiedIdDuplicates(rows).map((h) => h.id).sort()).toEqual([D, W].sort())
  })

  // Y la contraparte: se borra de MENOS antes que de mas. Un doc con una forma
  // de id que no reconocemos NO se toca, aunque el canonico exista al lado.
  it('un id de forma desconocida no se borra aunque el canonico exista', () => {
    const rows = [
      dep({ id: 'forma-vieja-de-otra-era' }),
      dep({ id: `${BASE}-U111` }),
    ]
    expect(detectAccountQualifiedIdDuplicates(rows)).toEqual([])
  })
})

describe('detectSameTxnIdAcrossDates (FASE MO)', () => {
  // El id de transaccion del broker pertenece a UN evento: verlo bajo dos
  // fechas distintas solo puede venir de que nosotros lo fechamos mal.
  const trade = (over = {}) => ({
    _source: 'ibkr', type: 'BUY', symbol: 'AAPL', totalAmount: 1500,
    _ibkrTxnId: 'T1', ...over,
  })

  it('conserva la fecha mas VIEJA y borra las copias posteriores', () => {
    const real = trade({ id: 'a', date: '2026-01-20' })
    const copia1 = trade({ id: 'b', date: '2026-08-29' })
    const copia2 = trade({ id: 'c', date: '2026-08-30' })
    const hits = detectSameTxnIdAcrossDates([copia2, real, copia1])
    expect(hits.map((h) => h.id).sort()).toEqual(['b', 'c'])
  })

  // CONTROL POSITIVO del limite: repetido en la MISMA fecha no es este bug.
  // Ahi el id del documento ya deduplica, asi que no hay nada que borrar.
  it('el mismo id de transaccion en la MISMA fecha no se toca', () => {
    const a = trade({ id: 'a', date: '2026-01-20' })
    const b = trade({ id: 'b', date: '2026-01-20' })
    expect(detectSameTxnIdAcrossDates([a, b])).toEqual([])
  })

  it('dos operaciones REALES distintas del mismo dia no se tocan', () => {
    const a = trade({ id: 'a', date: '2026-01-20', _ibkrTxnId: 'T1' })
    const b = trade({ id: 'b', date: '2026-01-20', _ibkrTxnId: 'T2' })
    expect(detectSameTxnIdAcrossDates([a, b])).toEqual([])
  })

  it('la misma operacion en dos fechas pero SIN id del broker no se toca', () => {
    const a = trade({ id: 'a', date: '2026-01-20', _ibkrTxnId: undefined })
    const b = trade({ id: 'b', date: '2026-08-30', _ibkrTxnId: undefined })
    expect(detectSameTxnIdAcrossDates([a, b])).toEqual([])
  })

  it('no toca lo manual', () => {
    const a = trade({ id: 'a', date: '2026-01-20', _source: 'manual' })
    const b = trade({ id: 'b', date: '2026-08-30', _source: 'manual' })
    expect(detectSameTxnIdAcrossDates([a, b])).toEqual([])
  })

  it('una fila sin fecha no puede probar nada y se ignora', () => {
    const a = trade({ id: 'a', date: '2026-01-20' })
    const b = trade({ id: 'b', date: undefined })
    expect(detectSameTxnIdAcrossDates([a, b])).toEqual([])
  })

  it('varios ids de transaccion se resuelven cada uno por su cuenta', () => {
    const rows = [
      trade({ id: 'a1', date: '2026-01-20', _ibkrTxnId: 'T1' }),
      trade({ id: 'a2', date: '2026-08-30', _ibkrTxnId: 'T1' }),
      trade({ id: 'b1', date: '2026-02-10', _ibkrTxnId: 'T2' }),
    ]
    expect(detectSameTxnIdAcrossDates(rows).map((h) => h.id)).toEqual(['a2'])
  })

  it('freno de emergencia: mas de 1000 copias no borra nada', () => {
    const rows = [trade({ id: 'real', date: '2026-01-20' })]
    for (let i = 0; i < 1001; i++) {
      rows.push(trade({ id: `c-${i}`, date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }))
    }
    // Todas menos la mas vieja quedarian marcadas: por encima del tope, nada.
    expect(detectSameTxnIdAcrossDates(rows)).toEqual([])
  })
})
