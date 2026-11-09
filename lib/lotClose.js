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

// El id de un lote ABIERTO, movido acá desde `addLot` (FASE PG)
// para que un segundo escritor (comprar acciones con efectivo desde
// TransferModal) no tenga que copiar la expresión. El dueño entra al id por
// la misma razón que en `closedLotDocId`: dos cuentas con el mismo símbolo,
// fecha, cantidad y costo (el mismo broker en dos brokerages) colapsarían en
// un solo lote sin él (FASE OB).
export function openLotDocId(lot) {
  const qty = Math.round((Number(lot?.quantity) || 0) * QTY_SCALE)
  const cost = Math.round((Number(lot?.costBasis) || 0) * 100)
  const inst = String(lot?.institution || '').replace(/[/\\]/g, '-').slice(0, 20)
  const owner = lot?.itemId ? `-${String(lot.itemId).replace(/[/\\]/g, '-').slice(0, 24)}` : ''
  return `${String(lot?.symbol || 'lot').toUpperCase()}-${lot?.acquisitionDate || 'nodate'}-${qty}-${cost}${inst ? `-${inst}` : ''}${owner}`
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

// FASE RF. Orden en que se consumen los lotes al vender o retirar de UNA
// posición. Antes era FIFO por símbolo (+ institución), así que vender desde
// la posición B bajaba el lote de la A. Ahora manda el dueño:
//   1) lotes con `itemId` de ESTA posición,
//   2) lotes sin dueño cuya fecha de compra coincide con la de la posición,
//   3) el resto de lotes sin dueño (institución primero), FIFO como siempre.
// Nunca se toca un lote cuyo dueño es OTRA posición. `lots` ya son abiertos.
export function orderLotsForClose(lots, { itemId, institution, acquisitionDate } = {}) {
  const byDate = (a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || '')
  const own = lots.filter((l) => itemId && l.itemId === itemId).sort(byDate)
  const free = lots.filter((l) => !l.itemId)
  const sameDate = acquisitionDate ? free.filter((l) => l.acquisitionDate === acquisitionDate).sort(byDate) : []
  let rest = free.filter((l) => !sameDate.includes(l)).sort(byDate)
  if (institution) {
    const inst = rest.filter((l) => l.institution === institution)
    if (inst.length > 0) rest = inst
  }
  return [...own, ...sameDate, ...rest]
}
