import { normalizeWalletName, buildWalletOptions, addSavedWallet } from '../customWallets'

// "Otra wallet" in the crypto-by-address sync: the typed name becomes the
// item's institution and must persist as a select option (deduped, clean).
describe('normalizeWalletName', () => {
  it('trims, collapses inner whitespace and caps length', () => {
    expect(normalizeWalletName('  Phantom   Wallet ')).toBe('Phantom Wallet')
    expect(normalizeWalletName('x'.repeat(40))).toHaveLength(30)
  })

  it('returns empty string for blank or missing input', () => {
    expect(normalizeWalletName('')).toBe('')
    expect(normalizeWalletName('   ')).toBe('')
    expect(normalizeWalletName(null)).toBe('')
    expect(normalizeWalletName(undefined)).toBe('')
  })
})

describe('buildWalletOptions', () => {
  it('appends saved wallets after the base custodies', () => {
    expect(buildWalletOptions(['Ledger', 'Exchange'], ['Phantom', 'Tangem']))
      .toEqual(['Ledger', 'Exchange', 'Phantom', 'Tangem'])
  })

  it('never duplicates a base custody, even with different casing', () => {
    expect(buildWalletOptions(['Ledger', 'Exchange'], ['ledger', 'Phantom']))
      .toEqual(['Ledger', 'Exchange', 'Phantom'])
  })

  it('skips junk entries and normalizes names', () => {
    expect(buildWalletOptions(['Ledger'], [null, '  ', '  MetaMask  ']))
      .toEqual(['Ledger', 'MetaMask'])
  })
})

describe('addSavedWallet', () => {
  it('appends a new wallet name', () => {
    expect(addSavedWallet(['Phantom'], 'Tangem')).toEqual(['Phantom', 'Tangem'])
  })

  it('returns the identical array for blanks and case-insensitive duplicates', () => {
    const cur = ['Phantom']
    expect(addSavedWallet(cur, 'phantom')).toBe(cur)
    expect(addSavedWallet(cur, '  Phantom ')).toBe(cur)
    expect(addSavedWallet(cur, '   ')).toBe(cur)
    expect(addSavedWallet(cur, null)).toBe(cur)
  })

  it('starts a fresh list when nothing was saved yet', () => {
    expect(addSavedWallet(undefined, 'Phantom')).toEqual(['Phantom'])
  })
})
