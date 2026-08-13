import { analyzeDataCompleteness } from '../dataCompleteness'

const NOW = '2026-07-09T12:00:00Z'

const bank = (over = {}) => ({
  id: 'b1', type: 'Bank', name: 'Cuenta Líquida', symbol: 'LIQ', institution: 'BI',
  quantity: 1, purchasePrice: 50000, currentPrice: 50000, currency: 'GTQ',
  acquisitionDate: '2024-12-01', createdAt: '2024-12-01T00:00:00Z', ...over,
})
const stock = (over = {}) => ({
  id: 's1', type: 'Stock', name: 'VOO', symbol: 'VOO', institution: 'IBKR-X',
  quantity: 10, purchasePrice: 400, currentPrice: 500, currency: 'USD',
  acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00Z', ...over,
})

const run = (items, transactions = [], lots = [], extra = {}) =>
  analyzeDataCompleteness({ items, transactions, lots, baseCurrency: 'USD', now: NOW, convert: (a) => a, ...extra })

const codes = (r) => r.findings.map((f) => f.code)
const byCode = (r, c) => r.findings.find((f) => f.code === c)

describe('no-history / partial-history', () => {
  it('flags a static balance with zero linked movements', () => {
    const r = run([bank()])
    const f = byCode(r, 'no-history')
    expect(f).toBeDefined()
    expect(f.severity).toBe('high')
    expect(f.itemId).toBe('b1')
    expect(f.action.kind).toBe('cashflow')
    expect(f.action.prefill).toMatchObject({ linkedId: 'b1', alreadyReflected: true })
  })

  it('a linked deposit clears no-history', () => {
    const tx = { type: 'DEPOSIT', date: '2024-12-01', totalAmount: 50000, currency: 'GTQ', _linkedItemId: 'b1' }
    const r = run([bank()], [tx])
    expect(codes(r)).not.toContain('no-history')
    expect(codes(r)).not.toContain('partial-history')
  })

  it('flags partial history when flows explain under half the balance', () => {
    const tx = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 10000, currency: 'GTQ', _linkedItemId: 'b1' }
    const r = run([bank()], [tx])
    const f = byCode(r, 'partial-history')
    expect(f).toBeDefined()
    expect(f.textEs).toContain('20%')
  })

  it('growth above 50% explained does NOT flag (compounding tolerance)', () => {
    const tx = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 35000, currency: 'GTQ', _linkedItemId: 'b1' }
    const r = run([bank()], [tx])
    expect(codes(r)).not.toContain('partial-history')
  })

  it('transfers in and dividend destinations count as explanation', () => {
    const txs = [
      { type: 'TRANSFER', date: '2025-01-01', totalAmount: 20000, currency: 'GTQ', _originItemId: 'x', _linkedItemId: 'b1' },
      { type: 'DIVIDEND', date: '2025-02-01', totalAmount: 10000, currency: 'GTQ', _linkedItemId: 'src', _destinationItemId: 'b1' },
    ]
    const r = run([bank()], txs)
    expect(codes(r)).not.toContain('no-history')
    // 20k transfer + 10k dividend = 30k of 50k = 60% explained → above the 50% bar
    expect(codes(r)).not.toContain('partial-history')
  })

  it('currency edge: USD deposits explain a GTQ balance via convert', () => {
    // 5000 USD ≈ 39000 GTQ (rate 7.8) → 78% explained → no finding
    const tx = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 5000, currency: 'USD', _linkedItemId: 'b1' }
    const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.8 : from === 'GTQ' && to === 'USD' ? a / 7.8 : a)
    const r = run([bank()], [tx], [], { baseCurrency: 'GTQ', convert })
    expect(codes(r)).not.toContain('partial-history')
    expect(codes(r)).not.toContain('no-history')
  })

  it('exempts broker-sourced, debt, excluded and dust items', () => {
    const r = run([
      bank({ id: 'x1', _source: 'ibkr' }),
      bank({ id: 'x2', isDebt: true }),
      bank({ id: 'x3', isExcludedFromNetWorth: true }),
      bank({ id: 'x4', purchasePrice: 50, currentPrice: 50 }),
    ])
    expect(codes(r)).not.toContain('no-history')
  })

  // The VITALI case (FASE DP): a balance with zero linked flows must not nag
  // once the user already answered "¿de dónde vino este dinero?" at creation
  // (AddAccountModal's "es dinero nuevo" toggle → `_newMoneyConfirmed`).
  describe('_newMoneyConfirmed', () => {
    it('suppresses no-history even with zero linked flows', () => {
      const r = run([bank({ _newMoneyConfirmed: true })])
      expect(codes(r)).not.toContain('no-history')
    })

    it('suppresses partial-history too, not just no-history', () => {
      const tx = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 10000, currency: 'GTQ', _linkedItemId: 'b1' }
      const r = run([bank({ _newMoneyConfirmed: true })], [tx])
      expect(codes(r)).not.toContain('partial-history')
    })

    it('does NOT suppress stale-value — a different question', () => {
      const old = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 50000, currency: 'GTQ', _linkedItemId: 'b1' }
      const r = run([bank({ _newMoneyConfirmed: true, acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00Z' })], [old])
      expect(codes(r)).toContain('stale-value')
    })

    it('an unconfirmed item right next to a confirmed one still gets flagged', () => {
      const r = run([bank({ id: 'confirmed', _newMoneyConfirmed: true }), bank({ id: 'unconfirmed' })])
      const findings = r.findings.filter((f) => f.code === 'no-history')
      expect(findings.map((f) => f.itemId)).toEqual(['unconfirmed'])
    })
  })
})

