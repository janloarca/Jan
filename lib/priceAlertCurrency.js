// FASE OE. La moneda de una ALERTA DE PRECIO es la de la COTIZACIÓN, no la
// base del usuario.
//
// `checkPriceAlerts` (lib/notifications.js) compara `alert.targetPrice` contra
// `prices[sym].price` tal cual llega del proveedor: dólares para AAPL,
// coronas para NOVO-B.CO, yenes para 2938.T y PENIQUES para SHEL.L (Yahoo
// cotiza Londres en GBp). La pantalla imprimía objetivo y precio actual con
// `formatCurrency(x)` a secas, o sea con el símbolo de la moneda BASE: a
// quien tiene base en quetzales, AAPL a $200 le decía "GTQ 200.00", y a
// cualquiera Shell a 2,650 peniques le decía "$2,650.00". Reproducido con el
// componente real.
//
// Una alerta no convierte nada a propósito: el usuario teclea el precio que
// ve en el mercado, y ESE es el número contra el que se compara. Lo que hay
// que hacer es DECIRLO, en el formulario y en la lista.

// Códigos de unidad MENOR que Yahoo emite para algunas bolsas. `Intl` los
// acepta sin distinguir mayúsculas y formatearía 2,650 peniques como
// "£2,650.00", que es cien veces más: se imprimen como número más código.
const MINOR_UNIT_CODES = new Set(['GBP_PENCE', 'GBX', 'ZAC', 'ILA'])
function isMinorUnit(code) {
  if (!code) return false
  if (code === 'GBp' || code === 'ZAc' || code === 'ILa') return true
  return MINOR_UNIT_CODES.has(String(code).toUpperCase())
}

export function quoteCurrencyOf(prices, symbol) {
  if (!prices || !symbol) return null
  const p = prices[symbol] || prices[String(symbol).toUpperCase()]
  const cur = p && p.currency
  return cur ? String(cur) : null
}

// Imprime un precio en la moneda de su cotización. Sin moneda conocida cae al
// número a secas: un símbolo de moneda que no se puede afirmar es peor que
// ninguno (es exactamente lo que este módulo vino a quitar).
export function formatQuotePrice(value, currency, formatCurrency) {
  if (value == null || !isFinite(value)) return '-'
  const n = Number(value)
  if (!currency) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (isMinorUnit(currency)) return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency).toUpperCase(), minimumFractionDigits: 2 }).format(n)
  } catch {
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}
