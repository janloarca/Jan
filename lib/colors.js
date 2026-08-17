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
// pair in normal vision is ΔE 18.10, bonds vs realestate (the old set had
// pairs under 8). Six is the ceiling here; a seventh hue cannot be added
// without dropping one of these below the readable floor, so anything past the
// top slices folds into a neutral "Otros".
//
// ⛔ ESTO YA NO ES SOLO PROSA. lib/__tests__/palette.test.js mide cada una de
// esas afirmaciones con lib/colorMath.js y se pone rojo si alguien mueve un
// color. Verificado que falla de verdad: subirle la saturación a `bonds`
// tumba 3 tests, y convertir un neutral en un séptimo tono tumba 2. Antes
// existía la afirmación pero nada la hacía cumplir, y el script que este
// comentario citaba nunca estuvo en este repo.
//
// Sobre daltonismo, con los números REALES por tipo (Viénot 1999), porque la
// versión anterior de este comentario decía "el par más apretado en daltonismo
// cae en ΔE 6" y eso solo es cierto para UN tipo:
//     · protanopia   8.18  (funds vs stocks)
//     · deuteranopia 6.27  (realestate vs alternatives) ← el "verde profundo
//                           vs magenta" que este comentario ya describía
//     · tritanopía   3.27  (alternatives vs funds) ← NO llega a 6
// La tritanopía aplana magenta contra morado y no hay color que lo arregle sin
// rehacer la paleta. Se acepta a conciencia: prevalencia ~0.01%, y sobre todo
// porque la mitigación de abajo importa más que cualquier distancia.
//
// Por eso todo lugar donde aparecen estos colores imprime TAMBIÉN el nombre de
// la clase al lado: la identidad nunca la carga el color solo.
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

// Un color por PERSONA (los avatares de Amigos), que es una pregunta distinta
// de "un color por serie de gráfica" y por eso no puede usar CHART_PALETTE tal
// cual. Hasta FASE JI la usaba, y medido con lib/colorMath.js eso daba:
//
//     par más cercano          9.21  (#94A3B8 vs #B6BFCC)
//     mínimo contra el azul    2.58  (#2C67DC vs --accent-blue #2563EB)
//
// O sea dos personas podían salir con el mismo gris, y una tercera con un azul
// indistinguible del que marca "tú". Las tres exclusiones, cada una con su
// razón medida:
//
//   · #D64545 es EXACTAMENTE INVESTMENT_CLASS_COLORS.debts. En una app de
//     dinero un avatar rojo se lee como pérdida, no como una persona. (Este es
//     el que le tocó al dueño de la app, y por eso salió el reporte.)
//   · #2C67DC está a ΔE 2.58 del azul de marca, que queda RESERVADO para tu
//     propia tarjeta. Un amigo no puede parecerse a "tú".
//   · #94A3B8 y #B6BFCC son dos pasos más del mismo gris que #64748B
//     (9.21 y 15.64 entre ellos, bajo el piso de 18). Se van los tres: con
//     #64748B adentro el par más cercano quedaba en 13.29, todavía bajo el piso.
//
// Lo que queda son 5 colores, todos ya dentro de CHART_PALETTE (no se inventa
// ningún tono nuevo), con par más cercano ΔE 18.10 y mínimo contra el azul de
// marca 19.85: los dos por encima del piso de 18 que este archivo ya usa.
//
// Lo que NO mejora: la tritanopía se queda en 3.27 (#B274DC vs #BD2D76), que es
// el MISMO par que el comentario de arriba ya documenta como irresoluble sin
// rehacer la paleta. No es un compromiso nuevo, y la mitigación es la misma:
// junto a cada avatar siempre se imprimen la inicial y el nombre.
//
// Con 5 colores, un grupo de 6+ personas tendrá repetidos. Es aceptable por lo
// mismo: el color ayuda a escanear una lista, no identifica a nadie.
export const AVATAR_PALETTE = [
  '#08A8AF', '#B274DC', '#E07227', '#00764F', '#BD2D76',
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
