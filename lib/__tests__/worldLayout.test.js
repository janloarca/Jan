import { layoutWorld, buildingGeometry, iso, focusTransform, MIN_FLOOR_H, TIER_HEIGHT, maxColsForWidth } from '../worldLayout'

const b = (key, tier, shares) => ({ key, tier, departments: shares.map((s, i) => ({ id: `${key}${i}`, share: s })) })

test('iso 2:1', () => {
  expect(iso(1, 0)).toEqual([18, 9])
  expect(iso(0, 1, 5)).toEqual([-18, 4])
})

test('pisos: mínimo para la gente, el resto por dinero, y nunca más bajo que el escalón', () => {
  const g = buildingGeometry(b('a', 5, [0.75, 0.25]))
  expect(g.floors[0].h).toBeGreaterThan(g.floors[1].h)
  for (const f of g.floors) expect(f.h).toBeGreaterThanOrEqual(MIN_FLOOR_H)
  const H = g.floors.reduce((a, f) => a + f.h, 0)
  expect(H).toBeCloseTo(TIER_HEIGHT[5])
  // Más inversiones que lo que cabe en el alto del escalón: el edificio crece.
  const many = buildingGeometry(b('m', 1, Array(6).fill(1 / 6)))
  expect(many.floors.reduce((a, f) => a + f.h, 0)).toBeCloseTo(6 * MIN_FLOOR_H)
})

test('un edificio más grande en dinero es más grande en planta', () => {
  expect(buildingGeometry(b('a', 5, [1])).fw).toBeGreaterThan(buildingGeometry(b('a', 1, [1])).fw)
})

test('layout: celdas sin solaparse, parques en las vacías, viewBox contiene todo', () => {
  const L = layoutWorld([b('a', 5, [1]), b('b', 3, [1]), b('c', 2, [1]), b('d', 1, [1]), b('e', 1, [1])], { maxCols: 3 })
  expect(L.cols).toBe(3)
  expect(L.rows).toBe(2)
  expect(L.parks).toHaveLength(1)
  const cells = new Set(L.placements.map(p => `${p.c},${p.r}`))
  expect(cells.size).toBe(5)
  for (const p of L.placements) {
    expect(p.bbox.x).toBeGreaterThanOrEqual(L.viewBox.x)
    expect(p.bbox.y).toBeGreaterThanOrEqual(L.viewBox.y)
    expect(p.bbox.x + p.bbox.w).toBeLessThanOrEqual(L.viewBox.x + L.viewBox.w)
  }
})

test('enfoque: el centro del edificio cae en el punto pedido', () => {
  const vb = { x: 0, y: 0, w: 400, h: 300 }
  const bbox = { x: 100, y: 50, w: 80, h: 120 }
  const { tx, ty, s } = focusTransform(vb, bbox, { fx: 0.35 })
  expect(s * (bbox.x + bbox.w / 2) + tx).toBeCloseTo(140)
  expect(s * (bbox.y + bbox.h / 2) + ty).toBeCloseTo(150)
})

test('columnas por ancho', () => {
  expect(maxColsForWidth(360)).toBe(2)
  expect(maxColsForWidth(800)).toBe(3)
  expect(maxColsForWidth(1200)).toBe(4)
})
