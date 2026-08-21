// Marcas de eje en valores REDONDOS (Heckbert, "Nice Numbers for Graph Labels",
// Graphics Gems 1990). Extraído de components/dashboard/PortfolioGrowthChart.jsx
// en FASE KK, cuando la página compartida necesitó el mismo eje: dos copias de
// este reparto es exactamente cómo una se queda atrás.
//
// Cambia QUÉ líneas se dibujan y hasta dónde llega el eje, NUNCA cuánto vale un
// punto: los valores de la serie no se tocan, solo el marco contra el que se
// dibujan.
export function niceNum(x, round) {
  if (!isFinite(x) || x <= 0) return 1
  const exp = Math.floor(Math.log10(x))
  const f = x / Math.pow(10, exp)
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10)
  return nf * Math.pow(10, exp)
}

// El eje se ensancha a lo sumo UN paso por lado, así que el rango crece como
// mucho a ~1.7x: el piso anti-ruido de una serie plana sobrevive intacto, y una
// gráfica que hoy se lee bien no se aplasta.
//
// Devuelve null cuando el reparto redondo no sirve (rango cero, o un paso que
// deja el eje con una sola marca o con once). En ese caso el caller conserva su
// reparto de siempre, que es el comportamiento previo exacto.
export function niceScale(lo, hi, count) {
  const span = hi - lo
  if (!isFinite(span) || span <= 0) return null
  const step = niceNum(span / Math.max(count - 1, 1), true)
  if (!isFinite(step) || step <= 0) return null
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const n = Math.round((max - min) / step) + 1
  if (!isFinite(n) || n < 2 || n > 11) return null
  // toPrecision mata el polvo de coma flotante (0.1+0.2 sobre un paso de 0.05
  // imprime "0.15000000000000002" en el rótulo si no se limpia).
  const clean = (v) => parseFloat(v.toPrecision(12))
  return { min: clean(min), max: clean(max), step: clean(step), count: n }
}

// Decimales que un porcentaje necesita para que dos marcas vecinas no impriman
// lo mismo. Con pasos redondos (5, 2, 1) da 0 y el eje sale "+5%", no "+5.00%".
export function pctDecimals(step) {
  if (!isFinite(step) || step <= 0) return 2
  return Math.min(2, Math.max(0, Math.ceil(-Math.log10(step))))
}
