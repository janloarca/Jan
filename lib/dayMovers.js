// Los mayores movimientos del día, agregados POR ACTIVO.
//
// ⛔ POR QUÉ ESTO EXISTE (FASE KN). La lista vivía inline en NetWorthCard y
// deduplicaba por ID DE ÍTEM, así que quien tiene el mismo activo en dos
// cuentas veía DOS filas "BTC" compitiendo entre sí (captura real del usuario:
// "BTC +$9.46" y "BTC +$24.42" en la misma lista). Y como el render usaba la
// etiqueta como llave de React, esas dos filas homónimas dejaban un nodo rancio
// al cambiar de pestaña: la lista de PERDEDORES abría con una fila verde de
// ganancia. Un solo defecto, dos síntomas.
//
// La regla: un activo es un SÍMBOLO, no una posición. Dos holdings del mismo
// símbolo comparten cotización por construcción (`useMarketPrices` llavea el
// mapa de precios por símbolo en mayúsculas), así que sumarlos no mezcla dos
// cosas distintas: las junta.
//
// Módulo puro (sin React ni Firestore), para que la tarjeta del patrimonio y lo
// que se publica a Amigos no puedan volver a discrepar sobre qué se movió hoy.

// Un activo por debajo de este peso no encabeza nada: el ±10 % de una posición
// de $5 no es la noticia del día de nadie. Se mide sobre el activo YA AGREGADO,
// que es lo correcto: dos posiciones chicas del mismo símbolo suman una grande.
const MIN_WEIGHT = 0.005 // 0.5 % del portafolio

// ¿Qué representa el `change1d` de este ítem?
//
//   'session'    una sesión bursátil cerrada (acciones). Yahoo devuelve el
//                movimiento de la ÚLTIMA sesión completada, así que un sábado
//                (o un martes antes de la apertura) sigue siendo el de la
//                sesión anterior: real, pero no de HOY.
//   'rolling24h' una ventana rodante de 24 h (cripto, CoinGecko). Siempre
//                fresca, nunca alineada a un día calendario.
//
// Sin metadata se asume 'session', que es el comportamiento de siempre.
export function moverWindowOf(item) {
  return item?._change1dWindow === 'rolling24h' ? 'rolling24h' : 'session'
}

// La ETIQUETA que la fila muestra, normalizada. A propósito NO es el `symbol` a
// secas: CLAUDE.md (FASE HV11) documenta que las DOS posiciones de Bitcoin de
// este mismo usuario llegaron a tener el campo `symbol` distinto (una 'BTC', la
// otra con el nombre puesto ahí). Agrupar por lo que se VE es lo que hace que
// dos filas idénticas en pantalla se sumen; si de verdad son símbolos distintos
// tampoco comparten cotización y es correcto que no se junten.
export function moverLabelOf(item) {
  return item?.symbol || item?.name || ''
}

export function moverKeyOf(item) {
  const label = String(moverLabelOf(item)).trim().toUpperCase()
  return label || `id:${item?.id || '?'}`
}

/**
 * @param items       ítems ENRIQUECIDOS (change1d ya resuelto, valor en moneda base)
 * @param getValue    (item) => valor en moneda base, con signo
 * @param isEligible  (item) => ¿cuenta para el patrimonio? (deuda/excluidos fuera)
 * @param total       denominador del impacto. Sin él se usa Σ|valor| de lo elegible.
 * @param minWeight   piso de peso del ACTIVO ya agregado (0 lo apaga)
 * @returns { rows, total, asOf } — `rows` ordenadas por impacto, sin partir
 *   cada fila: { key, label, name, pct, dollarChange, impactPct, window, asOf, count }
 */
