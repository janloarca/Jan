// Best-guess currency for a bank/broker name, typed by the user in free text.
// Shared by AddAccountModal (main flow) and InlineCreateAccount (the "create
// destination account on the spot" mini-form) so both auto-detect the same
// way instead of the inline flow silently defaulting everything to USD.
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

export function detectCurrency(institution) {
  if (!institution) return null
  const lower = institution.toLowerCase().trim()
  for (const [key, cur] of Object.entries(INSTITUTION_CURRENCY)) {
    if (lower.includes(key) || lower === key) return cur
  }
  return null
}
