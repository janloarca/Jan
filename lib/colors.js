export const SEMANTIC = {
  positive: '#059669',
  negative: '#DC2626',
  warning:  '#D97706',
  action:   '#4F46E5',
}

// Fixed asset-class colors — consistent across every chart, bar and badge.
export const CATEGORY = {
  stocks:       { bg: '#6366F1', badge: 'bg-indigo-500/20 text-indigo-400' },
  bonds:        { bg: '#0891B2', badge: 'bg-cyan-500/20 text-cyan-400' },
  funds:        { bg: '#7C3AED', badge: 'bg-violet-500/20 text-violet-400' },
  crypto:       { bg: '#F59E0B', badge: 'bg-amber-500/20 text-amber-400' },
  realestate:   { bg: '#059669', badge: 'bg-emerald-500/20 text-emerald-400' },
  alternatives: { bg: '#8B5CF6', badge: 'bg-purple-500/20 text-purple-300' },
  banks:        { bg: '#6B7280', badge: 'bg-slate-400/20 text-slate-400' },
  receivables:  { bg: '#22D3EE', badge: 'bg-cyan-400/20 text-cyan-300' },
  debts:        { bg: '#DC2626', badge: 'bg-rose-400/20 text-rose-300' },
  other:        { bg: '#9CA3AF', badge: 'bg-slate-300/20 text-slate-400' },
}

export const CHART_PALETTE = [
  '#6366F1', '#0891B2', '#7C3AED', '#F59E0B', '#059669',
  '#8B5CF6', '#6B7280', '#22D3EE', '#EC4899', '#14B8A6',
]

export const INVESTMENT_CLASS_COLORS = {
  renta_variable: '#6366F1',
  renta_fija:     '#0891B2',
  patrimonio_vc:  '#8B5CF6',
  debts:          '#DC2626',
}

export const HEALTH = {
  liquidity:       { bar: 'bg-sky-500',     text: 'text-sky-400' },
  diversification: { bar: 'bg-emerald-500', text: 'text-emerald-400' },
  growth:          { bar: 'bg-teal-500',    text: 'text-teal-400' },
  debt:            { bar: 'bg-orange-500',  text: 'text-orange-400' },
}
