import { getItemValue } from '@/components/dashboard/utils'
import { rankDayMovers } from '@/lib/dayMovers'

// Builds the PUBLIC stats a user publishes to a friend group. The cardinal rule:
// only percentages and symbols ever leave the client — NEVER money amounts. Two
// users with different base currencies stay comparable because every number here
// is a ratio (return %, daily %, weight × daily %).
//
//   buildFriendStats({ enrichedItems, returnYTD, dailyChange, totalAssets, scopeFilter })
//     → { ytd, day, movers: [{ symbol, name, changePct }] }
//
// - ytd:   Modified-Dietz YTD % (already computed upstream), or null when it
//          falls outside the representable band (see boundedPct).
// - day:   portfolio daily change % (from useDashboardData's dailyChange).
// - movers: the positions that moved the portfolio the most TODAY, ordered by
//   impact (weight × change1d) but publishing only each position's OWN move.
//   The impact number itself is deliberately withheld: published next to the
//   change it lets anyone divide one by the other and recover the position's
//   weight in the portfolio. See the block that builds them.
//
// scopeFilter (optional) narrows the items feeding `day`/`movers` to a subset
// (e.g. only IBKR-sourced) for scoped groups.

const MAX_MOVERS = 5

// La forma de una fecha de sesión, en UN solo lugar.
//
// FASE KO. `dayAsOf` es lo ÚNICO nuevo que sale del cliente hacia el servidor
// en este módulo, y el cliente no es de fiar: `app/api/friends/route.js`
// re-valida todo lo que recibe (esa es la regla de esta superficie). Que el
// productor y el validador compartan la definición es lo que impide que se
// separen, y por eso vive acá y no escrita a mano en la ruta.
//
// Solo 'YYYY-MM-DD' exacto. Cualquier otra cosa es null: nunca una cadena
// arbitraria, que terminaría renderizada en la pantalla de otra persona.
export function sanitizeDayAsOf(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null
}

// Fuera de banda NO es el borde de la banda: es "no se puede medir".
//
// FASE JA5. Esto CLAMPEABA (`Math.max(-200, Math.min(200, v))`), o sea un YTD
// roto de +8,400% se publicaba como exactamente +200.00% y, como el ranking
// ordena descendente, ENCABEZABA el grupo y el tablero global. Desde afuera es
// indistinguible de un +200% real, así que el dato más roto del grupo salía
// primero y con cara de campeón. Este repo ya produjo varias veces justo esa
// clase de cifra (+1148.8% en el reporte, +472.47% en la gráfica, +13,207 de
// ganancia sobre una cuenta de $10K), y todas terminan acá si el usuario
// publica en ese momento.
//
// La banda de ±200 no cambia: es la decisión de producto que ya existía. Lo que
// cambia es qué se hace al cruzarla. Un valor que no cabe en la banda no se
// conoce, así que se publica null y la fila muestra "-", que es cierto. El
// costo aceptado: un año genuino de +250% pierde su número; publicar 200% para
// él también sería falso, y de esa forma además gana el primer lugar.
//
// Ojo con el orden de los chequeos: `Number(null)` es 0 y 0 es finito, así que
// el null tiene que descartarse ANTES (la misma trampa que este repo ya pagó en
// `annualizedReturnPct` y en la tasa del plan de ingresos).
export const PCT_BOUND = 200
// Y la cadena vacía es la misma trampa vestida de texto: `Number('')` también
// es 0. Del lado del servidor, donde el cuerpo lo escribe un cliente que no es
// de fiar, un `ytd: ""` se publicaba como "su retorno fue exactamente 0%" y en
// un ranking eso es una POSICIÓN, no una ausencia. Un número en texto
// ("12.5") sí se acepta: eso es un dato, solo que serializado.
// ⛔ Se acepta por TIPO, no por coerción. Parchar `null` y `''` uno por uno
// dejaba abiertas las demás formas que `Number()` convierte en 0 sin que nadie
// haya reportado un retorno: `Number([])`, `Number(false)` y `Number(new
// Date(0))` son todos 0, y `Number([12.5])` es 12.5. Del lado del servidor el
// cuerpo lo escribe un cliente que no es de fiar, así que una ausencia
// disfrazada entra al ranking como "exactamente 0%", que es una POSICIÓN y no
// una ausencia. Un número en texto ("12.5") sí se acepta: es un dato, solo que
// serializado.
export function boundedPct(v) {
  if (typeof v === 'number') {
    if (!isFinite(v)) return null
    return Math.abs(v) > PCT_BOUND ? null : v
  }
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  if (!isFinite(n)) return null
  return Math.abs(n) > PCT_BOUND ? null : n
}

