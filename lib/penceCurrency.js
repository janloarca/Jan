// FASE ID. Las bolsas de Londres cotizan en PENIQUES y Yahoo lo reporta con el
// código literal 'GBp' (a veces 'GBX'): 1/100 de libra esterlina. Todo convert
// de este repo upper-caseaba el código antes de buscar la tasa, así que 'GBp'
// colisionaba con 'GBP' y se aplicaba la tasa de la LIBRA a un monto en
// PENIQUES: la acción de Shell de la prueba real (~$44) se registró como
// $4,440, cien veces inflada, con la etiqueta "1 GBp = 1.3504 USD" impresa en
// el Spreadsheet como prueba del delito.
//
// La normalización vive a nivel de CÓDIGO DE MONEDA y corre ANTES de cualquier
// uppercase (el uppercase ES el bug: 'GBp' y 'GBP' solo difieren en la caja de
// la p). Trata al penique como lo que es: una moneda que vale 0.01 libras. Con
// eso ningún precio necesita reescribirse: los items ya guardados con
// currency 'GBp' y precio en peniques se valoran bien en el siguiente render,
// sin migración.
//
// 'GBp' se compara EXACTO (la p minúscula es la señal); 'GBX' es inequívoco y
// se acepta en cualquier caja. Un 'GBP' o 'gbp' de verdad es libra y no pasa
// por aquí.
export function normalizeCurrency(code) {
  const raw = typeof code === 'string' ? code.trim() : ''
  if (!raw) return { code: 'USD', factor: 1 }
  if (raw === 'GBp' || raw.toUpperCase() === 'GBX') return { code: 'GBP', factor: 0.01 }
  return { code: raw.toUpperCase(), factor: 1 }
}

// Conversión con tasas + normalización de peniques, compartida por el hook del
// cliente (useExchangeRates) y el convert del servidor (lib/serverPortfolio):
// dos copias de esta aritmética es exactamente cómo una se queda atrás. La
// convención de `rates` es la de siempre: unidades de cada moneda por 1 USD.
// Sin tasa para alguno de los dos códigos devuelve el monto CRUDO (nunca cero:
// un cero silencioso borra una cuenta del patrimonio), salvo el caso
// penique<->libra, que no necesita ninguna tasa (es un factor fijo).
export function convertWithRates(amount, fromCurrency, toCurrency, rates, { warn = null } = {}) {
  if (!amount) return amount || 0
  const f = normalizeCurrency(fromCurrency || 'USD')
  const t = normalizeCurrency(toCurrency || 'USD')
  if (f.code === t.code && f.factor === t.factor) return amount
  // Peniques a libras (o al revés) es un factor fijo, sin tasa de por medio.
  if (f.code === t.code) {
    const result = (amount * f.factor) / t.factor
    return isFinite(result) ? result : amount
  }
  if (!rates) return amount
  const fromRate = rates[f.code]
  const toRate = rates[t.code]
  if (!fromRate || !toRate) {
    if (warn) warn(!fromRate ? f.code : t.code)
    return amount
  }
  const result = ((amount * f.factor) / fromRate) * toRate / t.factor
  return isFinite(result) ? result : amount
}
