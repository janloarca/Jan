import { analyzeDataCompleteness } from '../dataCompleteness'
import { getItemValue } from '../../components/dashboard/utils'

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
      // FASE JU: la forma REAL de "excluido del patrimonio" es una cuenta por
      // cobrar sin countInNetWorth (isExcludedFromNetWorth de utils.js). Este
      // fixture traía una propiedad `isExcludedFromNetWorth` en el ítem, que
      // ningún ítem real lleva: el test pasaba describiendo una interfaz que no
      // existe, y en producción el filtro no filtraba nada.
      bank({ id: 'x3', isReceivable: true }),
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
  // FASE LQ2: estos tres fijaban la INTERFAZ DEL BUG. El fixture trae
  // `purchasePrice: 400`, así que con `currentPrice: 0` la app entera (vía
  // `getItemPrice`, la misma cascada que usa `getItemValue`) lo valúa en 4,000
  // y NO en cero, mientras el aviso afirmaba "se está contando en $0". Corregir
  // el valor esperado es lo correcto acá, a diferencia del candado de 3.94%:
  // describía el defecto, no un invariante.
  it('sin cotización viva pero CON precio de compra: se dice que el precio quedó quieto, no que valga $0', () => {
    const r = run([stock({ currentPrice: 0 })])
    expect(codes(r)).not.toContain('no-market-price')
    const f = byCode(r, 'no-market-price-stale')
    expect(f).toBeDefined()
    expect(f.severity).toBe('medium')
    expect(f.textEs).toContain('400')
    expect(f.textEs).not.toContain('$0')
  })

  it('sin NINGUNA fuente de precio sí desaparece del patrimonio, y ahí sigue siendo high', () => {
    const r = run([stock({ currentPrice: 0, purchasePrice: 0 })])
    const f = byCode(r, 'no-market-price')
    expect(f).toBeDefined()
    expect(f.severity).toBe('high')
    expect(f.textEs).toContain('$0')
  })

  it('el aviso nunca contradice a la función que de verdad valúa el activo', () => {
    // Invariante: si se emite `no-market-price`, `getItemValue` TIENE que dar
    // 0. Es lo que su propio texto afirma.
    for (const over of [{ currentPrice: 0 }, { currentPrice: 0, purchasePrice: 0 }, { currentPrice: 0, purchasePrice: 0, price: 12 }]) {
      const it = stock(over)
      if (codes(run([it])).includes('no-market-price')) expect(getItemValue(it)).toBe(0)
    }
  })

  it('is NOT hidden by the dust floor: a $0-priced holding never clears MIN_BALANCE_BASE on its own', () => {
    // The item's own bug (no price at all) makes its balance 0, which is
    // exactly why this check has to run before the dust-floor `continue`.
    const r = run([stock({ currentPrice: 0, purchasePrice: 0, quantity: 500 })])
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
    // Sigue avisando, y ahora dice CUÁL de las dos cosas pasa: con precio de
    // compra el activo se cuenta a ese precio (quieto), no en $0.
    const r = run([stock({ currentPrice: 0 })], [], [], { marketPrices: { AAPL: { price: 220 } } })
    expect(codes(r)).toContain('no-market-price-stale')
    const sinRespaldo = run([stock({ currentPrice: 0, purchasePrice: 0 })], [], [], { marketPrices: { AAPL: { price: 220 } } })
    expect(codes(sinRespaldo)).toContain('no-market-price')
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
      // `assetCountry` cierra el hallazgo `no-country`: sin él este ítem tendría
      // un hueco real y el 100 de abajo dejaría de medir lo que el test quiere
      // medir ("un ítem sin huecos vale 100").
      assetCountry: 'GT',
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


// Los dos hallazgos que el usuario nombró y que hasta hoy no existían: nada
// pedía el país, y nada preguntaba si un activo que dice rendir ya había pagado.
describe('no-country', () => {
  it('dispara en un activo cuyo "símbolo" no es un ticker real', () => {
    const r = run([bank({ id: 'b1', assetCountry: '' })])
    expect(r.findings.some((f) => f.code === 'no-country' && f.itemId === 'b1')).toBe(true)
  })

  it('con país declarado no dice nada', () => {
    const r = run([bank({ id: 'b1', assetCountry: 'GT' })])
    expect(r.findings.some((f) => f.code === 'no-country')).toBe(false)
  })

  // Para un ticker real el país se resuelve del símbolo y la respuesta es
  // correcta: preguntarlo sería ruido en cada acción de la cartera.
  it('NO dispara en un activo de mercado', () => {
    const r = run([stock({ id: 's1', assetCountry: '' })])
    expect(r.findings.some((f) => f.code === 'no-country')).toBe(false)
  })
})

describe('income-never-received', () => {
  const yielding = (over = {}) => bank({
    id: 'y1', incomeRate: 5, acquisitionDate: '2024-01-01', createdAt: '2024-01-01T00:00:00Z',
    assetCountry: 'GT', incomeMonths: [0, 6], incomeDestination: 'y1', ...over,
  })

  it('pregunta cuando el activo dice rendir y no tiene ni un pago', () => {
    const r = run([yielding()])
    expect(r.findings.some((f) => f.code === 'income-never-received' && f.itemId === 'y1')).toBe(true)
  })

  it('con un pago registrado se calla', () => {
    const paid = { type: 'DIVIDEND', date: '2025-01-15', totalAmount: 500, currency: 'GTQ', _linkedItemId: 'y1' }
    const r = run([yielding()], [paid])
    expect(r.findings.some((f) => f.code === 'income-never-received')).toBe(false)
  })

  // Recién creado no pudo haber cobrado: preguntarlo el mismo día es ruido.
  it('no dispara en un activo recién dado de alta', () => {
    const r = run([yielding({ acquisitionDate: '2026-08-20', createdAt: '2026-08-20T00:00:00Z' })])
    expect(r.findings.some((f) => f.code === 'income-never-received')).toBe(false)
  })

  it('un activo que no declara rendimiento no se pregunta', () => {
    const r = run([bank({ id: 'y1', assetCountry: 'GT' })])
    expect(r.findings.some((f) => f.code === 'income-never-received')).toBe(false)
  })
})

describe('broken-link cubre el préstamo vinculado de un inmueble', () => {
  const casa = (over = {}) => ({
    id: 'casa', type: 'RealEstate', name: 'Casa', symbol: 'CASA', institution: 'Propio',
    quantity: 1, purchasePrice: 85000, currentPrice: 85000, currency: 'USD',
    acquisitionDate: '2024-01-01', createdAt: '2024-01-01T00:00:00Z', assetCountry: 'US',
    _newMoneyConfirmed: true, ...over,
  })

  it('avisa cuando el préstamo vinculado ya no existe', () => {
    const r = run([casa({ linkedDebtId: 'borrada' })])
    const f = r.findings.find((x) => x.code === 'broken-link' && x.itemId === 'casa')
    expect(f).toBeTruthy()
    expect(f.suggestion.patch).toEqual({ linkedDebtId: null })
  })

  it('con el préstamo presente no dice nada', () => {
    const hipo = { id: 'hipo', type: 'Debt', name: 'Hipoteca', isDebt: true, quantity: 1, purchasePrice: 40000, currency: 'USD' }
    const r = run([casa({ linkedDebtId: 'hipo' }), hipo])
    expect(r.findings.some((x) => x.code === 'broken-link')).toBe(false)
  })
})

// ⛔ El monto que el hallazgo OFRECE tiene que ser el que falta, no el saldo.
//
// `partial-history` dispara cuando los movimientos ya explican hasta el 49% del
// saldo. Sin `amount` en el prefill, CashFlowModal cae a su respaldo y prellena
// el saldo COMPLETO, así que aceptarlo registra un aporte por el total ENCIMA
// de los que ya están en el archivo: los aportes se cuentan dos veces, con eso
// se infla "invertido" y se desinfla el retorno. El número correcto es el hueco,
// que el propio hallazgo ya calcula para escribirlo en su texto.
describe('el hallazgo de historia parcial ofrece el HUECO, no el saldo', () => {
  const cuenta = (over = {}) => ({
    id: 'fq', type: 'Bank', name: 'Fondo Líquido Q', symbol: 'FQ', institution: 'IDC',
    quantity: 1, purchasePrice: 10000, currentPrice: 10000, currency: 'GTQ',
    acquisitionDate: '2024-01-01', createdAt: '2024-01-01T00:00:00Z', ...over,
  })
  // 4,000 explicados de 10,000: 40% < 50%, así que el hallazgo dispara.
  const txs = [{ type: 'DEPOSIT', date: '2024-02-01', totalAmount: 4000, currency: 'GTQ', _linkedItemId: 'fq' }]

  it('prellena lo que falta y NO el saldo entero', () => {
    const f = byCode(run([cuenta()], txs), 'partial-history')
    expect(f).toBeTruthy()
    expect(f.action.prefill.amount).toBeCloseTo(6000, 6)
    expect(f.action.prefill.amount).not.toBeCloseTo(10000, 6)
  })

  it('el monto ofrecido coincide con el que el propio texto anuncia', () => {
    const f = byCode(run([cuenta()], txs), 'partial-history')
    // El texto dice "faltan aportes por GTQ 6,000.00": el número que se ofrece
    // no puede ser otro que ese, o la pantalla se contradice consigo misma.
    expect(f.textEs).toContain('6,000')
    expect(String(f.action.prefill.amount)).toBe('6000')
  })

  // El hermano sin NINGÚN movimiento sí debe ofrecer el saldo completo: ahí no
  // hay nada ya registrado que pueda contarse dos veces.
  it('sin ningun movimiento, el hallazgo es otro y no lleva monto propio', () => {
    const f = byCode(run([cuenta()], []), 'no-history')
    expect(f).toBeTruthy()
    expect(f.action.prefill.amount).toBeUndefined()
  })
})

// FASE LM — una cantidad fraccionaria de cripto no se redondea a "0 unidades"
// (anotado desde FASE EZ4: fmt() usa Math.round, correcto para dinero y falso
// para cantidades). El texto del hallazgo tiene que decir 0.5, no 0.
describe('uncovered-shares: cantidades fraccionarias', () => {
  it('0.5 BTC sin lote imprime 0.5, nunca 0', () => {
    const btc = stock({ id: 'c1', type: 'Crypto', symbol: 'BTC', name: 'Bitcoin', quantity: 0.5, currentPrice: 100000 })
    const r = run([btc], [], [])
    const f = byCode(r, 'uncovered-shares')
    expect(f).toBeDefined()
    expect(f.textEs).toContain('0.5')
    expect(f.textEs).not.toMatch(/\b0 de 0\b/)
  })
})

describe('FASE OE: el destino de una transferencia cruzada se lee con transferCredit', () => {
  const RATES = { USD: 1, GTQ: 7.7 }
  const convert = (amt, from, to) => (!from || !to || from === to ? amt : amt / RATES[from] * RATES[to])
  const gtq = () => bank({ id: 'gtq', name: 'Fondo Q', purchasePrice: 7500, currentPrice: 7500, currency: 'GTQ', _newMoneyConfirmed: true })
  const usd = () => bank({ id: 'usd', name: 'Cuenta USD', purchasePrice: 1000, currentPrice: 1000, currency: 'USD', institution: 'BI', acquisitionDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' })
  // Q2,500 salieron y el banco acredito $300 (su spread), no los $324.68 de la tasa de la app.
  const tr = { id: 't', type: 'TRANSFER', date: '2026-06-01', totalAmount: 2500, currency: 'GTQ', _originItemId: 'gtq', _linkedItemId: 'usd', _toAmount: 300, _toCurrency: 'USD' }

  it('lo que falta por explicar se mide contra lo que de verdad llego (700), no contra la tasa de la app (675.32)', () => {
    const r = run([gtq(), usd()], [tr], [], { convert })
    const f = byCode(r, 'partial-history')
    expect(f.itemId).toBe('usd')
    expect(f.action.prefill.amount).toBeCloseTo(700, 2)
    expect(f.textEs).toContain('USD 700')
  })
  it('una fila vieja sin _toAmount cae al monto enviado convertido, como siempre', () => {
    const { _toAmount, _toCurrency, ...old } = tr
    const r = run([gtq(), usd()], [old], [], { convert })
    expect(byCode(r, 'partial-history').action.prefill.amount).toBeCloseTo(1000 - 2500 / 7.7, 2)
  })
})
