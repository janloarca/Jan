import { reconcileStatement, enrichmentFor } from '../statementReconcile'
import { matchStatement } from '../statementMatcher'

// A parsed card-statement row, as lib/parsers/guateCardStatements.js emits it.
const row = (date, amount, description, over = {}) => ({
  date, amount, description, merchant: description,
  currency: 'GTQ', type: 'EXPENSE', category: 'Otros Gastos',
  kind: 'purchase', source: 'card_import', ...over,
})
// An already-recorded transaction (auto-captured or hand-typed).
const rec = (id, date, amount, description, over = {}) => ({
  id, date, amount, description, merchant: description,
  currency: 'GTQ', type: 'EXPENSE', category: 'Otros Gastos', ...over,
})

describe('two identical charges stay two charges', () => {
  // The real case: a G&T statement carries the same Q20 parking twice on the
  // same day, and the parser already proved both are real by reconciling
  // against the statement's printed totals.
  const twice = [row('2026-07-30', 20, 'PARQUEO FONTABELLA'), row('2026-07-30', 20, 'PARQUEO FONTABELLA')]

  it('imports both when nothing is recorded yet', () => {
    const r = reconcileStatement(twice, [])
    expect(r.newTxs).toHaveLength(2)
    expect(r.confirmed).toHaveLength(0)
  })

  it('one recorded row confirms ONE of them, the other is still new', () => {
    const r = reconcileStatement(twice, [rec('a', '2026-07-30', 20, 'PARQUEO FONTABELLA')])
    expect(r.confirmed).toHaveLength(1)
    expect(r.newTxs).toHaveLength(1)
  })

  it('two recorded rows confirm both, adding nothing', () => {
    const r = reconcileStatement(twice, [
      rec('a', '2026-07-30', 20, 'PARQUEO FONTABELLA'),
      rec('b', '2026-07-30', 20, 'PARQUEO FONTABELLA'),
    ])
    expect(r.confirmed).toHaveLength(2)
    expect(r.newTxs).toHaveLength(0)
    // Each statement row claims a DIFFERENT recorded row.
    expect(new Set(r.confirmed.map((c) => c.match.id)).size).toBe(2)
  })

  it('the old matcher collapsed them, which is why this engine exists', () => {
    expect(matchStatement(twice, []).newTxs).toHaveLength(1)
  })
})

describe('currency is never crossed', () => {
  it('a $200 charge does not match a Q200 one', () => {
    const r = reconcileStatement(
      [row('2026-07-19', 200, 'BET365', { currency: 'USD' })],
      [rec('q', '2026-07-19', 200, 'Gasolinera')]
    )
    expect(r.newTxs).toHaveLength(1)
    expect(r.confirmed).toHaveLength(0)
  })

  it('same currency and merchant does match', () => {
    const r = reconcileStatement(
      [row('2026-07-19', 200, 'BET365', { currency: 'USD' })],
      [rec('u', '2026-07-19', 200, 'BET365', { currency: 'USD' })]
    )
    expect(r.confirmed).toHaveLength(1)
  })

  it('the old matcher is currency-blind no more', () => {
    const usd = [{ date: '2026-07-19', amount: 200, type: 'EXPENSE', currency: 'USD', description: 'BET365' }]
    const gtq = [{ date: '2026-07-19', amount: 200, type: 'EXPENSE', currency: 'GTQ', description: 'Gasolinera' }]
    expect(matchStatement(usd, gtq).newTxs).toHaveLength(1)
  })
})

