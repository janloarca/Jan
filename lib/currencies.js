// FASE IG. UNA sola lista de monedas para toda la app.
//
// Antes vivía COPIADA en cinco archivos (AddAccountModal, EditAccountModal,
// InlineCreateAccount, CashFlowModal, OptimizeModal) con las mismas 14 monedas,
// más una sexta en QuarterlyHistoryModal con solo 8, más VALID_CURRENCIES en
// lib/validation.js con 45. O sea: la validación aceptaba 45 monedas y el menú
// solo ofrecía 14, así que un usuario en Australia, India, Sudáfrica o Corea
// simplemente no podía elegir la suya. Cinco copias de la misma lista es
// exactamente cómo una se queda atrás (la misma lección que este repo ya
// documenta para InfoTip y para los colores).
//
// ⚠️ INVARIANTE AL AGREGAR UNA MONEDA: solo códigos que el proveedor de tasas
// (open.er-api.com, con exchangerate-api.com de respaldo) devuelva de verdad.
// `convert` sin tasa para un código devuelve el monto CRUDO, sin convertir
// (lib/serverPortfolio.js explica por qué: un cero silencioso borraría la
// cuenta del patrimonio). Eso significa que una moneda inventada aquí no
// falla: se muestra en la moneda equivocada EN SILENCIO, que es peor. Todas
// las de abajo son ISO 4217 activas y de cotización diaria.
//
// El orden es de relevancia, no alfabético: las 14 de siempre (los mercados
// del usuario y los principales) primero, en su orden original, y el resto
// alfabético. Un menú de 60 items donde GTQ está en la posición 5 sigue siendo
// usable; uno alfabético puro mandaría GTQ al medio.

// Las de siempre. Este orden se conserva a propósito: es el que los usuarios
// actuales ya tienen memorizado en el menú.
const COMMON = [
  'USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'CLP', 'ARS',
  'BRL', 'PEN', 'CAD', 'CHF', 'JPY', 'CNY',
]

// El resto del mundo con mercado líquido, alfabético. Cubre las que la
// validación ya aceptaba pero el menú nunca ofreció (AUD, NZD, HKD, SGD, INR,
// KRW, SEK, NOK, DKK, PLN, CZK, HUF, TRY, ZAR, ILS, THB, TWD, PHP, IDR, MYR,
// VND, CRC, UYU, PYG, BOB, DOP, HNL, NIO, PAB) más las que faltaban del todo.
const REST = [
  'AED', 'AUD', 'BOB', 'BSD', 'CRC', 'CZK', 'DKK', 'DOP', 'EGP', 'HKD',
  'HNL', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JMD', 'KES', 'KRW', 'MAD',
  'MYR', 'NGN', 'NIO', 'NOK', 'NZD', 'PAB', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR', 'RON', 'RSD', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TTD',
  'TWD', 'UAH', 'UYU', 'VES', 'VND', 'ZAR',
]

export const CURRENCIES = [...COMMON, ...REST]

// Las que además se aceptan al VALIDAR pero no se ofrecen en el menú: un
// activo importado puede venir denominado en cripto, y rechazarlo por eso
// perdería el dato. No se ofrecen porque el proveedor de FX no cotiza cripto,
// así que elegirlas a mano dejaría el monto sin convertir.
export const EXTRA_VALID_CURRENCIES = ['BTC', 'ETH']

// La moneda detectada de una cotización puede no estar en la lista (una bolsa
// que cotiza en subunidades, por ejemplo). Un <select> cuyo `value` no está
// entre sus opciones RENDERIZA LA PRIMERA, así que el campo mostraba "USD"
// sobre un activo guardado en otra moneda y se leía como que la plataforma la
// estaba leyendo mal (FASE IF). Esta función es esa corrección, compartida:
// lo que se ve es siempre lo que se va a guardar.
export function currencyOptions(selected, list = CURRENCIES) {
  if (!selected || list.includes(selected)) return list
  return [selected, ...list]
}
