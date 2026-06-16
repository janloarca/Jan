export const SEMANTIC = {
  positive: '#34d399',
  negative: '#FF453A',
  warning:  '#FF9F0A',
  action:   '#0A84FF',
}

// Categorical palette for allocation charts. Distinct, intuitive hues —
// crypto is bitcoin-orange. Kept clear of pure action-blue (#0A84FF) and
// money-green (emerald) so categorical data never reads as a status signal.
export const CATEGORY = {
  stocks:       { bg: '#6366f1', badge: 'bg-indigo-500/20 text-indigo-400' },
  crypto:       { bg: '#f7931a', badge: 'bg-orange-500/20 text-orange-400' },
  bonds:        { bg: '#8b5cf6', badge: 'bg-violet-500/20 text-violet-400' },
  funds:        { bg: '#a78bfa', badge: 'bg-purple-400/20 text-purple-300' },
  banks:        { bg: '#94a3b8', badge: 'bg-slate-400/20 text-slate-400' },
  realestate:   { bg: '#14b8a6', badge: 'bg-teal-500/20 text-teal-300' },
  alternatives: { bg: '#f472b6', badge: 'bg-pink-400/20 text-pink-300' },
  receivables:  { bg: '#22d3ee', badge: 'bg-cyan-400/20 text-cyan-300' },
  debts:        { bg: '#fb7185', badge: 'bg-rose-400/20 text-rose-300' },
  other:        { bg: '#cbd5e1', badge: 'bg-slate-300/20 text-slate-400' },
}

export const CHART_PALETTE = [
  '#6366f1', '#d946ef', '#8b5cf6', '#fb923c', '#f472b6',
  '#22d3ee', '#a78bfa', '#94a3b8', '#cbd5e1', '#818cf8',
]

export const INVESTMENT_CLASS_COLORS = {
  renta_variable: '#6366f1',
  renta_fija:     '#8b5cf6',
  patrimonio_vc:  '#fb923c',
  debts:          '#fb7185',
}

// Financial Health categories — one distinct hue each so the user can tell
// the four dimensions apart: liquidity=blue, diversification=green,
// growth=turquoise, debt=orange.
export const HEALTH = {
  liquidity:       { bar: 'bg-sky-500',     text: 'text-sky-400' },
  diversification: { bar: 'bg-emerald-500', text: 'text-emerald-400' },
  growth:          { bar: 'bg-teal-500',    text: 'text-teal-400' },
  debt:            { bar: 'bg-orange-500',  text: 'text-orange-400' },
}