describe('adjusted amounts: tip and fuel pre-authorization', () => {
  it('a settled amount below the Apple Pay authorization goes to review, not to a duplicate', () => {
    // Pump authorizes Q400, the bank settles Q385.50.
    const r = reconcileStatement(
      [row('2026-07-16', 385.5, 'PUMA ENTRE PUENTES')],
      [rec('a', '2026-07-16', 400, 'PUMA ENTRE PUENTES', { _source: 'auto_shortcut' })]
    )
    expect(r.newTxs).toHaveLength(0)
    expect(r.review).toHaveLength(1)
    expect(r.review[0].relation).toBe('adjusted')
    expect(r.review[0].defaultSame).toBe(true) // strong merchant match
  })

  it('a settled amount above it (restaurant tip) behaves the same', () => {
    const r = reconcileStatement(
      [row('2026-07-25', 170.5, 'ARTE Y GASTRONOMIA')],
      [rec('a', '2026-07-25', 155, 'ARTE Y GASTRONOMIA', { _source: 'auto_shortcut' })]
    )
    expect(r.review).toHaveLength(1)
  })

  it('a different purchase at the same merchant is NOT an adjustment', () => {
    // Q19 and Q42 at the same café: outside the adjustment band, so both stand.
    const r = reconcileStatement(
      [row('2026-07-13', 42, 'CAFE BARISTA')],
      [rec('a', '2026-07-13', 19, 'CAFE BARISTA')]
    )
    expect(r.newTxs).toHaveLength(1)
    expect(r.review).toHaveLength(0)
  })

  it('a large swing is never an adjustment even if the ratio fits', () => {
    const r = reconcileStatement(
      [row('2026-07-15', 5074.02, 'EEGSA')],
      [rec('a', '2026-07-15', 4000, 'EEGSA')]
    )
    expect(r.newTxs).toHaveLength(1)
  })

  it('an adjusted amount with a weak merchant match defaults to NOT the same', () => {
    const r = reconcileStatement(
      [row('2026-07-16', 90, 'PARQUEO FONTABELLA')],
      [rec('a', '2026-07-16', 80, 'PARQUEO CAYALA')]
    )
    if (r.review.length) expect(r.review[0].defaultSame).toBe(false)
    else expect(r.newTxs).toHaveLength(1)
  })
})

describe('posting lag and date windows', () => {
  it('matches across the 2-day posting lag these statements really have', () => {
    const r = reconcileStatement(
      [row('2026-07-08', 80, 'PARQUEO FONTABELLA')],
      [rec('a', '2026-07-10', 80, 'PARQUEO FONTABELLA', { _source: 'auto_email' })]
    )
    expect(r.confirmed).toHaveLength(1)
  })

  it('does not reach a week away', () => {
    const r = reconcileStatement(
      [row('2026-07-08', 80, 'PARQUEO FONTABELLA')],
      [rec('a', '2026-07-20', 80, 'PARQUEO FONTABELLA')]
    )
    expect(r.newTxs).toHaveLength(1)
  })

  it('amount and date coincide but the merchant is unreadable: review, not silent merge', () => {
    const r = reconcileStatement(
      [row('2026-07-08', 80, 'PARQUEO FONTABELLA')],
      [rec('a', '2026-07-08', 80, 'ZZQX 4471')]
    )
    expect(r.review).toHaveLength(1)
    expect(r.confirmed).toHaveLength(0)
  })
})

describe('what the statement teaches a row we already had', () => {
  it('corrects the amount to the settled one and reports the change', () => {
    const { updates, changes } = enrichmentFor(row('2026-07-16', 385.5, 'PUMA'), rec('a', '2026-07-16', 400, 'PUMA'))
    expect(updates.amount).toBe(385.5)
    expect(changes.find((c) => c.field === 'amount')).toEqual({ field: 'amount', from: 400, to: 385.5 })
  })

  it('adds the facts only the statement has', () => {
    const { updates } = enrichmentFor(
      row('2026-07-16', 80, 'ISHOP', { postedDate: '2026-07-18', installment: { num: 22, of: 36 }, location: '4AV 12-59' }),
      rec('a', '2026-07-16', 80, 'ISHOP')
    )
    expect(updates.postedDate).toBe('2026-07-18')
    expect(updates.installment).toEqual({ num: 22, of: 36 })
    expect(updates.location).toBe('4AV 12-59')
    expect(updates._confirmedBy).toBe('statement')
  })

  it('never overwrites a category the user already reviewed', () => {
    const { updates } = enrichmentFor(
      row('2026-07-16', 80, 'RALLY PADEL', { category: 'Entretenimiento' }),
      rec('a', '2026-07-16', 80, 'RALLY PADEL', { category: 'Salud', _needsReview: false })
    )
    expect(updates.category).toBeUndefined()
  })

  it('fills in a category the user never looked at', () => {
    const { updates } = enrichmentFor(
      row('2026-07-16', 80, 'RALLY PADEL', { category: 'Entretenimiento' }),
      rec('a', '2026-07-16', 80, 'RALLY PADEL', { category: 'Otros Gastos', _needsReview: true })
    )
    expect(updates.category).toBe('Entretenimiento')
    expect(updates._needsReview).toBe(false)
  })

  it('keeps the GPS location the Shortcut captured', () => {
    const existing = rec('a', '2026-07-16', 80, 'PARQUEO', { location: 'Zona 10', coords: { lat: 14.6, lon: -90.5 } })
    const { updates } = enrichmentFor(row('2026-07-16', 80, 'PARQUEO', { location: '4AV 12-59' }), existing)
    expect(updates.location).toBeUndefined()
    expect(updates.coords).toBeUndefined()
  })

  it('leaves the description alone (Wallet reads better than the bank truncation)', () => {
    const { updates } = enrichmentFor(
      row('2026-08-03', 17, 'RALLY PADEL'),
      rec('a', '2026-08-03', 17, 'Rally Padel Guatemala')
    )
    expect(updates.description).toBeUndefined()
  })

  it('reports a date correction, because it can move a month total', () => {
    const { updates, changes } = enrichmentFor(row('2026-07-31', 50, 'X'), rec('a', '2026-08-01', 50, 'X'))
    expect(updates.date).toBe('2026-07-31')
    expect(changes.find((c) => c.field === 'date')).toBeTruthy()
  })
})

