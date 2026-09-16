// La geometría de la dona de composición (parte contra todo), por mes o por
// año. Módulo puro: recibe un mapa {grupo: monto} y devuelve rebanadas listas
// para dibujar, para que la aritmética se pueda probar sin montar un SVG.
//
// ⛔ UNA PARTE NEGATIVA NO EXISTE EN UNA DONA. Un grupo puede cerrar en
// negativo cuando los reembolsos del mes superan lo gastado en él (una
// devolución que cae en un mes distinto al de la compra: caso real, ver FASE
// JW). Una dona es parte-contra-todo, así que una rebanada negativa no se
// puede dibujar: usar su magnitud MENTIRÍA (la pintaría como gasto) y omitirla
// en silencio rompería la suma. Se excluye del círculo y se DECLARA aparte, que
// es la única de las tres salidas que no afirma algo falso.
//
// El trazo se dibuja con stroke-dasharray sobre un círculo, no con paths de
// arco: no hay banderas de arco que equivocar, el caso de una sola rebanada al
// 100% sale solo, y es la misma técnica que el anillo de marca ya usa.

export const DONUT_RADIUS = 56
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

/**
 * Las rebanadas se arman por GRUPO, pero agrupando con la taxonomía del
 * USUARIO (`model`), no con la de fábrica: si alguien movió una categoría de
 * grupo, la dona y el estado del mes tienen que contarla del mismo lado o
 * serían dos respuestas sobre el mismo dinero.
 *
 * @param categoryTotals {[category]: number}
 * @param groups  definiciones de grupo (key/label/labelEn/color/icon)
 * @param model   salida de resolveCategoryModel (opcional: sin él se usa el
 *                `fallbackGroupOf` que pase el caller)
 * @returns {{ slices, total, negativeTotal, negatives, circumference }}
 *          slices: ya ordenadas de mayor a menor, con su porcentaje y el
 *          dasharray/offset que las dibuja.
 */
export function buildDonut(categoryTotals, groups, { model = null, fallbackGroupOf = null } = {}) {
  const byGroup = {}
  for (const [category, raw] of Object.entries(categoryTotals || {})) {
    const amount = Number(raw) || 0
    if (!amount) continue
    const entry = model?.entry ? model.entry(category) : null
    const gk = entry?.groupKey
      || (typeof fallbackGroupOf === 'function' ? fallbackGroupOf(category) : null)
      || (groups?.[groups.length - 1]?.key)
    byGroup[gk] = (byGroup[gk] || 0) + amount
  }

  const positives = []
  const negatives = []
  for (const g of groups || []) {
    const amount = byGroup[g.key] || 0
    if (amount > 0) positives.push({ g, amount })
    else if (amount < 0) negatives.push({ key: g.key, label: g.label, labelEn: g.labelEn || g.label, amount })
  }

  const total = positives.reduce((s, p) => s + p.amount, 0)
  positives.sort((a, b) => b.amount - a.amount)

  let offset = 0
  const slices = positives.map(({ g, amount }) => {
    const pct = total > 0 ? (amount / total) * 100 : 0
    const len = (pct / 100) * DONUT_CIRCUMFERENCE
    const slice = {
      key: g.key,
      label: g.label,
      labelEn: g.labelEn || g.label,
      icon: g.icon,
      color: g.color,
      amount,
      pct,
      // El círculo se rota -90° al dibujarlo, así que la primera rebanada
      // arranca a las 12 en punto.
      dashArray: `${len} ${Math.max(0, DONUT_CIRCUMFERENCE - len)}`,
      dashOffset: -offset,
    }
    offset += len
    return slice
  })

  return {
    slices,
    total,
    negativeTotal: negatives.reduce((s, n) => s + n.amount, 0),
    negatives,
    circumference: DONUT_CIRCUMFERENCE,
  }
}
