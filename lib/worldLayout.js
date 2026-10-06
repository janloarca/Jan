// Geometría isométrica de World (2:1). Puro y sin React: dónde va cada
// edificio, qué alto tiene cada piso y qué caja del viewBox ocupa todo.
//
// Coordenadas: gx/gy en "baldosas", gz en unidades de pantalla hacia arriba.
// iso(gx, gy, gz) → [x, y] de pantalla.
//
// La decisión que define el dibujo: cada piso NO es una caja abierta con
// techo completo. En una isométrica 2:1 un piso de alto H solo deja ver H/18
// baldosas de profundidad; un edificio de 3.6 baldosas de fondo con techos
// enteros escondería todo su interior. Por eso cada piso es una GALERÍA de
// vidrio que envuelve la esquina frontal (profundidad GALLERY) alrededor de un
// núcleo sólido: la gente y los objetos viven en esa franja, que sí se ve.

export const HX = 18
export const HY = 9
export const CELL = 6
export const PLOT_MARGIN = 0.9
export const GALLERY = 0.9
export const PLINTH = 7
export const ROOF = 6
export const MIN_FLOOR_H = 36
export const ROOFTOP_ALLOWANCE = 34
export const PLATFORM_THICKNESS = 14
export const TIER_FOOTPRINT = [0, 2.0, 2.4, 2.8, 3.2, 3.6]
export const TIER_HEIGHT = [0, 50, 72, 100, 130, 165]

export function iso(gx, gy, gz = 0) {
  return [(gx - gy) * HX, (gx + gy) * HY - gz]
}

export function maxColsForWidth(width) {
  if (!(width > 0)) return 3
  if (width < 560) return 2
  if (width < 960) return 3
  return 4
}

// Alto de cada piso: un mínimo (para que quepa la gente) y lo que sobra del
// alto del escalón se reparte por la parte del dinero que tiene cada piso.
export function buildingGeometry(building) {
  const tier = Math.min(5, Math.max(1, building.tier || 1))
  const fw = TIER_FOOTPRINT[tier]
  const fd = TIER_FOOTPRINT[tier]
  const depts = building.departments || []
  const n = Math.max(1, depts.length)
  const H = Math.max(TIER_HEIGHT[tier], n * MIN_FLOOR_H)
  const extra = H - n * MIN_FLOOR_H
  let z = PLINTH
  const floors = depts.map((d) => {
    const h = MIN_FLOOR_H + extra * (d.share || 1 / n)
    const f = { id: d.id, z0: z, h }
    z += h
    return f
  })
  if (floors.length === 0) z += MIN_FLOOR_H
  return { fw, fd, floors, top: z }
}

// Ranuras de una galería: dónde puede pararse alguien o ir un objeto. La
// franja izquierda corre a lo largo de gx (frente completo), la derecha a lo
// largo de gy hasta la esquina (la esquina ya la cubre la izquierda).
export const SLOT_STEP = 0.62
export function gallerySlots(ox, oy, fw, fd) {
  const slots = []
  const nL = Math.max(1, Math.floor((fw - 0.5) / SLOT_STEP) + 1)
  for (let i = 0; i < nL; i++) {
    const gx = ox + 0.32 + (nL === 1 ? (fw - 0.64) / 2 : (i * (fw - 0.64)) / (nL - 1))
    slots.push({ strip: 'L', i, n: nL, along: gx, base: oy + fd - GALLERY })
  }
  const span = fd - GALLERY - 0.2
  const nR = Math.max(1, Math.floor((span - 0.2) / SLOT_STEP) + 1)
  for (let i = 0; i < nR; i++) {
    const gy = oy + 0.32 + (nR === 1 ? (span - 0.32) / 2 : (i * (span - 0.32)) / (nR - 1))
    slots.push({ strip: 'R', i, n: nR, along: gy, base: ox + fw - GALLERY })
  }
  // Intercaladas: así pocas personas quedan repartidas por las dos caras.
  const L = slots.filter(s => s.strip === 'L').reverse()
  const R = slots.filter(s => s.strip === 'R').reverse()
  const out = []
  while (L.length || R.length) { if (L.length) out.push(L.shift()); if (R.length) out.push(R.shift()) }
  return out
}

