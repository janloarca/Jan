// Qué campos cambian en cada lado de una transferencia, en UN solo lugar.
//
// ⛔ LA REGLA QUE SOSTIENE ESTE ARCHIVO: el valor de una cuenta lo define
// `getItemValue` (utils.js) y NADA MÁS. Es la función con la que el patrimonio,
// la Hoja, los reportes y los correos suman esa cuenta, así que si esta pantalla
// resta contra otra fórmula el saldo se mueve en un lado y no en el otro.
//
// Eso es exactamente lo que pasaba, y era un bug de dinero:
//
//   getItemValue(item) = quantity × getItemPrice(item)     <- lo que se MUESTRA
//   la copia vieja de acá = isBank ? currentPrice : quantity × currentPrice
//
// Las dos coinciden SOLO cuando la cuenta tiene `quantity: 1` y su precio vivo
// es `currentPrice`. Fuera de ese caso divergen, y la resta se escribía en un
// campo que el display no lee:
//
//   · una cuenta de saldo con `quantity` 0 o ausente: la pantalla decía
//     "Disponible: 5,350" (leyendo currentPrice) y el tablero mostraba 0;
//     restarle bajaba currentPrice y el tablero seguía igual;
//   · una cuenta guardada como cantidad=saldo con precio=1: la pantalla decía
//     "Disponible: 1.00" y el tablero 5,350;
//   · un activo ILÍQUIDO con `lastManualValuation`: `getItemPrice` devuelve esa
//     valuación y no `currentPrice`, así que la cantidad se restaba contra un
//     precio distinto del que multiplica en pantalla;
//   · un ítem cuyo precio vive en `price`/`cost`/`averagePrice` (los tres
//     respaldos de `getItemPrice`): la copia vieja usaba `|| 1` y restaba
//     cantidad contra un precio inventado de 1.
//
// El arreglo no es parchar cada forma: es dejar de restar de un campo y pasar a
// APUNTAR A UN VALOR. Se calcula cuánto tiene que valer la cuenta después y se
// escriben los campos que producen ESE valor leído por `getItemValue`. Con eso
// la cuenta baja exactamente lo transferido en cualquiera de las formas de
// arriba, y las que estaban torcidas quedan sanas después del movimiento.
//
// Los otros dos defectos que este módulo ya arreglaba y que siguen valiendo:
//
// 1. UNA COPIA ANGOSTA DE UNA REGLA COMPARTIDA. Las dos pantallas usaban
//    `/bank|banco|cash/i` mientras `isBankLike` (utils.js) es
//    `/bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i`, que es la que
//    FASE JA extrajo para que las superficies que corrigen un saldo no
//    divergieran. Una "Cuenta Monetaria" caía del lado NO-banco, así que
//    `purchasePrice` quedaba viejo y el tablero leía la diferencia como
//    GANANCIA en una cuenta de ahorro.
//
// 2. VACIAR UNA CUENTA CASI NUNCA LA DEJABA EN CERO. `quantity - monto/precio`
//    deja polvo de punto flotante, y con un monto redondeado a centavos deja
//    saldo NEGATIVO. Umbral de medio centavo: por debajo de eso no queda
//    dinero, queda ruido de redondeo, y una cuenta que dice "0.00" tiene que
//    estar de verdad en cero.
//
// Y la regla de "nunca fallar en silencio": cuando una cuenta no se puede
// expresar (un ítem sin ningún precio utilizable), estas funciones devuelven
// `null` y quien las llama TIENE que avisar. Escribir `{}` a Firestore es un
// no-op mudo, que es justo cómo este bug se veía desde afuera.

import { getItemValue, getItemPrice, isBankLike } from '@/components/dashboard/utils'

export const DUST = 0.005

// El valor de una cuenta con la MISMA función con la que lo muestra el resto de
// la app. La magnitud, porque un pasivo vale negativo y acá se razona sobre
// cuánto hay disponible para mover.
export function accountValue(item) {
  if (!item) return 0
  const v = getItemValue(item)
  return isFinite(v) ? Math.abs(v) : 0
}

// Los campos que hacen que `getItemValue` de este ítem valga `target`.
//
// Escribir un TARGET y no un delta es lo que hace que esto funcione en las
// cinco formas de la cabecera: no importa en qué campo viva hoy el saldo, lo
// que se fija es el valor que la app va a leer.
function balanceFields(item, target) {
  const value = target <= DUST ? 0 : target

  // Vacía. Se pone la cantidad en cero además del precio, porque con
  // `currentPrice`/`purchasePrice` en 0 `getItemPrice` cae a `price`/`cost`/
  // `averagePrice`, y un residuo ahí resucitaría el saldo.
  if (value === 0) {
    return isBankLike(item)
      ? { quantity: 0, currentPrice: 0, purchasePrice: 0 }
      : { quantity: 0 }
  }

  if (isBankLike(item)) {
    // El saldo vive en el precio, y el costo se mueve JUNTO al saldo: escribir
    // solo `currentPrice` deja el costo viejo y el tablero lee la diferencia
    // como ganancia (FASE JA).
    const fields = { currentPrice: value, purchasePrice: value }
    // `getItemValue` multiplica por la cantidad, así que una cuenta de saldo
    // con cantidad distinta de 1 mostraría otro número del que acabamos de
    // fijar. Se normaliza solo cuando hace falta.
    if (Number(item.quantity) !== 1) fields.quantity = 1
    return fields
  }

  // Un activo con precio propio: lo que cambia es la cantidad, nunca el precio.
  // El precio es el que `getItemValue` va a usar, no `currentPrice` a secas.
  const price = getItemPrice(item)
  if (!(price > 0)) return null
  return { quantity: value / price }
}

// Lo que sale del ORIGEN. `amount` va en la moneda del propio ítem.
export function debitFields(item, amount) {
  const amt = Number(amount)
  if (!item || !isFinite(amt) || amt <= 0) return null
  const value = accountValue(item)
  if (!(value > 0)) return null
  return balanceFields(item, value - amt)
}

// Lo que entra al DESTINO. `amount` va en la moneda del ítem DESTINO, que en
// una transferencia entre monedas NO es la misma que la del origen (ver
// lib/transferTx.js: ahí está el bug de acreditar quetzales como dólares).
export function creditFields(item, amount) {
  const amt = Number(amount)
  if (!item || !isFinite(amt) || amt <= 0) return null
  return balanceFields(item, accountValue(item) + amt)
}
