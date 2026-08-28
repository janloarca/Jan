// Shared contribution math for "add / withdraw money on an existing asset".
// Used by EditAccountModal (Add Money / Withdraw) and CashFlowModal (deposits,
// withdrawals and yields linked to an account), so both doors apply the SAME
// balance / lot semantics. Operates on RAW item fields (item's own currency),
// never on enriched/base-converted values.

// La CANTIDAD que hace que un saldo escrito se pueda leer, una sola definición.
//
// Para un ítem de saldo los campos de precio SON el saldo, así que `getItemValue`
// (= cantidad × precio) solo devuelve ese saldo si la cantidad es 1. El defecto
// que lo obligó (reportado por el usuario con capturas, 28 ago 2026) vive justo
// donde dos convenciones sobre el mismo campo no coinciden: los escritores
// tratan la cantidad con `Number(q) || 1` (o sea CERO pasa como 1) y el lector
// con `Number(q) || 0`. Resultado: se escribía el saldo en el precio y la app
// lo leía como 0 × precio = 0.00, con el banner verde de "guardado" encima.
//
// ⛔ La regla es ANGOSTA a propósito: se escribe 1 solo cuando la cantidad
// guardada NO SIRVE (cero, ausente, negativa), y una cantidad legítima distinta
// de 1 se deja INTACTA, porque normalizarla le cambiaría el valor al ítem sin
// que se hubiera movido un centavo (un banco con cantidad 2 y precio 500 vale
// 1,000). Un saldo que queda en cero escribe cantidad 0, espejo de
// `balanceFields` (lib/transferFields.js): con los dos precios en cero,
// `getItemPrice` cae en cascada a `price`/`cost` y un residuo ahí RESUCITA el
// saldo, que es el segundo síntoma del mismo reporte.
export function balanceQuantityPatch(item, nextValue) {
  const next = Number(nextValue)
  if (Number.isFinite(next) && next <= 0) return { quantity: 0 }
  const qty = Number(item?.quantity)
  if (Number.isFinite(qty) && qty > 0) return {}
  return { quantity: 1 }
}

export function isBankLikeItem(item) {
  const type = item?.type || ''
  const isMarket = /stock|crypto|fund|etf/i.test(type) && !/realestate/i.test(type)
  const isBank = /bank|banco/i.test(type)
  return isBank || (!isMarket && (Number(item?.quantity) || 1) === 1)
}

// Builds the Firestore writes for a contribution (isAdd) or withdrawal (!isAdd)
// of `amount` (in the item's currency) dated `date` (YYYY-MM-DD).
// Returns { itemFields, newLot?, lotClose? } ready for executeContribution().
//  - Bank-like / static (qty 1): value is the balance → shift purchasePrice and
//    currentPrice by the amount (each keeps its own level, so an asset whose
//    market value drifted from cost doesn't lose the gain).
//  - Share-based: convert the amount to shares at the current price; adds create
//    a lot at `date` (so history reconstructs), withdrawals FIFO-close lots.
export function buildContributionFields({ item, amount, date, isAdd, currency }) {
  const amt = Number(amount) || 0
  if (isBankLikeItem(item)) {
    const oldPurchase = Number(item.purchasePrice) || 0
    const oldCurrent = Number(item.currentPrice ?? item.purchasePrice) || 0
    const delta = isAdd ? amt : -amt
    const nextCurrent = Math.max(0, oldCurrent + delta)
    // ⛔ La fórmula NO cambia (los dos campos se siguen desplazando por el delta
    // completo, así que la ganancia no se mueve: la spec de lib/assetLogic/
    // liquidFundYield.js sigue valiendo palabra por palabra). Lo que se AGREGA
    // es escribir la CANTIDAD, sin la cual el saldo escrito no se puede leer.
    //
    // Los dos síntomas que lo obligaron, reportados por el usuario con capturas
    // (28 ago 2026) y reproducidos con las funciones reales:
    //
    //  1. "Cambié el valor y no se guarda". `canRecordFlow` acepta el ítem con
    //     la convención `Number(quantity) || 1`, o sea una cantidad CERO pasa
    //     como si fuera 1; pero `getItemValue` usa `Number(quantity) || 0`. Con
    //     las dos conviviendo, el saldo se escribía en el precio y la app lo
    //     leía como 0 × precio = 0.00. Escribir la cantidad hace que las dos
    //     convenciones digan lo mismo, que es lo único que cierra ese hueco.
    //
    //  2. "Vacié la cuenta y el saldo volvió". Con los dos precios en cero,
    //     `getItemPrice` cae en cascada a `price`/`cost`, así que un residuo
    //     ahí RESUCITA el saldo. `lib/transferFields.js` ya documenta ese
    //     riesgo y se protege poniendo la cantidad en cero al vaciar; este
    //     motor era la copia que se quedó atrás.
    //
    // La cantidad 1 no es una elección: es la que esta rama YA asume (trata los
    // precios como EL SALDO, por eso los desplaza por el delta completo, y por
    // eso `canRecordFlow` exige cantidad efectiva 1 desde FASE JJ3). Hacerla
    // explícita es alinear lo escrito con lo asumido.
    // ⛔ Solo se escribe 1 cuando la cantidad guardada NO SIRVE (cero, ausente,
    // negativa, basura). Una cantidad legítima distinta de 1 se deja INTACTA, y
    // eso no es timidez: normalizarla le cambiaría el valor al ítem sin que se
    // hubiera movido un centavo (un banco con cantidad 2 y precio 500 vale
    // 1,000, y ponerle cantidad 1 lo dejaría en 800 tras un depósito de 300).
    // Esta rama no sabe expresar una cantidad distinta de 1 (desplaza los
    // precios por el delta COMPLETO), y por eso `canRecordFlow` rehúsa esos
    // ítems desde FASE JJ3: el guard es del caller, no de acá. Lo fija un test
    // de regresión negativa que documenta ese 1,600.
    const itemFields = {
      purchasePrice: Math.max(0, oldPurchase + delta),
      currentPrice: nextCurrent,
      ...balanceQuantityPatch(item, nextCurrent),
    }
    return { itemFields }
  }

  const pricePerUnit = Number(item.currentPrice) || Number(item.purchasePrice) || 1
  const oldQty = Number(item.quantity) || 0
  const shares = amt / pricePerUnit

  if (isAdd) {
    return {
      itemFields: { quantity: oldQty + shares },
      newLot: {
        symbol: (item.symbol || '').toUpperCase(),
        quantity: shares,
        costBasis: pricePerUnit,
        currency: currency || item.currency || 'USD',
        acquisitionDate: date,
        institution: item.institution || '',
      },
    }
  }

  const out = { itemFields: { quantity: Math.max(0, oldQty - shares) } }
  if (shares > 0) {
    out.lotClose = {
      symbol: (item.symbol || '').toUpperCase(),
      qty: shares,
      price: pricePerUnit,
      date,
      institution: item.institution || '',
    }
  }
  return out
}
