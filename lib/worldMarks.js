// FASE PR (parte 2). "Diseno por categoria" sin inventar colores.
//
// Varias industrias comparten arquetipo (Comunicacion y Aeroespacial se dibujan
// como TECH, Hotelera como RETAIL...) y por eso dos edificios de industrias
// distintas se veian identicos. Se probo darle a cada una su propio acento y NO
// cabe: con 15 acentos ya en juego, ningun color a menos de dE 22 del padre
// queda a dE >= 9 de todos los demas (el mismo techo que lib/colors.js documenta
// para las clases de activo). Asi que la identidad la lleva la FORMA: una marca
// de azotea propia por industria, con el acento del arquetipo. Cumple de paso la
// regla de que el significado nunca lo carga el color solo.
//
// Solo llevan marca las industrias que NO son la "por defecto" de su arquetipo;
// la por defecto (Tecnologia, Consumo basico, Energia, Industrial, Transporte)
// ya es lo que el arquetipo dibuja.
import { INDUSTRY_ARCHETYPE, findSubIndustry } from '@/lib/classification'

export const VARIANT_MARK = {
  Communication: 'dish',
  Aerospace: 'wing',
  ConsumerDiscretionary: 'diamond',
  Hospitality: 'bell',
  Utilities: 'drop',
  Materials: 'cube',
  Automotive: 'wheel',
}

// Industria del catalogo que el usuario eligio (directa o por la subindustria).
export function variantOf(item) {
  if (!item) return null
  if (item.subIndustry) {
    const sub = findSubIndustry(item.industry, item.subIndustry)
    if (sub) return sub.industry
  }
  return item.industry && INDUSTRY_ARCHETYPE[item.industry] ? item.industry : null
}

// Marca solo si la industria pertenece al arquetipo que de verdad se dibuja:
// un override del usuario (worldArchetype) puede mandar el piso a otro lado y
// ahi una marca de otra industria seria una afirmacion falsa.
export function markFor(archetype, variant) {
  if (!variant || INDUSTRY_ARCHETYPE[variant] !== archetype) return null
  return VARIANT_MARK[variant] || null
}