// Cuántas personas caben por piso en un edificio de ese escalón.
export function slotCapacity(tier) {
  const t = Math.min(5, Math.max(1, tier || 1))
  return gallerySlots(0, 0, TIER_FOOTPRINT[t], TIER_FOOTPRINT[t]).length
}

function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export function layoutWorld(buildings, { maxCols = 3 } = {}) {
  const n = buildings.length
  const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(Math.max(1, n)))))
  const rows = Math.max(1, Math.ceil(n / cols))

  const placements = buildings.map((b, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const g = buildingGeometry(b)
    const ox = c * CELL + (CELL - g.fw) / 2
    const oy = r * CELL + (CELL - g.fd) / 2
    const M = PLOT_MARGIN
    const left = iso(ox - M, oy + g.fd + M)[0]
    const right = iso(ox + g.fw + M, oy - M)[0]
    const topY = iso(ox, oy, g.top + ROOF + ROOFTOP_ALLOWANCE)[1]
    const bottomY = iso(ox + g.fw + M, oy + g.fd + M)[1] + 3
    return {
      key: b.key, c, r, ox, oy, ...g,
      labelAnchor: iso(ox + g.fw / 2, oy + g.fd / 2, g.top + ROOF + ROOFTOP_ALLOWANCE - 4),
      bbox: { x: left, y: topY, w: right - left, h: bottomY - topY },
    }
  })

  // Parques en las celdas vacías: la cuadrícula no queda con huecos muertos.
  const parks = []
  for (let i = n; i < cols * rows; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const h = hash(`park${i}`)
    const trees = [0, 1, 2, 3].map((k) => ({
      gx: c * CELL + 1.4 + ((h >> (k * 3)) % 5) * 0.7,
      gy: r * CELL + 1.2 + ((h >> (k * 3 + 1)) % 5) * 0.72,
      big: ((h >> k) & 1) === 1,
    }))
    parks.push({ c, r, trees })
  }

  const W = cols * CELL
  const D = rows * CELL
  const pad = 0.6
  const corners = [iso(-pad, -pad), iso(W + pad, -pad), iso(W + pad, D + pad), iso(-pad, D + pad)]
  let minX = Math.min(...corners.map(p => p[0]))
  let maxX = Math.max(...corners.map(p => p[0]))
  let minY = Math.min(...corners.map(p => p[1]))
  let maxY = Math.max(...corners.map(p => p[1])) + PLATFORM_THICKNESS
  for (const p of placements) minY = Math.min(minY, p.bbox.y - 14)
  const m = 18
  return {
    cols, rows, W, D, pad, placements, parks,
    viewBox: { x: minX - m, y: minY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m },
  }
}

// Transformación que lleva el edificio enfocado al punto (fx, 0.5) del
// viewBox. `transform-origin` de un <g> SVG es el origen del viewBox, así que
// p → s·p + t, con t = centroDestino − s·centroEdificio.
export function focusTransform(viewBox, bbox, { fx = 0.5, frac = 1, maxScale = 3.2 } = {}) {
  if (!bbox) return { tx: 0, ty: 0, s: 1 }
  const s = Math.min(maxScale, Math.min((viewBox.w * frac) / bbox.w, viewBox.h / bbox.h) * 0.9)
  const cx = viewBox.x + viewBox.w * fx
  const cy = viewBox.y + viewBox.h * 0.5
  const bx = bbox.x + bbox.w / 2
  const by = bbox.y + bbox.h / 2
  return { tx: cx - s * bx, ty: cy - s * by, s }
}
