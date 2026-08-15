export const SEMANTIC = {
  positive: '#059669',
  negative: '#DC2626',
  warning:  '#D97706',
  action:   '#4F46E5',
}

// Fixed asset-class colors — consistent across every chart, bar and badge.
//
// The six INVESTED classes carry hue; the rest are deliberately neutral, so a
// glance at any chart separates "money at work" from cash, receivables and
// leftovers. The old set had three near-identical purples (stocks indigo,
// funds violet, alternatives purple) that no one could tell apart in a stacked
// bar, and a real-estate green that collided with the semantic profit green.
//
// Picked in OKLCH and checked, not eyeballed: every hue sits inside the
// lightness band for both themes, clears the chroma floor, and the closest
// pair in normal vision is ΔE 18 (the old set had pairs under 8). The tightest
// colorblind pair (deep green vs magenta) lands at ΔE 6, which is why every
// place these appear also prints the class name beside the swatch: identity is
// never carried by color alone. Six is the ceiling here; a seventh hue cannot
// be added without dropping one of these below the readable floor, so anything
// past the top slices folds into a neutral "Otros".
export const CATEGORY = {
  stocks:       { bg: '#2C67DC', badge: 'bg-blue-500/20 text-blue-300' },
  bonds:        { bg: '#08A8AF', badge: 'bg-teal-500/20 text-teal-300' },
  funds:        { bg: '#B274DC', badge: 'bg-purple-400/20 text-purple-300' },
  crypto:       { bg: '#E07227', badge: 'bg-orange-500/20 text-orange-300' },
  realestate:   { bg: '#00764F', badge: 'bg-emerald-600/20 text-emerald-300' },
  alternatives: { bg: '#BD2D76', badge: 'bg-pink-600/20 text-pink-300' },
  receivables:  { bg: '#94A3B8', badge: 'bg-slate-400/20 text-slate-300' },
  banks:        { bg: '#64748B', badge: 'bg-slate-500/20 text-slate-400' },
  debts:        { bg: '#D64545', badge: 'bg-red-500/20 text-red-300' },
  other:        { bg: '#B6BFCC', badge: 'bg-slate-300/20 text-slate-400' },
}

// Same six first, in the order they should be handed out, then the fallbacks a
// chart with more series than asset classes reaches for.
export const CHART_PALETTE = [
  '#2C67DC', '#08A8AF', '#B274DC', '#E07227', '#00764F',
  '#BD2D76', '#64748B', '#94A3B8', '#D64545', '#B6BFCC',
]

export const INVESTMENT_CLASS_COLORS = {
  renta_variable: '#2C67DC',
  renta_fija:     '#08A8AF',
  patrimonio_vc:  '#BD2D76',
  debts:          '#D64545',
}

export const HEALTH = {
  liquidity:       { bar: 'bg-sky-500',     text: 'text-sky-400' },
  diversification: { bar: 'bg-emerald-500', text: 'text-emerald-400' },
  growth:          { bar: 'bg-teal-500',    text: 'text-teal-400' },
  debt:            { bar: 'bg-orange-500',  text: 'text-orange-400' },
}
