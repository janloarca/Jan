// Merchant → category classifier for auto-captured expenses (iPhone Shortcut +
// forwarded bank alerts). Pure module + tests.
//
// Three tiers, in order:
//   1. User rules   — learned when you fix a category in the app. Always win.
//   2. Built-in rules — merchant keywords, Guatemala-flavored.
//   3. Default       — 'Otros Gastos', flagged `_needsReview` so the UI can nudge.
//
// Every category returned MUST exist in FINANCE_CATEGORIES.EXPENSE, otherwise the
// breakdown/insights would silently drop the transaction into an unknown group.

import { normalizeDesc } from './statementMatcher'
import { merchantRuleKey } from './merchantLabels'

// Built-in keyword rules. `any` matches when ANY token/phrase is contained in the
// normalized merchant string. Ordered: the first match wins, so put specific
// merchants above generic words.
export const MERCHANT_RULES = [
  { category: 'Alimentación', any: ['super', 'walmart', 'paiz', 'la torre', 'despensa', 'maxi', 'fresh market', 'pricesmart', 'carniceria', 'panaderia', 'mercado', 'grocery'] },
  // Generic shapes only, never one-off merchant names: a specific store is
  // what the learned per-merchant rules are for (POST /api/ingest 'learn'),
  // and stuffing this table with them would overfit it to one person's city.
  // 'uber eats' lives HERE and not in Transporte: rule order decides, and the
  // bare 'uber' rule below would otherwise claim every food delivery.
  { category: 'Alimentación', any: ['restaurante', 'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'burger', 'pizza', 'pizzeria', 'little caesars', 'taco', 'taqueria', 'sushi', 'pollo campero', 'campero', 'kfc', 'subway', 'wendy', 'domino', 'uber eats', 'ebigo', 'bar ', 'cerveceria', 'brewing', 'brewery', 'pub', 'cocina', 'comedor', 'gastronomia', 'churrasqueria', 'marisqueria', 'heladeria', 'pasteleria', 'reposteria', 'rosticeria', 'deli', 'bakery'] },
  // 'est de serv' / 'estacion de servicio' is how Guatemalan fuel stations are
  // named on a statement; 'park ' as a whole word catches "PARK-CENTRO"
  // without swallowing "parking", which has its own needle.
  { category: 'Transporte', any: ['uber', 'indriver', 'didi', 'cabify', 'taxi', 'gasolinera', 'estacion de servicio', 'est de serv', 'puma', 'shell', 'texaco', 'uno ', 'combustible', 'gasolina', 'fuel', 'parqueo', 'parking', 'park ', 'peaje', 'tag ', 'emetra'] },
  { category: 'Transporte', any: ['aerolinea', 'airlines', 'avianca', 'copa air', 'american air', 'united air', 'volaris', 'spirit', 'aeropuerto'] },
  { category: 'Suscripciones', any: ['netflix', 'spotify', 'disney', 'hbo', 'max ', 'youtube premium', 'apple.com/bill', 'apple com bill', 'itunes', 'icloud', 'google storage', 'google one', 'amazon prime', 'prime video', 'openai', 'chatgpt', 'anthropic', 'claude', 'adobe', 'microsoft', 'dropbox', 'notion', 'canva', 'github', 'patreon', 'substack'] },
  { category: 'Servicios', any: ['eegsa', 'energuate', 'empagua', 'claro', 'tigo', 'movistar', 'internet', 'telefon', 'cable', 'agua ', 'luz ', 'electric'] },
  { category: 'Vivienda', any: ['alquiler', 'renta ', 'rent ', 'condominio', 'mantenimiento', 'hipoteca', 'mortgage', 'ferreteria', 'cemaco', 'novex', 'epa '] },
  { category: 'Salud', any: ['farmacia', 'farma ', 'galeno', 'batres', 'cruz verde', 'hospital', 'clinica', 'medico', 'doctor', 'dental', 'dentista', 'laboratorio', 'optica', 'seguro medico'] },
  { category: 'Educación', any: ['colegio', 'universidad', 'ufm', 'uvg', 'landivar', 'del valle', 'marroquin', 'escuela', 'curso', 'academia', 'udemy', 'coursera', 'duolingo', 'libreria', 'sophos'] },
  { category: 'Entretenimiento', any: ['cine', 'cinepolis', 'cinemark', 'padel', 'paddle', 'gimnasio', 'gym', 'smart fit', 'crossfit', 'yoga', 'club', 'golf', 'tenis', 'futbol', 'boliche', 'concierto', 'teatro', 'museo', 'hotel', 'hostal', 'hostales', 'resort', 'airbnb', 'booking', 'bet365', 'casino', 'steam', 'playstation', 'xbox', 'nintendo'] },
  { category: 'Compras', any: ['amazon', 'mercado libre', 'shein', 'temu', 'aliexpress', 'ebay', 'zara', 'h m ', 'nike', 'adidas', 'siman', 'oakland mall', 'pradera', 'miraflores', 'tienda', 'boutique', 'shop', 'store'] },
  { category: 'Transferencia Enviada', any: ['transferencia', 'transfer', 'envio de dinero', 'western union', 'remesa', 'zelle', 'paypal'] },
  // Below Salud on purpose: 'seguro medico' is health spending, and rule order
  // decides. A premium was the single largest line of a real month (USD
  // 5,166.46 to SEGUROS UNIVERSALES) and landed in "Otros Gastos".
  { category: 'Seguros', any: ['seguros ', 'seguro ', 'aseguradora', 'poliza', 'insurance', 'assurance'] },
  // 'declaraguate' is the portal every Guatemalan taxpayer files through and
  // 'iusi' the municipal property tax, so both are generic, not one merchant.
  { category: 'Impuestos', any: ['declaraguate', 'impuesto', 'iusi', 'isr ', 'sat ', 'tesoreria'] },
  { category: 'Comisiones', any: ['comision', 'quasi cash', 'sobregiro', 'anualidad', 'cuota de manejo', 'cargo por servicio', 'mantenimiento de cuenta'] },
]

// A rule matches when any of its needles is contained in the normalized merchant.
// Needles with a trailing space (e.g. 'uno ', 'bar ') only match as a whole word
// prefix, which keeps 'uno' from firing on 'desayuno' and 'bar' on 'barberia'.
function ruleMatches(rule, normalized) {
  const padded = ` ${normalized} `
  return rule.any.some((needle) => {
    const n = normalizeDesc(needle)
    if (!n) return false
    return needle.endsWith(' ') ? padded.includes(` ${n} `) : normalized.includes(n)
  })
}

// User rules: { match: '<normalized merchant fragment>', category }. Stored per
// user at users/{uid}/settings/ingest.rules and learned from manual corrections.
// The longest match wins so 'super mall' beats 'super'.
function matchUserRule(rules, normalized) {
  let best = null
  for (const r of rules || []) {
    const needle = normalizeDesc(r?.match)
    const category = r?.category
    if (!needle || !category) continue
    if (!normalized.includes(needle)) continue
    if (!best || needle.length > best.needle.length) best = { needle, category }
  }
  return best
}

// Returns { category, confidence, matchedBy } where confidence is:
//   'user'    — a rule the user taught us
//   'rule'    — a built-in keyword rule
//   'unknown' — nothing matched; caller should flag the tx for review
export function categorizeExpense(merchant, { rules = [] } = {}) {
  const normalized = normalizeDesc(merchant)
  if (!normalized) return { category: 'Otros Gastos', confidence: 'unknown', matchedBy: null }

  const userHit = matchUserRule(rules, normalized)
  if (userHit) return { category: userHit.category, confidence: 'user', matchedBy: userHit.needle }

  for (const rule of MERCHANT_RULES) {
    if (ruleMatches(rule, normalized)) {
      return { category: rule.category, confidence: 'rule', matchedBy: rule.any.find((n) => ruleMatches({ any: [n] }, normalized)) || null }
    }
  }

  return { category: 'Otros Gastos', confidence: 'unknown', matchedBy: null }
}

// The rule we persist when the user re-categorizes a machine-described expense.
//
// Keyed on the merchant with the bank's trailing noise trimmed (see
// merchantRuleKey): the SAME place shows up as "FINCA FELIZ GT" on one
// statement and "FINCA FELIZ" on another, and a rule learned from the long form
// never matched the short one, so the user had to teach the same merchant twice.
//
// `label` is what the user called it in their own words ("mecánico"). It is not
// used for matching — the category does that — but it is what lets the app show
// "DONALD · mecánico" later instead of a bank code nobody recognises.
export function ruleFromCorrection(merchant, category, label = null) {
  const match = merchantRuleKey(merchant)
  if (!match || !category) return null
  const clean = label ? String(label).replace(/\s+/g, ' ').trim().slice(0, 40) : null
  return { match, category, ...(clean ? { label: clean } : {}), createdAt: new Date().toISOString() }
}
