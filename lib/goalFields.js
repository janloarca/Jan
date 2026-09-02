// Rango legal del año objetivo: el input declara min/max pero un type="number"
// no impide TECLEAR 99999, y `yearsLeft` alimenta directo al Monte Carlo
// (años × 12 meses × 500 simulaciones): sin tope, un año basura ya guardado
// congelaba el navegador. Se clampa al GUARDAR y también al LEER, para que un
// dato malo ya escrito no reviente la card.
export const GOAL_MAX_YEAR = 2060
export function clampTargetYear(v, currentYear = new Date().getFullYear()) {
  const n = parseInt(v)
  if (!Number.isFinite(n)) return currentYear + 5
  return Math.min(GOAL_MAX_YEAR, Math.max(currentYear, n))
}

// Un valor guardado se lee con coerción NUMÉRICA y default explícito, nunca con
// `||`: un goal guardado en 0 es falsy, así que `goals.incomeGoal ||
// form.incomeGoal` caía al STRING del formulario. Dos daños: lo
// tecleado-y-CANCELADO se mostraba en la vista de lectura como si se hubiera
// guardado, y con un string menor a 1000 `formatCompact` moría en
// `'999'.toFixed is not a function` (su última rama llama .toFixed sobre el
// valor crudo) y la card entera crasheaba.
export function readGoal(v, dflt) {
  if (v == null || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}

// FASE LL. Una meta tiene MONEDA propia (decision del usuario, 26 ago 2026):
// antes se comparaba contra el patrimonio en la moneda base DEL MOMENTO, asi
// que cambiar la base re-interpretaba la meta en silencio (una meta de
// 100,000 pasaba de dolares a quetzales sin que nadie la tocara). Ahora cada
// guardado estampa `goalCurrency` (la base que el usuario estaba viendo al
// teclear los numeros) y el progreso CONVIERTE la meta a la base actual.
//
// Una meta vieja sin `goalCurrency` conserva el comportamiento de siempre
// (se lee en la base del momento): inventarle una moneda a un dato viejo
// seria adivinar; se estampa sola en el proximo guardado. Y sin converter
// (tasas aun sin cargar) cae al monto crudo, el mismo respaldo del resto de
// la app.
export function goalInBase(amount, goalCurrency, baseCurrency, convert) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  if (!goalCurrency || !baseCurrency || goalCurrency === baseCurrency) return n
  if (typeof convert !== 'function') return n
  const out = convert(n, goalCurrency, baseCurrency)
  return Number.isFinite(out) ? out : n
}

// Una sola meta, y de dónde salió.
//
// ⛔ EL DEFECTO QUE ESTE MÓDULO EXISTE PARA CERRAR: la misma meta estaba
// guardada en DOS documentos que nunca se hablaron.
//
//   settings/goals    incomeGoal · portfolioGoal · targetYear · goalCurrency
//                     lo que la card de Metas del tablero compara contra el
//                     patrimonio. Es la canónica.
//
//   settings/profile  incomeGoal · portfolioGoal · targetYear
//                     campos propios del formulario del perfil financiero en
//                     Flujo, que solo se mostraban a sí mismos.
//
// Nadie los sincronizaba, así que alguien podía teclear su meta real en Flujo
// y ver el tablero midiendo contra un default de 100,000 que nunca puso. No es
// un campo huérfano (el guardián de FASE MV no lo ve, porque el perfil SÍ lee
// lo suyo): es una segunda fuente de verdad, que es peor, porque las dos se
// ven correctas por separado.
//
// ⛔ Y LAS DOS COPIAS NO SIGNIFICABAN LO MISMO. Dos diferencias, las dos
// silenciosas, y por eso la adopción JAMÁS es una copia byte a byte:
//
//   1. MONEDA. El perfil vive en Flujo, que está denominado en quetzales por
//      diseño, y de hecho pintaba sus montos con una "Q" fija. Las metas viven
//      en la moneda base que el usuario estaba viendo al teclearlas
//      (`goalCurrency`, FASE LL). Adoptar sin convertir haría que Q3,000,000
//      se leyera como $3,000,000: ocho veces la meta real.
//
//   2. PERÍODO del ingreso pasivo. El campo del perfil decía "Meta ingreso
//      pasivo/MES" (placeholder 2000) y el de Metas se compara contra los
//      dividendos ANUALES (default 12000). Mismo nombre, período distinto.
//      Adoptar sin multiplicar por 12 dividiría la meta entre doce.
//
// Por eso el usuario ve los números YA convertidos antes de elegir: si alguna
// de las dos conversiones estuviera mal, se nota antes de escribir nada.

// El período del ingreso pasivo, dicho una vez.
export const PROFILE_INCOME_GOAL_IS_MONTHLY = true
const MONTHS_PER_YEAR = 12