describe('uncovered-shares', () => {
  it('flags market quantity not covered by open lots', () => {
    const lots = [{ symbol: 'VOO', quantity: 4, status: 'open', acquisitionDate: '2025-01-01' }]
    const r = run([stock()], [], lots)
    const f = byCode(r, 'uncovered-shares')
    expect(f).toBeDefined()
    expect(f.textEs).toContain('6')
  })

  it('aggregates shared symbols across items (two BTC wallets, one lot pool)', () => {
    const a = stock({ id: 'c1', type: 'Crypto', symbol: 'BTC', name: 'Bitcoin', quantity: 0.6, currentPrice: 100000 })
    const b = stock({ id: 'c2', type: 'Crypto', symbol: 'BTC', name: 'OSMO wallet', quantity: 0.4, currentPrice: 100000 })
    const lots = [{ symbol: 'BTC', quantity: 1.0, status: 'open' }]
    const r = run([a, b], [], lots)
    expect(codes(r).filter((c) => c === 'uncovered-shares')).toHaveLength(0)
  })

  it('closed lots do not cover shares', () => {
    const lots = [{ symbol: 'VOO', quantity: 10, status: 'closed', closedDate: '2025-05-01' }]
    const r = run([stock()], [], lots)
    expect(byCode(r, 'uncovered-shares')).toBeDefined()
  })
})