describe('mix and match across all three capture methods', () => {
  it('confirms shortcut rows, email rows and manual rows alike, and adds the rest', () => {
    const statement = [
      row('2026-08-03', 17, 'RALLY PADEL'),
      row('2026-07-16', 400, 'PUMA ENTRE PUENTES'),
      row('2026-07-25', 70.4, 'EPA RAMBLA 10'),
      row('2026-07-16', 251.9, 'SUSHI ITTO CAYALA'),
    ]
    const existing = [
      rec('s1', '2026-08-03', 17, 'Rally Padel Guatemala', { _source: 'auto_shortcut' }),
      rec('e1', '2026-07-16', 400, 'PUMA ENTRE PUENTES', { _source: 'auto_email' }),
      rec('m1', '2026-07-25', 70.4, 'EPA Rambla'),
    ]
    const r = reconcileStatement(statement, existing)
    expect(r.confirmed).toHaveLength(3)
    expect(r.newTxs).toHaveLength(1)
    expect(r.newTxs[0].description).toBe('SUSHI ITTO CAYALA')
    expect(r.orphans).toHaveLength(0)
  })

  it('flags a recorded charge the statement does not contain (the double-capture signature)', () => {
    const r = reconcileStatement(
      [row('2026-07-10', 50, 'CAFE SAUL'), row('2026-07-20', 60, 'SUSHI ITTO')],
      [
        rec('ok', '2026-07-10', 50, 'CAFE SAUL', { _source: 'auto_shortcut' }),
        rec('ghost', '2026-07-15', 999, 'COBRO QUE EL BANCO NO TIENE', { _source: 'auto_email' }),
      ]
    )
    expect(r.confirmed).toHaveLength(1)
    expect(r.orphans.map((o) => o.id)).toEqual(['ghost'])
  })

  it('ignores recorded rows outside the statement window', () => {
    const r = reconcileStatement(
      [row('2026-07-10', 50, 'CAFE SAUL')],
      [rec('old', '2026-01-01', 999, 'Algo viejo')]
    )
    expect(r.orphans).toHaveLength(0)
  })
})

describe('guards', () => {
  it('handles empty and malformed input without throwing', () => {
    expect(reconcileStatement([], []).newTxs).toEqual([])
    expect(reconcileStatement(null, null).newTxs).toEqual([])
    expect(reconcileStatement([row('2026-07-10', 50, 'A')], null).newTxs).toHaveLength(1)
  })

  it('never matches an expense to an income', () => {
    const r = reconcileStatement(
      [row('2026-07-10', 50, 'DEVOLUCION', { type: 'INCOME' })],
      [rec('a', '2026-07-10', 50, 'DEVOLUCION')]
    )
    expect(r.newTxs).toHaveLength(1)
  })

  it('a recorded row is claimed at most once', () => {
    const r = reconcileStatement(
      [row('2026-07-10', 50, 'CAFE SAUL'), row('2026-07-10', 50, 'CAFE SAUL'), row('2026-07-10', 50, 'CAFE SAUL')],
      [rec('only', '2026-07-10', 50, 'CAFE SAUL')]
    )
    expect(r.confirmed).toHaveLength(1)
    expect(r.newTxs).toHaveLength(2)
  })

  it('a merchant name too short to compare goes to review, never a silent merge', () => {
    // descSimilarity only counts tokens of 3+ characters, so a one-letter
    // description carries no evidence at all: amount and date alone must not
    // be enough to merge two rows.
    const r = reconcileStatement([row('2026-07-10', 50, 'A')], [rec('a', '2026-07-10', 50, 'A')])
    expect(r.confirmed).toHaveLength(0)
    expect(r.review).toHaveLength(1)
  })
})