// La moneda en la que están denominados los montos del perfil financiero.
// Flujo entero corre en quetzales (`FINANCE_CURRENCY`), y este formulario los
// pintaba con "Q".
export const PROFILE_GOAL_CURRENCY = 'GTQ'

const positive = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Las metas que quedaron guardadas en el perfil. Null cuando no hay nada que
// migrar, o cuando el usuario ya resolvió la pregunta: `_goalsMigratedAt` se
// estampa al adoptar Y al descartar, así que la pregunta se hace una vez.
export function legacyProfileGoals(profile) {
  if (!profile || profile._goalsMigratedAt) return null
  const out = {}
  const income = positive(profile.incomeGoal)
  const portfolio = positive(profile.portfolioGoal)
  const year = Number(profile.targetYear)
  if (income != null) out.incomeGoal = income
  if (portfolio != null) out.portfolioGoal = portfolio
  if (Number.isFinite(year) && year > 1900) out.targetYear = Math.round(year)
  return Object.keys(out).length > 0 ? out : null
}

function toBase(amount, baseCurrency, convert) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  if (!baseCurrency || baseCurrency === PROFILE_GOAL_CURRENCY) return n
  if (typeof convert !== 'function') return n
  const out = convert(n, PROFILE_GOAL_CURRENCY, baseCurrency)
  // Sin tasa disponible cae al monto crudo, el mismo respaldo del resto de la
  // app. Es un número equivocado, pero el usuario lo ve antes de aceptarlo.
  return Number.isFinite(out) ? out : n
}

// Lo que se escribiría en `goals` al adoptar las del perfil, ya convertido:
// misma forma que produce el editor de Metas, para que las dos superficies
// escriban exactamente el mismo documento.
export function goalAdoptionPatch(legacy, { baseCurrency, convert } = {}) {
  if (!legacy) return null
  const patch = {}
  if (legacy.incomeGoal != null) {
    patch.incomeGoal = toBase(legacy.incomeGoal * MONTHS_PER_YEAR, baseCurrency, convert)
  }
  if (legacy.portfolioGoal != null) {
    patch.portfolioGoal = toBase(legacy.portfolioGoal, baseCurrency, convert)
  }
  if (legacy.targetYear != null) patch.targetYear = legacy.targetYear
  // Igual que un guardado normal del editor de Metas: sin base conocida no se
  // estampa moneda y el legacy queda intacto (FASE LL).
  if (baseCurrency) patch.goalCurrency = baseCurrency
  return patch
}

// ¿La meta del perfil dice algo distinto de la que ya está en Metas? Se
// compara CONVERTIDA, o sea contra lo que de verdad se escribiría. Sin
// diferencia real no hay nada que preguntar y la migración es silenciosa.
export function goalsDiffer(legacy, goals, { baseCurrency, convert } = {}) {
  const patch = goalAdoptionPatch(legacy, { baseCurrency, convert })
  if (!patch) return false
  const near = (a, b) => {
    const x = Number(a) || 0
    const y = Number(b) || 0
    // Tolerancia proporcional: los dos vienen de una conversión de moneda y
    // nunca van a cuadrar al centavo.
    return Math.abs(x - y) <= Math.max(1, Math.abs(y) * 0.01)
  }
  for (const key of ['incomeGoal', 'portfolioGoal']) {
    if (patch[key] == null) continue
    if (goals?.[key] == null) return true
    if (!near(patch[key], goals[key])) return true
  }
  if (patch.targetYear != null && Number(goals?.targetYear) !== patch.targetYear) return true
  return false
}

// La marca de "esta pregunta ya se contestó", para el perfil. Se estampa
// igual si el usuario adopta o descarta: lo que no puede pasar es que la
// pregunta vuelva en cada carga.
export function goalsMigratedStamp(nowIso) {
  return { _goalsMigratedAt: nowIso || new Date().toISOString() }
}

// ⛔ Una meta de "Tamaño de portfolio" se mide contra los ACTIVOS, no contra el
// patrimonio neto. Con una deuda viva las dos cifras difieren, y contra el neto
// pagar la deuda contaría como crecimiento del portafolio (y pedir prestado como
// encogimiento) sin que un solo activo se hubiera movido: la misma distinción
// que FASE LU/LV fijó para el rendimiento, acá para la meta. `netWorth` se
// conserva como respaldo para un caller que no pase activos, y sin deuda las dos
// son la misma cifra.
//
// Vive acá y no en la card de Metas porque la proyección de patrimonio hace la
// MISMA pregunta ("¿llego a esta meta?") y con dos copias las dos pantallas
// podrían medir contra bases distintas: una diría 60% y la otra 55% sobre la
// misma meta y el mismo día.
export function portfolioValue(totalAssets, netWorth) {
  const a = Number(totalAssets)
  if (Number.isFinite(a) && a !== 0) return a
  const n = Number(netWorth)
  return Number.isFinite(n) ? n : 0
}
