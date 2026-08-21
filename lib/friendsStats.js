import { getItemValue } from '@/components/dashboard/utils'
import { rankDayMovers } from '@/lib/dayMovers'

// Builds the PUBLIC stats a user publishes to a friend group. The cardinal rule:
// only percentages and symbols ever leave the client — NEVER money amounts. Two
// users with different base currencies stay comparable because every number here
// is a ratio (return %, daily %, weight × daily %).
//
//   buildFriendStats({ enrichedItems, returnYTD, dailyChange, totalAssets, scopeFilter })
//     → { ytd, day, movers: [{ symbol, name, changePct, impactPct }] }
//
// - ytd:   Modified-Dietz YTD % (already computed upstream), clamped, or null.
// - day:   portfolio daily change % (from useDashboardData's dailyChange).
// - movers: the positions that moved the portfolio the most TODAY — impact =
//   weight × change1d. This is the "why did my day go the way it did" view the
//   user wants friends to see, expressed purely as %.
//
// scopeFilter (optional) narrows the items feeding `day`/`movers` to a subset
// (e.g. only IBKR-sourced) for scoped groups.

const MAX_MOVERS = 5

function clampPct(v) {
  if (v == null || !isFinite(v)) return null
  return Math.max(-200, Math.min(200, v))
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
    ? clampPct(dailyChange)
    : clampPct(dailyChange?.pct)

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
  let movers = []
  if (scopedTotal > 0) {
    movers = rankDayMovers({
      items: scoped,
      getValue: getItemValue,
      isEligible: (it) => !it.isDebt && isFinite(it.change1d),
      total: scopedTotal,
      minWeight: 0,
    }).rows
      .map((m) => ({
        symbol: String(m.label || '?').slice(0, 12).toUpperCase(),
        name: String(m.name || m.label || '').slice(0, 40),
        changePct: clampPct(m.pct),
        impactPct: isFinite(m.impactPct) ? m.impactPct : 0,
      }))
      .filter((m) => m.changePct != null && m.impactPct !== 0)
      .slice(0, MAX_MOVERS)
  }

  return { ytd: clampPct(returnYTD), mtd: clampPct(returnMTD), day, movers }
}
