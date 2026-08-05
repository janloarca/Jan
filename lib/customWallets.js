// Custom wallet names for the crypto-by-address sync ("Otra wallet"): the user
// types which wallet the address lives in (Phantom, MetaMask, Tangem...) and
// that name becomes the item's institution AND a saved select option for next
// time (persisted in settings._customWallets by the caller).
export function normalizeWalletName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30)
}

// Select options = base custodies + saved custom wallets, deduped
// case-insensitively (a saved "ledger" must not duplicate the built-in
// "Ledger"). Junk entries (blank/null) are skipped.
export function buildWalletOptions(base, saved) {
  const opts = [...(base || [])]
  for (const w of saved || []) {
    const n = normalizeWalletName(w)
    if (n && !opts.some((o) => o.toLowerCase() === n.toLowerCase())) opts.push(n)
  }
  return opts
}

// Append a freshly typed wallet to the saved list. Returns the SAME array
// (identity) when the name is blank or already saved, so the caller can skip
// the settings write with a simple === check.
export function addSavedWallet(saved, name) {
  const cur = Array.isArray(saved) ? saved : []
  const n = normalizeWalletName(name)
  if (!n) return cur
  if (cur.some((w) => normalizeWalletName(w).toLowerCase() === n.toLowerCase())) return cur
  return [...cur, n]
}