// La forma PÚBLICA de un mover, en UN solo lugar, igual que `sanitizeDayAsOf` y
// `boundedPct`: la usa el productor (acá) y el validador del servidor
// (`app/api/friends/route.js`), al escribir Y al leer.
//
// Es una ALLOWLIST a propósito: un campo que alguien agregue al documento más
// adelante no puede salir al mundo por accidente, tiene que nombrarse acá.
// Y por eso también se aplica al LEER: todo perfil ya publicado tiene
// `impactPct` guardado, así que un arreglo que solo cambie lo que se escribe de
// aquí en adelante no cerraría nada hoy; el campo viejo se queda en Firestore
// hasta el próximo sync de esa persona, pero ya no sale.
export function publicMovers(movers) {
  if (!Array.isArray(movers)) return []
  return movers.slice(0, MAX_MOVERS).map((m) => ({
    symbol: String(m?.symbol || '?').slice(0, 12),
    name: String(m?.name || '').slice(0, 40),
    changePct: boundedPct(m?.changePct),
  })).filter((m) => m.changePct != null)
}

export function buildFriendStats({ enrichedItems, returnYTD, returnMTD, dailyChange, totalAssets, scopeFilter } = {}) {
  const items = Array.isArray(enrichedItems) ? enrichedItems : []
  const scoped = typeof scopeFilter === 'function' ? items.filter(scopeFilter) : items

  // Total assets of the scoped set — used as the denominator for mover weights.
  // Fall back to the passed-in totalAssets for the unscoped ('all') case.
  const scopedTotal = typeof scopeFilter === 'function'
    ? scoped.reduce((s, it) => { const v = getItemValue(it); return v > 0 ? s + v : s }, 0)
    : (isFinite(totalAssets) && totalAssets > 0
        ? totalAssets
        : scoped.reduce((s, it) => { const v = getItemValue(it); return v > 0 ? s + v : s }, 0))

  const day = typeof dailyChange === 'number'
    ? boundedPct(dailyChange)
    : boundedPct(dailyChange?.pct)

  // ⛔ FASE KN. El MISMO motor que la tarjeta del patrimonio (lib/dayMovers.js),
  // agregado POR ACTIVO. Este bloque mapeaba item por item sin ningún rollup,
  // así que quien tiene BTC en dos cuentas publicaba DOS movers "BTC" a sus
  // grupos: el mismo defecto que la tarjeta, una superficie más allá.
  //
  // El contrato de privacidad NO cambia: siguen saliendo solo símbolos y
  // porcentajes, nunca montos (`dollarChange` se descarta acá a propósito).
  // Y se le pasan sus propios parámetros para que los NÚMEROS publicados no se
  // muevan: `total` es el denominador de siempre (suma de valores POSITIVOS, no
  // Σ|valor|) y `minWeight: 0` conserva que acá no hay piso de peso.
  // ⛔ FASE KO. DE CUÁNDO son estas cifras.
  //
  // `day` y `movers` salen de `change1d`, que para una ACCIÓN es la última
  // sesión bursátil COMPLETADA: un sábado es el movimiento del VIERNES, y lo
  // mismo un feriado o un martes antes de la apertura. Para CRIPTO es una
  // ventana rodante de 24 h, siempre viva. Sin esta fecha, un grupo de amigos
  // rankeaba "hoy" comparando a quien tiene acciones (congelado en el viernes)
  // contra quien tiene cripto (que sí se movió el sábado), y la pantalla decía
  // "hoy" sobre las dos. Es el mismo defecto que la tarjeta del patrimonio ya
  // arregló, una superficie más allá y peor: acá se COMPARA gente.
  //
  // Es una FECHA, nunca un monto: el contrato de privacidad no se mueve.
  let dayAsOf = null
  let movers = []
  if (scopedTotal > 0) {
    const ranked = rankDayMovers({
      items: scoped,
      getValue: getItemValue,
      isEligible: (it) => !it.isDebt && isFinite(it.change1d),
      total: scopedTotal,
      minWeight: 0,
    })
    dayAsOf = ranked.asOf
    // ⛔ FASE JA6. El IMPACTO se usa para ORDENAR y filtrar, y NO se publica.
    //
    // Decisión del usuario (23 ago 2026), sobre una fuga real: publicando el %
    // que se movió la posición Y su impacto en el portafolio, cualquiera que
    // reciba la fila despeja el PESO exacto de esa posición con una división
    // (peso = impacto ÷ cambio), o sea "BTC es el 47% de su cartera". No son
    // montos, así que el contrato de "nunca montos" seguía en pie, pero la
    // composición de la cartera es más de lo que la tarjeta promete.
    //
    // Quitar el campo NO cuesta el ranking: `rankDayMovers` ya ordena por
    // impacto acá, del lado del cliente, y ese orden sobrevive tal cual (un
    // arreglo de Firestore conserva su orden y la ruta no reordena). Lo único
    // que desaparece es el número del que se despejaba el peso. Por eso el
    // filtro y el corte se hacen ANTES de armar la forma pública.
    movers = ranked.rows
      .filter((m) => isFinite(m.impactPct) && m.impactPct !== 0 && boundedPct(m.pct) != null)
      .slice(0, MAX_MOVERS)
      .map((m) => ({
        symbol: String(m.label || '?').slice(0, 12).toUpperCase(),
        name: String(m.name || m.label || '').slice(0, 40),
        changePct: boundedPct(m.pct),
      }))
  }

  return { ytd: boundedPct(returnYTD), mtd: boundedPct(returnMTD), day, movers, dayAsOf: sanitizeDayAsOf(dayAsOf) }
}
