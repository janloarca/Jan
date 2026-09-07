/**
 * FASE OL. Las reglas de "Agregar a posición" (el merge del aviso de duplicado
 * de AddAccountModal), en un solo lugar y sin React para poder probarlas.
 *
 * El merge escribe con `addItem`, que hace `setDoc(..., {merge:true})` sobre
 * el id del ítem EXISTENTE: todo campo que el form manda PISA al guardado, y
 * el resto sobrevive. Tres cosas que ese modelo hacía mal, medidas con el
 * modal real antes de escribir esto:
 *
 *  1. MONEDA. El aviso de duplicado empareja por nombre + institución y jamás
 *     miraba la moneda, y la moneda se elige en el paso 2, DESPUÉS del aviso.
 *     Un bono guardado en GTQ 5,000 al que se le "agregaba" USD 1,000 quedaba
 *     en `{currency:'USD', purchasePrice:6000}`: quetzales sumados con dólares
 *     como si fueran la misma unidad, y encima re-etiquetados en dólares
 *     (Q5,000 son ~$650; el ítem pasaba a valer ~9x). Un merge solo tiene
 *     sentido en la moneda del ítem que ya existe, así que la moneda se
 *     PRESIEMBRA con la del existente al aceptar el merge, y si el usuario la
 *     cambia igual, el guardado REHÚSA nombrando las dos. Convertir a la tasa
 *     de la app sería adivinar sobre dinero (el precedente es FASE JD: la tasa
 *     la pone el usuario, nunca la app).
 *
 *  2. FECHA DE ADQUISICIÓN. El ítem recibía `acquisitionDate` = la fecha de
 *     ESTA compra, pisando la real. Esa fecha gatea el pasado en la Hoja
 *     (`applyStaticHistory`: un mes anterior a ella queda en blanco) y en la
 *     ruta de historial (`ts < acquiredTs` → 0), así que agregar 1,000 hoy a
 *     un bono comprado en enero borraba toda su historia de enero a hoy. El
 *     ítem conserva la fecha MÁS VIEJA; la fecha de esta compra viaja en el
 *     lote y en el DEPOSIT, que son los que describen ESTE aporte.
 *
 *  3. `createdAt` (en el hook, no acá): `addItem` estampaba hoy sobre el doc
 *     existente, y `effectiveAcqDate` cae a `createdAt` cuando no hay fecha.
 *
 * La ARITMÉTICA del merge (FASE OA: un activo de saldo SUMA, un activo de
 * mercado promedia el costo) no cambia: se extrajo textual para que el test
 * la fije en vez de vivir solo dentro del `handleSubmit`.
 */

export function mergeCurrencyOf(existing) {
  return (existing && (existing._originalCurrency || existing.currency)) || 'USD'
}

// null cuando se puede sumar; si no, las dos monedas, para decirlas.
export function mergeCurrencyConflict(existing, typedCurrency) {
  const have = mergeCurrencyOf(existing)
  const typed = (typedCurrency || 'USD').toUpperCase()
  if (have.toUpperCase() === typed) return null
  return { existing: have, typed }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
// La más vieja de las dos, comparando el TEXTO 'YYYY-MM-DD' (el orden
// lexicográfico de una fecha ISO ya es el cronológico y ninguna zona horaria
// lo corrompe). Sin una de las dos, la otra; sin ninguna, undefined.
export function mergedAcquisitionDate(existingDate, purchaseDate) {
  const a = typeof existingDate === 'string' && ISO_DAY.test(existingDate) ? existingDate : null
  const b = typeof purchaseDate === 'string' && ISO_DAY.test(purchaseDate) ? purchaseDate : null
  if (a && b) return a <= b ? a : b
  return a || b || undefined
}

// Los campos que el merge escribe ENCIMA del ítem armado por el form. Devuelve
// solo lo que cambia; un caso que no es mercado ni saldo (deuda) devuelve {}.
export function mergePositionFields({ existing, item, isMarketAsset, qty, price, newCurrent }) {
  if (!existing) return {}
  if (isMarketAsset && (item?.quantity || 0) > 0) {
    const oldQty = existing.quantity || 0
    const oldPrice = existing.purchasePrice || 0
    const total = oldQty + qty
    return {
      quantity: total,
      purchasePrice: total > 0 ? (oldQty * oldPrice + qty * price) / total : oldPrice,
    }
  }
  if (!isMarketAsset && !item?.isDebt) {
    // FASE OA. Un activo de saldo tiene cantidad 1 y su monto vive en los
    // precios, así que agregar es SUMAR en los dos campos; el depósito queda
    // solo con el dinero que entró ahora (lo decide el caller vía isMerge).
    const oldQty = Number(existing.quantity) || 1
    const oldPurchase = (existing.purchasePrice || 0) * oldQty
    const oldCurrent = (existing.currentPrice || existing.purchasePrice || 0) * oldQty
    const out = { quantity: 1, purchasePrice: oldPurchase + price }
    if (item?.currentPrice != null || existing.currentPrice != null) out.currentPrice = oldCurrent + (newCurrent || price)
    if (existing.entryFee && item?.entryFee == null) out.entryFee = existing.entryFee
    else if (existing.entryFee && item?.entryFee != null) out.entryFee = (existing.entryFee || 0) + item.entryFee
    return out
  }
  return {}
}