describe('metadata checks', () => {
  it('flags missing acquisitionDate for manual items but NOT broker items', () => {
    // Broker items get their date from the sync/Excel import, not the user.
    const broker = run([bank({ acquisitionDate: '', _source: 'ibkr' })])
    expect(byCode(broker, 'no-acq-date')).toBeUndefined()
    const manual = run([bank({ acquisitionDate: '', _source: '' })])
    expect(byCode(manual, 'no-acq-date')).toBeDefined()
  })

  it('no-acq-date suggests the earliest LINKED transaction date, when one exists', () => {
    const tx = { type: 'DEPOSIT', date: '2024-03-15', totalAmount: 50000, currency: 'GTQ', _linkedItemId: 'b1' }
    const r = run([bank({ acquisitionDate: '', createdAt: '2024-12-01T00:00:00Z' })], [tx])
    const f = byCode(r, 'no-acq-date')
    expect(f.suggestion).toBeTruthy()
    expect(f.suggestion.patch).toEqual({ acquisitionDate: '2024-03-15' })
  })

  it('no-acq-date falls back to the account\'s own createdAt with no linked flow', () => {
    const r = run([bank({ acquisitionDate: '', createdAt: '2024-12-01T00:00:00Z' })])
    const f = byCode(r, 'no-acq-date')
    expect(f.suggestion.patch).toEqual({ acquisitionDate: '2024-12-01' })
  })

  it('no-acq-date has no suggestion at all when neither a flow nor createdAt exists', () => {
    const r = run([bank({ acquisitionDate: '', createdAt: '' })])
    const f = byCode(r, 'no-acq-date')
    expect(f.suggestion).toBeNull()
  })

  it('flags missing currency and institution', () => {
    const r = run([bank({ currency: '', institution: '' })])
    expect(codes(r)).toContain('no-currency')
    expect(codes(r)).toContain('no-institution')
  })

  it('flags income without months and without destination', () => {
    const r = run([bank({ incomeRate: 8, incomeMonths: [], dividendAction: 'cash', incomeDestination: '' })])
    expect(codes(r)).toContain('income-no-months')
    expect(codes(r)).toContain('income-no-dest')
  })

  it('income-no-months suggests the exact months real DIVIDEND/INTEREST payments landed in', () => {
    const src = bank({ id: 'b1', incomeRate: 8, incomeMonths: [], dividendAction: 'cash', incomeDestination: '' })
    const txs = [
      { type: 'DIVIDEND', date: '2025-05-15', totalAmount: 240, currency: 'GTQ', _linkedItemId: 'b1' },
      { type: 'DIVIDEND', date: '2025-11-15', totalAmount: 240, currency: 'GTQ', _linkedItemId: 'b1' },
    ]
    const r = run([src], txs)
    const f = byCode(r, 'income-no-months')
    expect(f.suggestion.patch).toEqual({ incomeMonths: [4, 10], incomeMonthsExplicit: true })
  })

  it('income-no-months has no suggestion when no payment history exists yet', () => {
    const r = run([bank({ incomeRate: 8, incomeMonths: [], dividendAction: 'cash', incomeDestination: '' })])
    expect(byCode(r, 'income-no-months').suggestion).toBeNull()
  })

  it('income-no-dest suggests the account real DIVIDEND payments already landed in', () => {
    const src = bank({ id: 'b1', incomeRate: 8, incomeMonths: [1], dividendAction: 'cash', incomeDestination: '' })
    const dest = bank({ id: 'liq', symbol: 'LIQ2', name: 'Fondo Líquido' })
    const tx = { type: 'DIVIDEND', date: '2025-05-15', totalAmount: 240, currency: 'GTQ', _linkedItemId: 'b1', _destinationItemId: 'liq' }
    const r = run([src, dest], [tx])
    const f = byCode(r, 'income-no-dest')
    expect(f.suggestion.patch).toEqual({ incomeDestination: 'liq' })
  })

  it('reinvest income needs no destination', () => {
    const r = run([bank({ incomeRate: 8, incomeMonths: [6, 12], dividendAction: 'reinvest' })])
    expect(codes(r)).not.toContain('income-no-dest')
    expect(codes(r)).not.toContain('income-no-months')
  })

  it('flags broken income destination links, resolves by id/symbol/name', () => {
    const dest = bank({ id: 'd9', symbol: 'CASH', name: 'Caja' })
    const okById = bank({ id: 'a', incomeRate: 5, incomeMonths: [1], incomeDestination: 'd9' })
    const okBySym = bank({ id: 'b2', incomeRate: 5, incomeMonths: [1], incomeDestination: 'cash' })
    const broken = bank({ id: 'c', incomeRate: 5, incomeMonths: [1], incomeDestination: 'deleted-id' })
    const r = run([dest, okById, okBySym, broken])
    const brokenFindings = r.findings.filter((f) => f.code === 'broken-link')
    expect(brokenFindings).toHaveLength(1)
    expect(brokenFindings[0].itemId).toBe('c')
  })

  it('broken-link always suggests clearing the dead reference (nothing real to point at instead)', () => {
    const broken = bank({ id: 'c', incomeRate: 5, incomeMonths: [1], incomeDestination: 'deleted-id' })
    const r = run([broken])
    const f = byCode(r, 'broken-link')
    expect(f.suggestion.patch).toEqual({ incomeDestination: null })
  })

  it('flags past maturity', () => {
    const r = run([bank({ maturityDate: '2026-01-01' })])
    expect(byCode(r, 'past-maturity')).toBeDefined()
  })

  it('flags stale value but skips illiquid (NotificationCenter covers those)', () => {
    const old = { type: 'DEPOSIT', date: '2025-01-01', totalAmount: 50000, currency: 'GTQ', _linkedItemId: 'b1' }
    const stale = run([bank({ acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00Z' })], [old])
    expect(codes(stale)).toContain('stale-value')
    const illiquid = run([bank({ acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00Z', isIlliquid: true })], [old])
    expect(codes(illiquid)).not.toContain('stale-value')
  })

  it('flags duplicate suspects sharing symbol+institution, and names both items', () => {
    const r = run([bank({ id: 'p1' }), bank({ id: 'p2', name: 'Cuenta Líquida 2' })])
    const f = byCode(r, 'dup-suspect')
    expect(f).toBeDefined()
    expect(f.action.itemIds.sort()).toEqual(['p1', 'p2'])
  })

  it('"no son iguales", once BOTH items carry the flag, stops the finding for good', () => {
    const confirmed = [
      bank({ id: 'p1', _dupConfirmedDistinct: true }),
      bank({ id: 'p2', name: 'Cuenta Líquida 2', _dupConfirmedDistinct: true }),
    ]
    expect(codes(run(confirmed))).not.toContain('dup-suspect')
  })

  it('one confirmed item is not enough: the pair still re-asks', () => {
    const half = [
      bank({ id: 'p1', _dupConfirmedDistinct: true }),
      bank({ id: 'p2', name: 'Cuenta Líquida 2' }),
    ]
    expect(codes(run(half))).toContain('dup-suspect')
  })

  it('a NEW item sharing the pair\'s symbol+institution re-triggers, even though the old two were confirmed', () => {
    const withNewcomer = [
      bank({ id: 'p1', _dupConfirmedDistinct: true }),
      bank({ id: 'p2', name: 'Cuenta Líquida 2', _dupConfirmedDistinct: true }),
      bank({ id: 'p3', name: 'Cuenta Líquida 3' }),
    ]
    const f = byCode(run(withNewcomer), 'dup-suspect')
    expect(f).toBeDefined()
    expect(f.action.itemIds.sort()).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('no-market-price: a real holding silently worth $0', () => {
  it('flags a market asset with quantity but no current price', () => {
    const r = run([stock({ currentPrice: 0 })])
    const f = byCode(r, 'no-market-price')
    expect(f).toBeDefined()
    expect(f.severity).toBe('high')
  })

  it('is NOT hidden by the dust floor: a $0-priced holding never clears MIN_BALANCE_BASE on its own', () => {
    // The item's own bug (currentPrice: 0) makes its balance 0, which is
    // exactly why this check has to run before the dust-floor `continue`.
    const r = run([stock({ currentPrice: 0, quantity: 500 })])
    expect(codes(r)).toContain('no-market-price')
  })

  it('does not flag broker items: their price comes from the sync, not the user', () => {
    const r = run([stock({ currentPrice: 0, _source: 'ibkr' })])
    expect(codes(r)).not.toContain('no-market-price')
  })

  it('does not flag a zero-quantity position (nothing held, nothing to price)', () => {
    const r = run([stock({ currentPrice: 0, quantity: 0 })])
    expect(codes(r)).not.toContain('no-market-price')
  })

  it('a properly priced holding does not trigger it', () => {
    const r = run([stock()])
    expect(codes(r)).not.toContain('no-market-price')
  })

  // Real bug report: a market item's currentPrice is resolved LIVE by symbol
  // (useMarketPrices), never persisted to the raw Firestore doc — so
  // it.currentPrice being 0/absent is the NORMAL state for a fine, working
  // position, not evidence of anything wrong. Every stock/crypto holding in
  // a real portfolio flagged here until marketPrices gave the check a way to
  // tell "genuinely no price" apart from "not the field this module reads".
  it('does NOT flag a market item with no stored currentPrice when a live price resolves for its symbol', () => {
    const r = run([stock({ currentPrice: 0 })], [], [], { marketPrices: { VOO: { price: 500 } } })
    expect(codes(r)).not.toContain('no-market-price')
  })

  it('still flags it when marketPrices is passed but has no entry for this symbol', () => {
    const r = run([stock({ currentPrice: 0 })], [], [], { marketPrices: { AAPL: { price: 220 } } })
    expect(codes(r)).toContain('no-market-price')
  })

  it('symbol lookup is case-insensitive, same as useMarketPrices\' own dual lookup', () => {
    const r = run([stock({ currentPrice: 0, symbol: 'voo' })], [], [], { marketPrices: { VOO: { price: 500 } } })
    expect(codes(r)).not.toContain('no-market-price')
  })
})

describe('no-cost-basis: a priced holding with no purchase price', () => {
  it('flags it when currentPrice exists but purchasePrice does not', () => {
    const r = run([stock({ purchasePrice: 0 })])
    expect(byCode(r, 'no-cost-basis')).toBeDefined()
  })

  it('does not double up with no-market-price: an unpriced holding gets ONLY that finding', () => {
    const r = run([stock({ currentPrice: 0, purchasePrice: 0 })])
    expect(codes(r)).toContain('no-market-price')
    expect(codes(r)).not.toContain('no-cost-basis')
  })

  it('a live-resolved price (not stored) is enough to gate this check too', () => {
    const r = run([stock({ currentPrice: 0, purchasePrice: 0 })], [], [], { marketPrices: { VOO: { price: 500 } } })
    expect(codes(r)).toContain('no-cost-basis')
    expect(codes(r)).not.toContain('no-market-price')
  })

  it('a fully priced holding does not trigger it', () => {
    const r = run([stock()])
    expect(codes(r)).not.toContain('no-cost-basis')
  })
})

describe('no-symbol: a market asset that cannot be price-synced or matched', () => {
  it('flags a stock/crypto/fund with no symbol', () => {
    const r = run([stock({ symbol: '' })])
    expect(byCode(r, 'no-symbol')).toBeDefined()
  })

  it('a bank-like item with no symbol is fine: nothing to sync', () => {
    const r = run([bank({ symbol: '' })])
    expect(codes(r)).not.toContain('no-symbol')
  })
})

describe('bad-maturity-date: maturity before acquisition', () => {
  it('flags a maturity date earlier than the acquisition date', () => {
    const r = run([bank({ acquisitionDate: '2025-06-01', maturityDate: '2025-01-01' })])
    const f = byCode(r, 'bad-maturity-date')
    expect(f).toBeDefined()
    expect(f.severity).toBe('medium')
  })

  it('a maturity date after acquisition (even if already past) does not trigger it', () => {
    const r = run([bank({ acquisitionDate: '2025-01-01', maturityDate: '2025-06-01' })])
    expect(codes(r)).not.toContain('bad-maturity-date')
    // Still legitimately flagged by the existing past-maturity check.
    expect(codes(r)).toContain('past-maturity')
  })

  it('no maturity date at all does not trigger it', () => {
    const r = run([bank({ acquisitionDate: '2025-01-01', maturityDate: '' })])
    expect(codes(r)).not.toContain('bad-maturity-date')
  })
})

describe('scores and ordering', () => {
  it('stable ids, severity ordering, and weighted global score', () => {
    const clean = bank({
      id: 'ok', symbol: 'OK2', institution: 'Otro banco', purchasePrice: 100000, currentPrice: 100000,
    })
    const cleanTx = { type: 'DEPOSIT', date: '2026-06-01', totalAmount: 100000, currency: 'GTQ', _linkedItemId: 'ok' }
    const dirty = bank({ id: 'bad', symbol: 'BAD', institution: 'X', acquisitionDate: '' })
    const r = run([clean, dirty], [cleanTx])
    expect(r.findings[0].severity).toBe('high')
    expect(r.findings.every((f) => f.id === `${f.code}:${f.itemId || 'global'}`)).toBe(true)
    expect(r.itemScores.ok).toBe(100)
    expect(r.itemScores.bad).toBeLessThan(100)
    expect(r.globalScore).toBeGreaterThan(0)
    expect(r.globalScore).toBeLessThan(100)
  })

  it('empty portfolio scores 100 with no findings', () => {
    const r = run([])
    expect(r.findings).toHaveLength(0)
    expect(r.globalScore).toBe(100)
  })
})

// FASE HV11. El aviso de "sin precio actual" se resolvía emparejando por
// SÍMBOLO, y dos posiciones del mismo activo con símbolos distintos daban
// respuestas distintas: el usuario tenía dos Bitcoin, el Spreadsheet imprimía
// bien los dos al mismo precio, y el aviso decía que uno se contaba en $0.
describe('no-market-price contra el precio que la app ya muestra', () => {
  const base = {
    id: 'btc2', name: 'Bitcoin', type: 'Crypto', currency: 'USD',
    quantity: 0.00179416, purchasePrice: 0, currentPrice: 0,
  }
  const run = (extra, opts) => analyzeDataCompleteness({
    items: [{ ...base, ...extra }], transactions: [], lots: [], baseCurrency: 'USD', ...opts,
  }).findings.filter((f) => f.code === 'no-market-price')

  it('sin símbolo que matchee, el mapa por símbolo no alcanza y avisa', () => {
    expect(run({ symbol: '' }, { marketPrices: { BTC: { price: 63411 } } })).toHaveLength(1)
  })

  it('con el precio resuelto por id, no avisa aunque el símbolo no matchee', () => {
    expect(run({ symbol: '' }, {
      marketPrices: { BTC: { price: 63411 } },
      resolvedPrices: { btc2: 63411 },
    })).toHaveLength(0)
  })

  it('un precio resuelto en cero no tapa un activo que de verdad no tiene precio', () => {
    expect(run({ symbol: '' }, { resolvedPrices: { btc2: 0 } })).toHaveLength(1)
  })

  it('sin el mapa nuevo, se comporta igual que antes', () => {
    expect(run({ symbol: 'BTC' }, { marketPrices: { BTC: { price: 63411 } } })).toHaveLength(0)
  })
})

describe('no-market-price no grita lobo mientras los precios vienen en camino', () => {
  const sinPrecio = {
    id: 'btc3', name: 'Bitcoin', symbol: 'BTC', type: 'Crypto', currency: 'USD',
    quantity: 0.001, purchasePrice: 0, currentPrice: 0,
  }
  const run = (opts) => analyzeDataCompleteness({
    items: [sinPrecio], transactions: [], lots: [], baseCurrency: 'USD', ...opts,
  }).findings.filter((f) => f.code === 'no-market-price')

  it('con la vuelta de precios en curso, no avisa', () => {
    expect(run({ pricesReady: false })).toHaveLength(0)
  })

  it('en cuanto termina, un activo de verdad sin precio sí avisa', () => {
    expect(run({ pricesReady: true })).toHaveLength(1)
  })

  it('por default avisa, para no cambiarle el comportamiento a callers viejos', () => {
    expect(run({})).toHaveLength(1)
  })
})
