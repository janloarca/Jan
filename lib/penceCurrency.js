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

// FASE IE. Qué unidad usar para el PRECIO DE COMPRA de un activo cotizado.
//
// El precio de entrada de un activo de mercado se teclea desde la misma
// pantalla de cotización (AddAccountModal pre-llena "Entry price" con el precio
// del quote), así que está en la MISMA unidad que la cotización. Pero la moneda
// se guarda como un campo aparte, y puede quedar en la divisa correcta con la
// unidad equivocada: el select de moneda no tenía 'GBp' en su lista (FASE ID),
// así que un item de Londres quedó guardado con currency 'GBP' (libras) y un
// precio en PENIQUES. Con cada lado convertido por su cuenta, el valor sale
// bien ($44.75, vía la moneda del quote) y el costo 100x inflado ($4,479, vía
// la guardada): "-99.00%" de retorno sobre una acción que no se movió. Antes de
// FASE ID los DOS lados estaban 100x inflados y el error se cancelaba solo.
//
// La regla: cuando la moneda guardada y la del quote son la MISMA DIVISA pero
// difieren en la unidad (libra vs penique), manda la del quote. Si son divisas
// distintas (un precio de compra tecleado en USD para una acción de Londres)
// se respeta la guardada: eso es un dato deliberado del usuario, no una
// discrepancia de unidad.
export function resolvePriceCurrency(storedCurrency, marketCurrency) {
  const stored = storedCurrency || 'USD'
  if (!marketCurrency) return stored
  const s = normalizeCurrency(stored)
  const m = normalizeCurrency(marketCurrency)
  return s.code === m.code ? marketCurrency : stored
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
