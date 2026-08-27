// Best-guess currency for a bank/broker name, typed by the user in free text.
// Shared by AddAccountModal (main flow), GuidedAssetSteps (the guided first-run
// flow), InlineCreateAccount (the "create destination account on the spot"
// mini-form) and the bank-alert parser, so every surface auto-detects the same
// way instead of silently defaulting everything to USD.
export const INSTITUTION_CURRENCY = {
  bi: 'GTQ', banrural: 'GTQ', bam: 'GTQ', industrial: 'GTQ', bantrab: 'GTQ',
  'g&t': 'GTQ', gyt: 'GTQ', ficohsa: 'GTQ', promerica: 'GTQ',
  banamex: 'MXN', banorte: 'MXN', azteca: 'MXN', 'hsbc mx': 'MXN',
  bancolombia: 'COP', davivienda: 'COP', 'bbva co': 'COP', nequi: 'COP',
  bcp: 'PEN', interbank: 'PEN', scotiabank: 'PEN',
  itau: 'BRL', bradesco: 'BRL', nubank: 'BRL',
  'banco estado': 'CLP', bci: 'CLP', 'santander cl': 'CLP',
  chase: 'USD', 'wells fargo': 'USD', citi: 'USD', bofa: 'USD',
  schwab: 'USD', fidelity: 'USD', vanguard: 'USD', ibkr: 'USD',
  barclays: 'GBP', lloyds: 'GBP', 'hsbc uk': 'GBP',
}

// A short key can NOT be matched as a bare substring. `bi` (Banco Industrial,
// Guatemala) is two letters, and a naive `includes` found it inside
// "bancolombia" -- so Colombia's largest bank resolved to GTQ, and its own COP
// entry further down the map was unreachable. Same family as the Flex parser
// bug (FASE GH): a needle needs a boundary, not just a position.
//
// So: keys of 3 characters or fewer must land on a word boundary, longer keys
// may still match inside a word ("banamex" has to win inside "citibanamex"),
// and the whole map is tried longest-key-first so the most specific name wins
// ("bancolombia" before "bi", "banamex" before "citi").
const SHORT_KEY_MAX = 3

function isWordChar(ch) {
  return !!ch && /[a-z0-9]/.test(ch)
}

function matchesAtBoundary(haystack, key) {
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(key, from)
    if (at === -1) return false
    const before = at === 0 ? '' : haystack[at - 1]
    const after = haystack[at + key.length] || ''
    if (!isWordChar(before) && !isWordChar(after)) return true
    from = at
  }
}

const KEYS_BY_SPECIFICITY = Object.keys(INSTITUTION_CURRENCY).sort((a, b) => b.length - a.length)

export function detectCurrency(institution) {
  if (!institution) return null
  const lower = institution.toLowerCase().trim()
  for (const key of KEYS_BY_SPECIFICITY) {
    const hit = key.length <= SHORT_KEY_MAX
      ? matchesAtBoundary(lower, key)
      : lower.includes(key)
    if (hit) return INSTITUTION_CURRENCY[key]
  }
  return null
}
