// Colores de World que NO dependen del tema. El entorno (suelo, muros,
// vidrio, sombras) vive en variables `--w-*` de globals.css, con versión
// clara y oscura; acá solo quedan los acentos de cada arquetipo y las
// personas, que se leen igual sobre los dos fondos. Ninguno se usa como
// TEXTO: son rellenos de figuras, puntos de leyenda y franjas de piso.
export const ARCHETYPE_ACCENT = {
  BANK: '#2563EB',
  FINANCE: '#6366F1',
  TECH: '#8B5CF6',
  INFRASTRUCTURE: '#F97316',
  CONSTRUCTION: '#EAB308',
  ENERGY: '#10B981',
  REAL_ESTATE: '#14B8A6',
  RETAIL: '#EC4899',
  HEALTHCARE: '#EF4444',
  LOGISTICS: '#B45309',
  AGRICULTURE: '#65A30D',
  GENERIC_CORPORATE: '#64748B',
}

export const SKINS = ['#F1C7A5', '#D9A07A', '#A86F4C', '#7A4A2E', '#E8B996']
export const HAIRS = ['#2B1D14', '#5A3A22', '#1F2937', '#8B5E34', '#D6B370']
export const SHIRTS = ['#F8FAFC', '#CBD5E1', '#93C5FD', '#FDE68A', '#A7F3D0', '#FBCFE8']
export const HAT = '#FACC15'
export const PANTS = ['#334155', '#1E293B', '#475569']

export function accentOf(archetype) {
  return ARCHETYPE_ACCENT[archetype] || ARCHETYPE_ACCENT.GENERIC_CORPORATE
}
