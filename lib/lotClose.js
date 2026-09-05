// Cierre de lotes: las reglas que TRES escritores compartían a mano.
//
// `closeLotsFIFO`, `executeSaleAtomic` y `executeContribution` (los tres en
// hooks/useFirestoreItems.js) cierran lotes por FIFO con el MISMO bucle, cada
// uno con su propia copia de tres decisiones: cuándo un cierre parcial cuenta
// como total, con cuántos decimales queda la cantidad restante, y qué id lleva
// el documento del lote cerrado. Ya habían divergido (FASE OB): uno armaba el
// id con `Date.now()` y los otros dos con la fecha, y el epsilon era ABSOLUTO.
//
// ⛔ EL EPSILON ES RELATIVO, y no es prolijidad. Con `QTY_EPSILON = 0.0001`
// fijo, una posición de 0.00005 BTC (polvo real: lo que queda después de
// vender "todo" con redondeo de exchange) se declaraba VENDIDA ENTERA aunque
// el usuario vendiera la mitad, y una venta de 0.00005 se rechazaba como "no
// puedes vender más de lo que tienes" contra una tenencia de 0.00005. Para una
// acción 0.0001 es nada; para una cripto de ocho decimales es la posición.
// La tolerancia escala con la cantidad que se está comparando, con un piso en
// el último decimal que la app conserva (1e-8, el mismo que `addLot` usa para
// armar su id).
//
// ⛔ EL ID DEL LOTE CERRADO ES DETERMINÍSTICO Y ÚNICO POR CIERRE. Determinístico
// porque `runTransaction` reintenta ante contención y un `Date.now()` escribía
// un doc NUEVO en cada reintento (dos cierres por una venta). Único por cierre
// porque `${lot.id}-closed-${fecha}` colapsaba DOS ventas parciales del mismo
// lote el mismo día en un solo documento: la segunda pisaba a la primera y
// esas acciones desaparecían de la historia. La cantidad del lote ANTES del
// cierre baja con cada venta parcial, así que sirve de discriminador sin
// necesitar un reloj: dos cierres del mismo lote nunca la ven igual.

export const QTY_SCALE = 1e8

export function roundQty(v) {
  return Math.round((Number(v) || 0) * QTY_SCALE) / QTY_SCALE
}

// Tolerancia para comparar dos cantidades: relativa a la magnitud, con piso en
// el último decimal representable.
export function qtyEpsilon(q) {
  return Math.max(1 / QTY_SCALE, Math.abs(Number(q) || 0) * 1e-6)
}

// ¿Cerrar `closable` unidades de un lote de `lotQty` lo deja vacío?
export function closesWholeLot(closable, lotQty) {
  return Number(closable) >= Number(lotQty) - qtyEpsilon(lotQty)
}

// ¿`qty` supera lo que se tiene (`held`) más allá del ruido de redondeo?
export function exceedsHolding(qty, held) {
  return Number(qty) > (Number(held) || 0) + qtyEpsilon(held)
}

export function closedLotDocId(lot, closeDate) {
  const before = Math.round((Number(lot?.quantity) || 0) * QTY_SCALE)
  return `${lot?.id || 'lot'}-closed-${closeDate || 'nodate'}-${before}`
}

// Una cantidad que se muestra en un campo de texto NUNCA en notación
// científica: `(0.00000015).toString()` es "1.5e-7", y eso tecleado de vuelta
// se lee como 1.5 (la lectura conserva solo dígitos y el punto). Ocho
// decimales, sin ceros de cola.
export function formatQtyPlain(q) {
  const n = Number(q) || 0
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(8)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
