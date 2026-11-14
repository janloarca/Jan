// Descartes de "Chispu te sugiere": una sola definición de dónde viven.
// Los lee la card de sugerencias Y el contador "· N pendientes" del header;
// con dos copias el contador seguía diciendo "1 pendiente" después de
// descartar todo, y su clic no llevaba a ninguna acción.

export const DISMISS_KEY = 'chispudo-dismissed-suggestions'
export const DISMISS_EVENT = 'chispudo-dismissed-changed'

export function readDismissed() {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch { return new Set() }
}

export function writeDismissed(set) {
  try {
    if (set.size === 0) localStorage.removeItem(DISMISS_KEY)
    else localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]))
  } catch {}
  try { window.dispatchEvent(new Event(DISMISS_EVENT)) } catch {}
}

// Deshacer un descarte (FASE SB): quita los ids del conjunto. Pura; quien la
// llama decide si escribir el resultado.
export function withoutIds(set, ids) {
  const next = new Set(set)
  for (const id of ids || []) next.delete(id)
  return next
}

export function undismiss(ids) {
  writeDismissed(withoutIds(readDismissed(), ids))
}

export function countPending(findings, dismissed) {
  return (findings || []).filter((f) => !dismissed.has(f.id)).length
}

// FASE RY. "24 datos por completar" no cambiaba nunca y no decía QUÉ falta.
// El desglose por tipo (mismo conjunto que countPending, para que la suma
// siempre sea el número visible) va en el título del contador, así que se
// lee qué se puede completar sin tener que bajar hasta las sugerencias.
const PENDING_LABELS = {
  'no-country': ['sin país', 'no country'],
  'no-acq-date': ['sin fecha de compra', 'no purchase date'],
  'no-history': ['sin origen del dinero', 'no money origin'],
  'partial-history': ['origen del dinero incompleto', 'partial money origin'],
  'flows-exceed-balance': ['movimientos que no cuadran', 'movements that do not add up'],
  'stale-value': ['valor sin actualizar', 'stale value'],
  'valuation-review-due': ['valuación por revisar', 'valuation to review'],
  'no-industry': ['sin industria', 'no industry'],
  'industry-too-generic': ['industria muy general', 'industry too generic'],
  'no-investment-style': ['sin estilo de inversión', 'no investment style'],
  'no-cost-basis': ['sin costo de compra', 'no cost basis'],
  'no-currency': ['sin moneda', 'no currency'],
  'no-symbol': ['sin símbolo', 'no symbol'],
  'no-institution': ['sin institución', 'no institution'],
  'no-market-price': ['sin precio', 'no price'],
  'no-market-price-stale': ['precio quieto', 'stale price'],
  'uncovered-shares': ['unidades sin lote', 'units without a lot'],
  'income-no-months': ['ingreso sin calendario', 'income without schedule'],
  'income-no-dest': ['ingreso sin cuenta destino', 'income without destination'],
  'income-never-received': ['ingreso nunca registrado', 'income never recorded'],
  'income-mismatch': ['ingreso que no cuadra con el broker', 'income not matching the broker'],
  'bond-no-income': ['bono sin cupón', 'bond without coupon'],
  'past-maturity': ['vencimiento pasado', 'past maturity'],
  'bad-maturity-date': ['fecha de vencimiento inválida', 'invalid maturity date'],
  'past-expected-exit': ['salida esperada pasada', 'past expected exit'],
  'dup-suspect': ['posible duplicado', 'possible duplicate'],
  'broken-link-income': ['vínculo roto', 'broken link'],
  'broken-link-debt': ['vínculo roto', 'broken link'],
  'liquid-yield': ['rendimiento de cuenta líquida por confirmar', 'liquid account yield to confirm'],
  'implausible-rate': ['tasa poco creíble', 'implausible rate'],
  'negative-residual': ['falta un retiro', 'missing withdrawal'],
}

export function pendingBreakdown(findings, dismissed, lang = 'es') {
  const counts = new Map()
  for (const f of findings || []) {
    if (!f || dismissed.has(f.id)) continue
    const pair = PENDING_LABELS[f.code]
    const label = pair ? pair[lang === 'es' ? 0 : 1] : (lang === 'es' ? 'otros datos' : 'other data')
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)
}
