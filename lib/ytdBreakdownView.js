// La FORMA del desglose del YTD para la sección de ancho completo del tablero
// (FASE OZ). Puro y sin React: recibe lo que `attributeYtd` ya calculó (vía
// `useDashboardData`) y decide cómo se presenta. No recalcula ninguna cifra:
// la ganancia por cuenta, el retorno propio de cada cuenta y las transferencias
// internas neteadas vienen del motor tal cual. Lo único que se agrega acá es
// (a) el orden, (b) la lista de transferencias internas como texto, y (c) el
// veredicto de honestidad sobre si las filas suman el YTD del encabezado.
//
// Por qué existe un módulo aparte y no lógica inline en el componente: la
// regla "las filas tienen que sumar el YTD" es lo que hace que un desglose sea
// una explicación y no una segunda afirmación contradictoria (FASE GQ5), y esa
// regla merece tests con dientes que no dependan de montar el tablero.

// Tolerancia del cuadre visible. El motor ya garantiza `totalGain ===
// headlineGain` por construcción (attributeYtd), así que en la práctica esto
// solo atrapa un consumidor que le pase un `ytdChange` distinto del que el
// motor usó, o un residuo tragado bajo el mínimo visible. Medio centavo por
// fila más un piso de un dólar: nunca menos que el redondeo de mostrar.
export const SUM_TOLERANCE_FLOOR = 1

// Cuánto tiene que valer una transferencia interna para nombrarse. Por debajo
// de un dólar es redondeo, no un movimiento que explique una diferencia.
export const INTERNAL_VISIBLE_MIN = 1

export function sortRowsByImpact(groups) {
  const rows = Array.isArray(groups) ? groups.slice() : []
  // Las cuentas por impacto absoluto descendente. El residuo ("Sin atribuir")
  // va SIEMPRE al final: no es una cuenta, y en medio de la lista se leería
  // como una.
  const accounts = rows.filter((g) => !g.isUnexplained)
  const residual = rows.filter((g) => g.isUnexplained)
  accounts.sort((a, b) => Math.abs(b.gain || 0) - Math.abs(a.gain || 0))
  return accounts.concat(residual)
}

export function internalTransfers(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter((g) => !g.isUnexplained && isFinite(g.internal) && Math.abs(g.internal) >= INTERNAL_VISIBLE_MIN)
    .map((g) => ({ name: g.name || '', amount: g.internal }))
}

// El veredicto de honestidad. Devuelve:
//   'exact'      las filas suman el YTD dentro de la tolerancia y ninguna
//                cuenta tiene el arranque estimado
//   'estimated'  las filas suman, pero hay una fila "Sin atribuir" o alguna
//                cuenta cuyo arranque no está medido: el reparto es un
//                estimado honesto, no una medición
//   'incomplete' las filas NO suman el YTD que se muestra arriba. No puede
//                pasar con el motor real (cuadra por construcción), y si pasa
//                el panel lo dice en vez de esconderlo.
export function reconcileRows(groups, ytdChange, { degradedAccounts = [] } = {}) {
  const rows = Array.isArray(groups) ? groups : []
  const sum = rows.reduce((s, g) => s + (isFinite(g.gain) ? g.gain : 0), 0)
  const target = isFinite(ytdChange) ? ytdChange : null
  const tolerance = Math.max(SUM_TOLERANCE_FLOOR, rows.length * 0.005)
  const matches = target != null && Math.abs(sum - target) <= tolerance
  const hasResidual = rows.some((g) => g.isUnexplained)
  const hasDegraded = Array.isArray(degradedAccounts) && degradedAccounts.length > 0
  const status = !matches ? 'incomplete' : (hasResidual || hasDegraded) ? 'estimated' : 'exact'
  return { sum, target, tolerance, matches, status }
}

export function buildYtdBreakdownView({ breakdown, ytdChange, degradedAccounts = [] } = {}) {
  const groups = breakdown && Array.isArray(breakdown.groups) ? breakdown.groups : []
  const rows = sortRowsByImpact(groups)
  return {
    rows,
    internal: internalTransfers(groups),
    reconciliation: reconcileRows(groups, ytdChange, { degradedAccounts }),
  }
}

// Signo y flecha para una cifra de dinero o de porcentaje. `-0` se normaliza a
// `0` (FASE KJ): en JS `-0 >= 0` es true e Intl imprime "-$0.00", o sea sin
// esto sale "+-$0.00". La dirección se dice con el signo Y la flecha, nunca
// solo con el color (regla del repo: verde y rojo miden 1.14:1 entre sí).
export function signOf(value) {
  const v = isFinite(value) ? (value === 0 ? 0 : value) : 0
  if (v > 0) return { value: v, sign: '+', arrow: '▲', tone: 'positive' }
  if (v < 0) return { value: v, sign: '−', arrow: '▼', tone: 'negative' }
  return { value: 0, sign: '', arrow: '', tone: 'neutral' }
}