export function rankDayMovers({ items, getValue, isEligible, total: totalOverride = null, minWeight = MIN_WEIGHT } = {}) {
  const empty = { rows: [], total: 0, asOf: null }
  if (!Array.isArray(items) || items.length === 0) return empty
  if (typeof getValue !== 'function') return empty

  const eligible = items.filter((it) => it && (typeof isEligible !== 'function' || isEligible(it)))
  const total = (Number.isFinite(totalOverride) && totalOverride > 0)
    ? totalOverride
    : eligible.reduce((s, it) => s + Math.abs(getValue(it) || 0), 0)
  if (!(total > 0)) return empty

  // Agregación por activo. `value` y `dollarChange` se suman porque son montos;
  // `pct` NO se suma: dos posiciones del mismo símbolo comparten cotización, así
  // que su cambio del día es el mismo número. Se pondera por valor de todos
  // modos, para que un dato inconsistente degrade a algo razonable en vez de
  // quedarse con el que la iteración vio último.
  const byAsset = new Map()
  for (const it of eligible) {
    const pct = Number(it.change1d)
    if (it.change1d == null || !isFinite(pct)) continue
    const value = getValue(it) || 0
    if (!isFinite(value) || value === 0) continue
    const key = moverKeyOf(it)
    const prev = byAsset.get(key)
    if (prev) {
      prev.value += value
      prev.pctWeighted += pct * Math.abs(value)
      prev.absValue += Math.abs(value)
      prev.count += 1
      // Dos ventanas distintas bajo el mismo símbolo no debería pasar (misma
      // cotización), pero si pasara la más conservadora manda.
      if (moverWindowOf(it) === 'session') prev.window = 'session'
      // Basta que UNA parte venga de respaldo para que la fila no sea live.
      if (it._priceStale) prev.stale = true
      // La fecha más VIEJA gobierna: la fila no puede afirmar más frescura que
      // su parte más rancia.
      const d = it._change1dAsOf
      if (d && (!prev.asOf || d < prev.asOf)) prev.asOf = d
    } else {
      byAsset.set(key, {
        key,
        label: moverLabelOf(it) || key,
        name: it.name || it.symbol || '',
        value,
        pctWeighted: pct * Math.abs(value),
        absValue: Math.abs(value),
        count: 1,
        window: moverWindowOf(it),
        asOf: it._change1dAsOf || null,
        stale: it._priceStale === true,
      })
    }
  }

  const minValue = total * (Number.isFinite(minWeight) ? minWeight : MIN_WEIGHT)
  const rows = []
  for (const a of byAsset.values()) {
    if (Math.abs(a.value) < minValue) continue
    const pct = a.absValue > 0 ? a.pctWeighted / a.absValue : 0
    if (!isFinite(pct)) continue
    rows.push({
      key: a.key,
      label: a.label,
      name: a.name,
      pct,
      // El monto que este activo le movió al patrimonio hoy.
      dollarChange: a.value * (pct / 100),
      // Cuánto de ESO pesa sobre el portafolio entero. Misma definición que
      // lib/friendsStats.js: peso × cambio del día.
      impactPct: (a.value / total) * pct,
      window: a.window,
      asOf: a.asOf,
      // La cotización de esta fila salió del respaldo last-known-good (que
      // guarda hasta SIETE días), no de una consulta viva. Antes se dibujaba
      // igual que una fresca y nada lo decía.
      stale: !!a.stale,
      // Cuántas posiciones se fusionaron acá. La UI puede decirlo ("2 cuentas")
      // en vez de dejar al usuario preguntándose por qué el número no cuadra
      // con una sola de sus cuentas.
      count: a.count,
    })
  }

  // Un 0.00 % exacto no es un ganador: iba a la pestaña verde con su flechita
  // hacia arriba y en un día plano la llenaba de ceros. Sin movimiento no hay
  // movimiento que reportar, así que no entra a ninguna de las dos listas.
  // La dirección de una fila es la del DINERO que movió, no la del porcentaje.
  // Casi siempre son el mismo signo; difieren cuando el valor del activo es
  // negativo (un saldo en descubierto que no está marcado como deuda), y ahí
  // clasificar por `pct` ponía un monto POSITIVO bajo la flecha roja. Con esto
  // la flecha, el signo del monto y la pestaña coinciden por construcción.
  const moved = rows.filter((r) => r.pct !== 0 && r.dollarChange !== 0)

  // ⛔ Se ordena por lo que MOVIÓ EL PATRIMONIO, no por el % propio de la
  // posición. La lista se titula "mayores movimientos" y su pie dice literal
  // "% = impacto sobre tu portafolio total", pero ordenaba por `pct`: una
  // posición de $50 que subió 8 % le ganaba a una de $5,000 que subió 2 % y que
  // de verdad movió el día. Por eso el orden de esta tarjeta no se parecía en
  // nada al de la lista del broker, que rankea por P&L en dinero.
  // `impactPct` y `dollarChange` son proporcionales (total es constante), así
  // que ordenar por cualquiera de los dos da el MISMO orden; se usa el impacto
  // porque es la cifra que la fila imprime. Empate: el % propio desempata, para
  // que el orden sea determinista y no dependa de la iteración del Map.
  const byImpact = (a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct) || Math.abs(b.pct) - Math.abs(a.pct)
  return { rows: moved.sort(byImpact), total, asOf: staleSessionOf(moved) }
}

// La frescura de una LISTA es la de su parte más rancia: si alguna fila viene de
// una sesión cerrada, la tarjeta no puede titularse "hoy".
export function staleSessionOf(rows) {
  let asOf = null
  for (const r of rows || []) {
    if (!r || r.window !== 'session' || !r.asOf) continue
    if (!asOf || r.asOf < asOf) asOf = r.asOf
  }
  return asOf
}

// La misma lista, partida en las dos pestañas de la tarjeta.
export function computeDayMovers({ limit = 5, ...opts } = {}) {
  const { rows, total } = rankDayMovers(opts)
  const gainers = rows.filter((r) => r.dollarChange > 0).slice(0, limit)
  const losers = rows.filter((r) => r.dollarChange < 0).slice(0, limit)
  return { gainers, losers, total, asOf: staleSessionOf([...gainers, ...losers]) }
}
