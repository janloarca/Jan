// Una cuenta de saldo cuyo SALDO existe pero cuya CANTIDAD quedó en cero.
//
// `getItemValue` es `quantity × precio`, así que con la cantidad en cero la
// cuenta vale 0 para el patrimonio, la Hoja y los reportes, por más que su
// precio (que es DONDE una cuenta de saldo guarda su saldo) diga otra cosa. Y
// el usuario no tiene salida: el editor de cuenta muestra el saldo bien (su pie
// cae a cantidad 1 para un ítem de banco) pero al guardar reescribe la cantidad
// tal cual, así que abrir y guardar no lo arregla.
//
// Cómo se llega ahí, las dos formas reales:
//  1. Vaciar la cuenta (transferir o retirar todo) escribe `quantity: 0`
//     (lib/transferFields.js, a propósito: con el precio en 0 un residuo en
//     `price`/`cost` resucitaría el saldo), y DESPUÉS le entra un cupón: el
//     camino del dividendo escribía el precio nuevo y no tocaba la cantidad.
//  2. Una cuenta creada sin cantidad (FASE JD3 ya documenta que existen).
//
// ⛔ EL ALCANCE ES `isBankLike` Y ESO ES LO QUE LO HACE SEGURO, no una
// precaución de más. En un ítem de banco vaciar escribe TAMBIÉN el precio en
// cero, así que "cantidad 0 con precio > 0" no puede venir de un vaciado: es la
// firma de un crédito que aterrizó después. En cambio un ítem que NO es de
// banco conserva su precio al vaciarse (`{ quantity: 0 }` a secas), así que ahí
// la misma firma describe una posición legítimamente vacía y "sanarla"
// resucitaría dinero que de verdad se movió. Un activo de mercado es el mismo
// caso: cantidad 0 es una posición VENDIDA y su precio de mercado sigue vivo.
//
// La cantidad que se escribe es 1 y tampoco es una elección: es exactamente la
// que el resto de la app ya asume para estas cuentas (el pie del editor, el
// divisor de `creditDestinationBalance`, `balanceFields` al normalizar). No se
// inventa dinero: el saldo ya estaba escrito en el precio y esto solo lo vuelve
// legible.

import { isBankLike, getItemPrice } from '@/components/dashboard/utils'

export function zeroQuantityBalanceFixes(items) {
  const out = []
  for (const it of items || []) {
    if (!it || !it.id) continue
    if (!isBankLike(it)) continue
    // Una posición vendida se queda como está, pase lo que pase.
    if (it.soldFully || it.saleDate) continue
    const qty = Number(it.quantity)
    if (Number.isFinite(qty) && qty > 0) continue
    const price = getItemPrice(it)
    if (!(Number.isFinite(price) && price > 0)) continue
    out.push(it.id)
  }
  return out
}
