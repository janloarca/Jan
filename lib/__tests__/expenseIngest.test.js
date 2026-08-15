import { normalizeExpenseInput, expenseDocId, findNearDuplicate } from '../expenseIngest'
import { extractIngestToken } from '../emailIngest'

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

describe('normalizeExpenseInput', () => {
  it('normalizes a Shortcut payload', () => {
    const input = normalizeExpenseInput({
      amount: '17.00', currency: 'gtq', merchant: '  Rally  Padel Guatemala ',
      date: '2026-08-03', lat: 14.57, lon: -90.48, source: 'shortcut',
    })
    expect(input).toMatchObject({
      amount: 17, currency: 'GTQ', merchant: 'Rally Padel Guatemala',
      date: '2026-08-03', source: 'shortcut', type: 'EXPENSE',
      coords: { lat: 14.57, lon: -90.48 },
    })
  })

  it('rejects amounts that are not real money', () => {
    expect(normalizeExpenseInput({ amount: 0 }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: -5 }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: 'abc' }).error).toBe('INVALID_AMOUNT')
    expect(normalizeExpenseInput({ amount: 99_999_999 }).error).toBe('AMOUNT_TOO_LARGE')
  })

  it('parses a decimal comma the same way every import path does', () => {
    expect(normalizeExpenseInput({ amount: '150,25' }).amount).toBe(150.25)
  })

  it('clamps a future date to today instead of dropping the expense', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(normalizeExpenseInput({ amount: 10, date: '2099-01-01' }).date).toBe(today)
  })

  it('defaults to today when the date is junk', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(normalizeExpenseInput({ amount: 10, date: 'not a date' }).date).toBe(today)
  })

  it('drops out-of-range coordinates', () => {
    expect(normalizeExpenseInput({ amount: 10, lat: 999, lon: -90 }).coords).toBeNull()
    expect(normalizeExpenseInput({ amount: 10 }).coords).toBeNull()
  })

  it('only accepts a known source', () => {
    expect(normalizeExpenseInput({ amount: 10, source: 'hacker' }).source).toBe('shortcut')
    expect(normalizeExpenseInput({ amount: 10, source: 'email' }).source).toBe('email')
  })

  it('keeps a 4-digit card tail and ignores anything else', () => {
    expect(normalizeExpenseInput({ amount: 10, last4: '4821' }).last4).toBe('4821')
    expect(normalizeExpenseInput({ amount: 10, last4: '482100' }).last4).toBeNull()
  })
})

describe('expenseDocId', () => {
  it('is stable for the same event, so a retry is a no-op', () => {
    const input = normalizeExpenseInput({ amount: 17, merchant: 'Rally Padel', date: '2026-08-03' })
    expect(expenseDocId(input)).toBe(expenseDocId({ ...input }))
  })

  it('changes when the amount changes', () => {
    const a = normalizeExpenseInput({ amount: 17, merchant: 'Rally Padel', date: '2026-08-03' })
    const b = normalizeExpenseInput({ amount: 18, merchant: 'Rally Padel', date: '2026-08-03' })
    expect(expenseDocId(a)).not.toBe(expenseDocId(b))
  })

  it('honors a client-supplied id over the derived key', () => {
    const a = normalizeExpenseInput({ amount: 17, merchant: 'A', date: '2026-08-03', clientId: 'abc' })
    const b = normalizeExpenseInput({ amount: 99, merchant: 'B', date: '2026-01-01', clientId: 'abc' })
    expect(expenseDocId(a)).toBe(expenseDocId(b))
  })
})

describe('findNearDuplicate', () => {
  const input = normalizeExpenseInput({
    amount: 17, currency: 'GTQ', merchant: 'RALLY PADEL GUATEMALA', date: '2026-08-03', source: 'email',
  })

  it('catches the same charge captured by the other path', () => {
    // Path A saw the Apple Pay event, path C then sees the forwarded alert.
    const existing = [{ id: 'x', amount: 17, currency: 'GTQ', type: 'EXPENSE', merchant: 'Rally Padel', _source: 'auto_shortcut' }]
    expect(findNearDuplicate(input, existing)).toBeTruthy()
  })

  it('catches an expense the user already typed by hand', () => {
    const existing = [{ id: 'm', amount: 17, currency: 'GTQ', type: 'EXPENSE', description: 'Rally Padel Guatemala' }]
    expect(findNearDuplicate(input, existing)).toBeTruthy()
  })

  it('does not merge two different charges of the same amount', () => {
    const existing = [{ id: 'y', amount: 17, currency: 'GTQ', type: 'EXPENSE', merchant: 'Panaderia San Martin' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('does not merge across currencies', () => {
    const existing = [{ id: 'z', amount: 17, currency: 'USD', type: 'EXPENSE', merchant: 'Rally Padel' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('does not merge an expense into an income', () => {
    const existing = [{ id: 'i', amount: 17, currency: 'GTQ', type: 'INCOME', merchant: 'Rally Padel' }]
    expect(findNearDuplicate(input, existing)).toBeNull()
  })

  it('matches on amount alone when neither side names a merchant', () => {
    const blind = normalizeExpenseInput({ amount: 17, currency: 'GTQ', date: '2026-08-03' })
    expect(findNearDuplicate(blind, [{ id: 'q', amount: 17, currency: 'GTQ', type: 'EXPENSE' }])).toBeTruthy()
  })
})

describe('extractIngestToken', () => {
  it('reads the token from the forwarding header, not from To:', () => {
    // Gmail auto-forwarding leaves the original To: intact and records the real
    // recipient in Delivered-To. Reading To: here would find nothing.
    const headers = new Map([
      ['to', 'janmarcof@gmail.com'],
      ['delivered-to', `gastos+${TOKEN}@chispu.xyz`],
    ])
    expect(extractIngestToken(headers)).toBe(TOKEN)
  })

  it('falls back to To: for a manual forward', () => {
    expect(extractIngestToken({ to: `Gastos <gastos+${TOKEN}@chispu.xyz>` })).toBe(TOKEN)
  })

  it('is case insensitive on the token', () => {
    expect(extractIngestToken({ to: `gastos+${TOKEN.toUpperCase()}@chispu.xyz` })).toBe(TOKEN)
  })

  it('returns null for an address with no token', () => {
    expect(extractIngestToken({ to: 'gastos@chispu.xyz' })).toBeNull()
    expect(extractIngestToken({})).toBeNull()
  })

  it('rejects a malformed token instead of half-matching it', () => {
    expect(extractIngestToken({ to: 'gastos+notatoken@chispu.xyz' })).toBeNull()
    expect(extractIngestToken({ to: 'gastos+abc123@chispu.xyz' })).toBeNull()
  })
})
