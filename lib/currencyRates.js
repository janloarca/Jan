// Qué monedas usa de verdad este portafolio, y a qué tasa se están
// convirtiendo. Puro: sin React, sin fetch.
//
// El hueco que cierra: la app convierte TODO a la moneda base y nunca decía con
// qué tasa. Quien tiene quetzales y dólares veía un patrimonio en dólares sin
// forma de saber si el quetzal se estaba convirtiendo a 7.70 o a 7.90, ni de
// cuándo era ese número. La única superficie que mostraba una tasa
// (`CurrencyImpact`) vive dentro de una pestaña de una pestaña, y ADEMÁS
// excluye la moneda base, así que el ancla 1:1 no aparecía en ningún lado.
//
// El mapa `rates` que devuelve /api/exchange-rates está anclado en USD:
// `rates[CUR]` son cuántas unidades de CUR hay en UN dólar. Por eso el ancla de
// esta tarjeta es el dólar y no la moneda base: es la forma NATIVA del dato, no
// una derivación. Anclarlo a la base obligaría a dividir, y una división
// introduce un número que no vino de ninguna fuente.

// El código de moneda de un ítem, con la MISMA regla que ya usa el resto del
// tablero (`CurrencyImpact`, y el enriquecimiento de useDashboardData):
// `_originalCurrency` es la moneda en la que el ítem está denominado de verdad,
// antes de convertir; `currency` es el respaldo para un ítem que nunca pasó por
// el enriquecimiento.
export function currencyOfItem(item) {
  const raw = item?._originalCurrency || item?.currency || 'USD'
  return String(raw).toUpperCase()
}

// Las monedas presentes en el portafolio, sin repetir.
//
// Se cuentan los ítems de DEUDA igual que los demás: una tarjeta en quetzales
// se convierte con la misma tasa y quien la tiene necesita verla. Lo que sí se
// salta es un ítem sin valor ni deuda declarada, para que un registro a medio
// llenar no meta una moneda que en la práctica no mueve nada.
export function usedCurrencies(items) {
  const seen = new Set()
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue
    seen.add(currencyOfItem(it))
  }
  return [...seen]
}

// Las filas de la tarjeta, en el orden en que se leen.
//
// Reglas, y ninguna inventa un número:
//  · El dólar SIEMPRE va primero y SIEMPRE en 1, aunque el portafolio no tenga
//    un solo activo en dólares: es el ancla contra la que se leen las demás.
//  · Una moneda sin tasa conocida sale con `rate: null` y la tarjeta lo dice.
//    Es justo el caso en que `convert` devuelve el monto CRUDO (sin convertir),
//    o sea el patrimonio está sumando peras con manzanas: callarlo sería la
//    degradación muda que este repo prohíbe.
//  · El resto va alfabético. No por valor: esto es una tabla de referencia, no
//    un ranking, y el orden alfabético es el que deja encontrar una moneda.
export const ANCHOR = 'USD'

export function buildRateRows({ currencies, rates, baseCurrency } = {}) {
  const base = String(baseCurrency || ANCHOR).toUpperCase()
  const list = Array.isArray(currencies) ? currencies.map((c) => String(c).toUpperCase()) : []
  const codes = [...new Set([ANCHOR, ...list])]

  const others = codes.filter((c) => c !== ANCHOR).sort()
  return [ANCHOR, ...others].map((code) => {
    if (code === ANCHOR) return { code, rate: 1, isBase: base === ANCHOR, isAnchor: true }
    const raw = rates && rates[code]
    const rate = typeof raw === 'number' && isFinite(raw) && raw > 0 ? raw : null
    return { code, rate, isBase: base === code, isAnchor: false }
  })
}

// Cuántos decimales necesita una tasa para ser útil.
//
// Un fijo no sirve para el rango real: 7.70 (quetzal) y 0.00047 (peso chileno
// por dólar invertido, o una cripto) piden precisiones muy distintas, y
// redondear la segunda a dos decimales la vuelve "0.00", que se lee como cero.
export function rateDecimals(rate) {
  if (!(typeof rate === 'number' && isFinite(rate) && rate > 0)) return 2
  if (rate >= 1000) return 0
  if (rate >= 100) return 2
  if (rate >= 1) return 4
  return 6
}

export function formatRate(rate, lang = 'es') {
  if (!(typeof rate === 'number' && isFinite(rate) && rate > 0)) return null
  const d = rateDecimals(rate)
  return rate.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}
