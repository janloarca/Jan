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

// El saldo que VUELVE después de vaciar la cuenta.
//
// Segundo síntoma del mismo hueco (reportado con capturas, 28 ago 2026): el
// motor de aportes vaciaba escribiendo los dos precios en cero y dejaba la
// cantidad, así que `getItemPrice` caía en cascada a `price`/`cost` y un
// residuo ahí resucitaba el saldo. El usuario retiró 240, el movimiento SÍ
// quedó archivado (su historial de junio y julio subió 240, que es el
// rebobinado leyéndolo bien) y el saldo de hoy volvió a 240.
//
// ⛔ LA FIRMA ES LO QUE HACE SEGURA LA REGLA, y por eso pide las TRES cosas a
// la vez: los DOS precios en cero (`currentPrice` Y `purchasePrice`: es la
// escritura literal de un vaciado, nadie más deja ese par), una cantidad que
// todavía puede multiplicar, y un residuo vivo en los campos de respaldo. Con
// los dos precios en cero no queda ninguna lectura en la que ese residuo sea el
// saldo bueno: sería un saldo que la app misma acaba de declarar cero por los
// dos lados. Fuera de `isBankLike` no se toca nada, por la misma razón que
// arriba: en un activo de mercado el precio vive legítimamente en esos campos.
//
// Se pone la CANTIDAD en cero, no se borran los campos: es exactamente lo que
// `lib/transferFields.js` ya hace al vaciar por transferencia, así que las dos
// puertas dejan la cuenta en el mismo estado.
export function resurrectedBalanceFixes(items) {
  const out = []
  for (const it of items || []) {
    if (!it || !it.id) continue
    if (!isBankLike(it)) continue
    if (it.soldFully || it.saleDate) continue
    const cur = Number(it.currentPrice)
    const pur = Number(it.purchasePrice)
    // Los dos precios EXPLÍCITAMENTE en cero. Un campo ausente no cuenta: eso
    // es una cuenta a la que nunca se le escribió, no una que se vació.
    if (!(Number.isFinite(cur) && cur === 0)) continue
    if (!(Number.isFinite(pur) && pur === 0)) continue
    const qty = Number(it.quantity)
    if (!(Number.isFinite(qty) && qty > 0)) continue
    // Sin residuo no hay nada que sanar: la cuenta ya vale cero de verdad.
    const price = getItemPrice(it)
    if (!(Number.isFinite(price) && price > 0)) continue
    out.push(it.id)
  }
  return out
}
