// FASE OD. El ÚNICO constructor de las filas que escribe una venta.
//
// Dos defectos vivían en SellModal por armar las filas a mano:
//
// 1. SIN NONCE, dos ventas iguales el mismo día colapsaban en UN documento.
//    El id de una transacción es `fecha-símbolo-tipo-centavos` (txDocId en
//    hooks/useFirestoreItems.js) y `addTransaction` solo agrega su nonce a lo
//    que lleva `_source` "manual*"; la venta no pasa por ahí. Reproducido con
//    el hook real: vender 2 AAPL @ 200 dos veces el 1 de agosto deja la
//    cantidad en 6 y DOS lotes cerrados, pero UNA sola fila SELL. El ledger
//    pierde una venta, el rebobinado por trades reconstruye una cantidad
//    equivocada, y la ganancia realizada del CSV se apila en la fila que quedó.
//    Es el mismo defecto que FASE KY cerró para las transferencias
//    (`lib/transferTx.js`), en la puerta que aquella pasada no tocó.
//
// 2. SIN MARCAS, la fila no decía qué había movido, así que borrarla no podía
//    deshacer nada (ver lib/saleReversal.js). `_sale` guarda lo que hace falta
//    para revertir EXACTO: cuántas unidades salieron, qué precios tenía el
//    ítem antes (los que una venta total pone en cero), y a qué cuenta llegó
//    cuánto, en la moneda de ESA cuenta. Los cierres de lotes los estampa el
//    escritor atómico, que es el único que los conoce (`_lotCloses`).
//
// `_saleId` es el MISMO nonce en la fila SELL y en su WITHDRAWAL compañera
// (dinero que salió de la app), para que borrar una se lleve a la otra.

const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function buildSaleTransactions({
  item, qtySell, price, proceeds, saleDate, currency,
  soldFully, prevItemFields,
  destination, dest, destAmount, destKind, destAddQty,
  lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const saleId = nonce()
  const sale = {
    qty: Number(qtySell) || 0,
    soldFully: !!soldFully,
    prevItemFields: {
      quantity: Number(prevItemFields?.quantity) || 0,
      currentPrice: Number(prevItemFields?.currentPrice) || 0,
      purchasePrice: Number(prevItemFields?.purchasePrice) || 0,
    },
    destId: dest?.id || null,
    destKind: dest ? (destKind || null) : null,
    destAmount: dest ? (Number(destAmount) || 0) : 0,
    destCurrency: dest ? (dest._originalCurrency || dest.currency || currency) : null,
    destAddQty: dest && destKind === 'market' ? (Number(destAddQty) || 0) : 0,
  }
  const transactions = [{
    type: 'SELL',
    symbol: item.symbol || '',
    description: `${t('Venta', 'Sale')} ${qtySell} ${item.name || item.symbol} @ ${price}`,
    date: saleDate,
    totalAmount: proceeds,
    quantity: qtySell,
    pricePerUnit: price,
    currency,
    _linkedItemId: item.id,
    ...(dest ? { _destinationItemId: dest.id } : {}),
    _txNonce: saleId,
    _saleId: saleId,
    _sale: sale,
  }]
  if (destination === '__exit__') {
    transactions.push({
      type: 'WITHDRAWAL',
      symbol: item.symbol || '',
      description: `${t('Retiro', 'Withdrawal')} - ${item.name || item.symbol}`,
      date: saleDate,
      totalAmount: proceeds,
      currency,
      _linkedItemId: item.id,
      _origin: 'external',
      _txNonce: saleId,
      _saleId: saleId,
    })
  }
  return { transactions, saleId }
}
