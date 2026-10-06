// Primitivas de dibujo isométrico para World. Funciones puras que devuelven
// cadenas de puntos o transformaciones: el JSX lo arman los componentes.
import { iso } from '@/lib/worldLayout'

export function pt(gx, gy, gz = 0) {
  const [x, y] = iso(gx, gy, gz)
  return `${x.toFixed(2)},${y.toFixed(2)}`
}

export function poly(points) {
  return points.map((p) => pt(p[0], p[1], p[2] || 0)).join(' ')
}

// Las tres caras visibles de una caja: arriba, la del frente-izquierda (plano
// gy = y1) y la del frente-derecha (plano gx = x1).
export function boxFaces(x0, y0, z0, x1, y1, z1) {
  return {
    top: poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
    left: poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]),
    right: poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]),
  }
}

// Plano gy = const (cara izquierda): u avanza con gx (18 por baldosa), v hacia
// abajo en unidades de pantalla. Origen en (gx0, gy, zTop).
export function planeY(gx0, gy, zTop) {
  const [e, f] = iso(gx0, gy, zTop)
  return `matrix(1,0.5,0,1,${e.toFixed(2)},${f.toFixed(2)})`
}

// Plano gx = const (cara derecha): u avanza con gy.
export function planeX(gx, gy0, zTop) {
  const [e, f] = iso(gx, gy0, zTop)
  return `matrix(-1,0.5,0,1,${e.toFixed(2)},${f.toFixed(2)})`
}

// Plano horizontal: u con gx, v con gy (18 por baldosa).
export function planeZ(gx0, gy0, z) {
  const [e, f] = iso(gx0, gy0, z)
  return `matrix(1,0.5,-1,0.5,${e.toFixed(2)},${f.toFixed(2)})`
}
