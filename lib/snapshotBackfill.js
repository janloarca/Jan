// Which of the last N days still need a portfolio-wide NAV snapshot filled in.
//
// FASE EG. Real bug (XOCHI/IDC): a second bond, GTQ-denominated, added TODAY
// with a real acquisitionDate from 2024, paying into its own cash account.
// The value/performance charts sawtoothed by exactly XOCHI's value on every
// other day for the trailing month: some days showed the portfolio WITH it,
// some WITHOUT, alternating.
//
// The cause: the trailing-30-day backfill effect (useDashboardData) only
// fills a day that has NO snapshot doc at all (`!existingDates.has(dateStr)`).
// A `_source:'backfill'` doc is itself a RECONSTRUCTION from whatever items
// existed the moment it was written — so every day already backfilled while
// only VITALI existed got permanently stuck holding "VITALI only", because
// once a doc exists for that date it is no longer a "gap", even after XOCHI
// was added retroactively and the reconstruction inputs changed underneath
// it. The days that happened to still be true gaps at the moment XOCHI was
// added got recomputed fresh (WITH XOCHI) — hence the alternation, one stale
// estimate next to one fresh one, day after day.
//
// The fix: a day whose ONLY doc is itself `_source:'backfill'` is not
// "covered" — it is exactly as re-fillable as a day with no doc at all,
// because it is not an observation, just an older guess.
//
// `_source:'daily'` (or no `_source` at all — FASE DX's daily-equivalent) is
// USUALLY a real observation and must never be silently rewritten: that is
// what SNAPSHOT_SRC_PRIORITY protects everywhere else. But for a portfolio
// with NO broker-synced item, a 'daily' doc is not an external truth either —
// it is the SAME "sum of whatever items the app knew about that day"
// computation `_source:'backfill'` is, just run live instead of after the
// fact (see PortfolioGrowthChart's reconstructionIsExact / FASE EB: a
// static-only portfolio rewinds EXACTLY from today's state, because it moves
// only through events already on file). So `treatDailyAsStale` lets a
// no-broker caller re-fill 'daily' days too — the fresh reconstruction, done
// with everything now on file, is at least as good as the day-of snapshot,
// and it is the only way an asset added later with a real backdated
// acquisitionDate stops being a coin flip between two different pasts. A
// broker-synced portfolio must NEVER pass this: an old IBKR-inclusive
// 'daily' total cannot be recomputed from a hold-flat guess without silently
// downgrading its accuracy.
import { snapshotAssetsUSD } from './assetReturns'

// FASE HI. Resolución de cada hueco a un valor concreto, incluidos los días
// SIN mercado. La serie del API solo trae puntos de días hábiles (los
// timestamps salen de los cierres de Yahoo), así que un hueco fechado en
// sábado, domingo o feriado jamás matcheaba un punto por fecha exacta y se
// quedaba sin rellenar para siempre — con el doc viejo congelado abajo, si lo
// había. La regla del usuario, que además es la convención estándar de
// cualquier serie de patrimonio: un día sin mercado vale lo que dijo el
// ÚLTIMO CIERRE (viernes para el fin de semana, el hábil previo para un
// feriado). maxCarryDays acota el arrastre: un hueco a más de esos días del
// último punto conocido no se inventa (un agujero real de datos del API no es
// un fin de semana, y un doc 'backfill' escrito con un valor arrastrado de
// semanas sería una meseta falsa con cara de dato).
export function resolveGapFills(gaps, points, { maxCarryDays = 4 } = {}) {
  const DAY = 86400000
  const pts = (points || [])
    .filter((p) => p && isFinite(p.ts) && isFinite(p.total) && p.total > 0)
    .sort((a, b) => a.ts - b.ts)
  if (pts.length === 0) return []

  const out = []
  for (const date of gaps || []) {
    const dayEnd = Date.parse(`${date}T23:59:59.999Z`)
    const dayStart = Date.parse(`${date}T00:00:00Z`)
    if (!isFinite(dayEnd) || !isFinite(dayStart)) continue
    // Último punto conocido a o antes del fin de este día. Los puntos vienen
    // ordenados; búsqueda binaria del borde superior.
    let lo = 0
    let hi = pts.length - 1
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (pts[mid].ts <= dayEnd) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    if (best < 0) continue // nada anterior: nunca se inventa hacia atrás
    const pt = pts[best]
    const sameDay = new Date(pt.ts).toISOString().split('T')[0] === date
    if (sameDay) {
      out.push({ date, total: pt.total, carried: false })
      continue
    }
    // Arrastre del último cierre, acotado.
    if (dayStart - pt.ts <= maxCarryDays * DAY) {
      out.push({ date, total: pt.total, carried: true })
    }
  }
  return out
}

// FASE HN. El NAV diario REAL del broker, por fecha, desde los docs que el
// Equity Summary del Flex ya dejó en Firestore (~365 días, un valor por día
// hábil). Es la medición del propio broker: no hay nada mejor con que
// reconstruir esa parte del portafolio, y estábamos estimándola.
export function buildNavByDate(snapshots, brokerNavSources = ['ibkr']) {
  const sources = new Set(brokerNavSources)
  const out = new Map()
  for (const s of snapshots || []) {
    if (!s || !s.date || s._account || s._calibrated) continue
    if (!sources.has(s._source)) continue
    const v = Number(s.netWorthUSD ?? s.totalActivosUSD ?? NaN)
    if (!isFinite(v) || v <= 0) continue
    // Con varios docs de la misma fecha (slot plano + paralelo) gana el mayor
    // timestamp de escritura si lo hay; sin él, el último visto.
    out.set(s.date, v)
  }
  return out
}

// Valor conocido más reciente en o antes de `date`, con tope de arrastre: el
// NAV solo existe en días hábiles, así que un sábado vale el cierre del
// viernes (la misma convención de resolveGapFills, y la regla que pidió el
// usuario). `null` cuando no hay nada que arrastrar dentro del tope.
function carriedValue(sortedEntries, date, maxCarryDays) {
  const DAY = 86400000
  const target = Date.parse(`${date}T00:00:00Z`)
  if (!isFinite(target)) return null
  let best = null
  for (const [d, v] of sortedEntries) {
    if (d > date) break
    best = { d, v }
  }
  if (!best) return null
  if (best.d === date) return best.v
  const gapMs = target - Date.parse(`${best.d}T00:00:00Z`)
  return gapMs <= maxCarryDays * DAY ? best.v : null
}

// ⛔ FASE IX5. El NAV del broker EN una fecha, con exactamente la misma regla de
// arrastre con la que `composeDailyTotals` construyó el doc de ese día. Existe
// porque el desglose del YTD tiene que descomponer el ancla que DE VERDAD usa
// el encabezado, y el ancla es un doc compuesto: si su mitad de broker se lee
// con una regla distinta a la que la escribió, la resta no cierra.
//
// El caso real: el 1 de enero es feriado de mercado, así que el compositor
// arrastró el NAV del 31 de diciembre ($5,504.30), mientras el panel lo
// resolvía con `findYearStartAnchor`, que toma el PRIMER doc de enero (el 2 de
// enero, $5,433.96). Dos respuestas distintas a "cuánto valía la cuenta el 1 de
// enero", separadas por un día hábil de mercado: $70.34, que era el grueso del
// residuo "Sin atribuir".
export function navAsOf(navByDate, date, opts) {
  const e = navEntryAsOf(navByDate, date, opts)
  return e ? e.value : null
}

// FASE IX7. Lo mismo, pero diciendo DE QUÉ DÍA salió el NAV. El panel del YTD
// resuelve el arranque del broker con arrastre, así que "el 1 de enero" puede
// ser en realidad el cierre del 31 de diciembre; imprimir esa fecha es lo que
// permite ver de un vistazo si la regla nueva se está aplicando y contra qué
// día, en vez de deducirlo de que el número no cambió (la lección de FASE HP:
// si el arreglo corre invisible, cada ronda se va en averiguar si corrió).
export function navEntryAsOf(navByDate, date, { maxCarryDays = 4 } = {}) {
  if (!(navByDate instanceof Map) || navByDate.size === 0 || !date) return null
  const entries = [...navByDate].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const DAY = 86400000
  const target = Date.parse(`${date}T00:00:00Z`)
  if (!isFinite(target)) return null
  let best = null
  for (const [d, v] of entries) {
    if (d > date) break
    best = { date: d, value: v }
  }
  if (!best) return null
  if (best.date === date) return best
  const gapMs = target - Date.parse(`${best.date}T00:00:00Z`)
  return gapMs <= maxCarryDays * DAY ? best : null
}

// FASE HN. Un total de portafolio por día, compuesto de las DOS mitades con la
// mejor fuente que existe para cada una:
//
//   total(día) = NAV REAL del broker ese día  +  reconstrucción de lo manual
//
// Antes, el día entero salía de UNA reconstrucción que trataba a la cuenta del
// broker como una posición más que había que adivinar (hold-flat, o peor: cero
// antes del sello de sync, FASE HL). Componer elimina de raíz la clase de bug
// que produjo el diente de sierra, porque TODOS los días se calculan igual y
// la mitad del broker no se estima nunca.
//
// La garantía dura: con un broker conectado, un día SIN NAV disponible (ni
// arrastrable) NO se escribe. Escribirlo significaría archivar un patrimonio
// que omite una cuenta entera, que es exactamente el defecto que esto viene a
// eliminar; un hueco honesto es preferible.
export function composeDailyTotals({
  gaps,
  manualPoints,
  navByDate,
  hasBrokerItems,
  maxCarryDays = 4,
} = {}) {
  const manual = resolveGapFills(gaps, manualPoints, { maxCarryDays })
  const manualByDate = new Map(manual.map((f) => [f.date, f.total]))
  const navEntries = [...(navByDate instanceof Map ? navByDate : new Map())]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const out = []
  for (const date of gaps || []) {
    const manualVal = manualByDate.get(date)
    if (manualVal == null) continue // sin reconstrucción manual no hay día
    if (!hasBrokerItems) {
      out.push({ date, total: manualVal, composed: false })
      continue
    }
    const nav = carriedValue(navEntries, date, maxCarryDays)
    if (nav == null) continue // NUNCA archivar un total que omite al broker
    out.push({ date, total: manualVal + nav, composed: true })
  }
  return out
}

// Las fechas de la ventana, más recientes primero, en el mismo formato que
// staleBackfillDates. Se necesita la lista COMPLETA (no solo los huecos) para
// poder contrastar cada día contra la composición autoritativa.
export function windowDates(windowDays = 366, todayMs = Date.now()) {
  const out = []
  const today = new Date(todayMs)
  for (let d = 1; d <= windowDays; d++) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - d)
    out.push(dt.toISOString().split('T')[0])
  }
  return out
}

// FASE HO. Docs 'daily' que CONTRADICEN la composición autoritativa.
//
// El usuario encontró la pista decisiva: los picos del diente de sierra caen
// EXACTAMENTE en fin de semana. Un doc de fin de semana no puede venir del
// backfill (la serie de precios no tiene días no hábiles) ni del NAV del
// broker (idem): es un doc 'daily', escrito EN VIVO cuando abrió la app. Y el
// fin de semana es justo cuando el Flex de IBKR responde mal, así que es la
// ventana donde un total podía escribirse a medio importar (el hueco que FASE
// FE/GB cerró hacia adelante). Esos docs quedaron con un valor inflado y son
// INTOCABLES para el backfill (un 'daily' es una observación real y se
// protege a propósito), así que sobrevivieron a todas las limpiezas.
//
// Con FASE HN existe algo que antes no: un valor AUTORITATIVO para cualquier
// día (NAV real del broker + reconstrucción de lo manual). Un 'daily' que se
// aparta materialmente de esa composición no es una observación que discrepa:
// es una escritura corrupta, y ahora se puede demostrar en vez de adivinar.
// Es el mismo estándar de FASE GA (evidencia contra evidencia, no una banda
// estadística).
//
// A propósito NO toca 'manual' (transcripción del usuario: su trabajo manda) y
// solo actúa cuando la composición usó NAV real (`composed`), nunca contra una
// reconstrucción que también podría estar equivocada.
//
// ⛔ FASE MI. La comparación es contra los ACTIVOS del doc, NUNCA contra su
// patrimonio neto, y de eso depende que la función distinga algo.
//
// Desde FASE LU el caller filtra la deuda antes de pedir la reconstrucción
// ("Only ASSETS go to portfolio-history"), así que `c.total` es SOLO-ACTIVOS.
// Leer el doc guardado por `netWorthUSD` comparaba dos universos distintos y la
// diferencia era, exactamente, la deuda: con una deuda mayor a la tolerancia
// (8% del total, piso de $50) **TODOS los docs 'daily' salían "corruptos"**.
// Medido con la función real sobre el portafolio del usuario ($27,000 en
// activos con $4,000 de deuda): 4 de 4 días marcados, y 0 de 4 con el mismo
// portafolio sin deuda, o sea la deuda era la causa entera.
//
// El daño no es que el valor de reemplazo esté mal (el caller escribe
// `netWorthUSD: total - deuda`, que es correcto): es que un 'daily' es una
// OBSERVACIÓN escrita en vivo y esta función existe para destruirla solo cuando
// se puede DEMOSTRAR que está corrupta. Con la comparación cruzada se llevaba la
// capa de observaciones entera, todos los días (la divergencia es estructural,
// así que nunca se resuelve y vuelve a marcar los 366 días en cada pasada), y
// cada reescritura baja el doc de 'daily' a 'backfill', que `staleBackfillDates`
// ya no protege.
export function divergentDailyDates(snapshots, composed, { tol = 0.08, minAbs = 50 } = {}) {
  const byDate = new Map()
  for (const s of snapshots || []) {
    if (!s || !s.date || s._account || s._calibrated) continue
    if ((s._source || 'daily') !== 'daily') continue
    // La MISMA lectura solo-activos que usa el resto del universo de rendimiento
    // (FASE LU/MG), no una segunda copia que pueda divergir de ella.
    const v = snapshotAssetsUSD(s)
    if (!isFinite(v) || v <= 0) continue
    byDate.set(s.date, v)
  }
  const out = []
  for (const c of composed || []) {
    if (!c || !c.composed || !(c.total > 0)) continue
    const existing = byDate.get(c.date)
    if (existing == null) continue
    if (Math.abs(existing - c.total) > Math.max(minAbs, c.total * tol)) out.push(c.date)
  }
  return out
}

// ⛔ FASE NL. Una calibración GLOBAL que la composición autoritativa contradice.
//
// El defecto que cierra, reportado con captura: la tarjeta decía `YTD
// -$3,217.57 (-26.10%) · calibrated` sobre un año que de verdad iba +$654,
// con una "mayor caída -40.3% (1 ene → 2 ene)" al lado. Despejando el ancla
// del Dietz con los números de la captura sale **9,305.22** contra el NAV que
// el propio broker reporta para diciembre, **5,432.98**: el arranque del año
// estaba inflado ~$3,872, o sea casi exactamente los depósitos del año
// (3,945), que es la firma del doble conteo (un ancla que YA los contiene y
// además los netea como flujo).
//
// Por qué ese doc era INMORTAL, y es la parte que hay que entender antes de
// tocar esto: `CalibrateReturnModal` escribe la calibración con
// `_source: 'manual'`, y eso la disfraza de transcripción del usuario ante
// TODOS los mecanismos de reparación:
//   · `staleBackfillDates` le da a 'manual' el rango más alto, así que ese día
//     nunca cuenta como hueco y el backfill jamás lo re-deriva;
//   · `divergentDailyDates` salta `_calibrated` explícitamente;
//   · y el guard de escritura de FASE JW solo impide PISAR un día que ya tiene
//     dato real: no hace nada por el doc que ya se escribió.
// O sea la promesa que el propio modal imprime ("si después importas el
// historial real, esos datos reemplazan la calibración automáticamente") era
// FALSA: se cumplía del lado del ESCRITOR y nunca del lado del archivo.
//
// La distinción que lo hace justo: una calibración NO es un monto que el
// usuario tecleó, es un valor DESPEJADO de un porcentaje. Protegerla como si
// fuera una observación transcrita es la conflación de raíz.
//
// Las tres restricciones que la vuelven segura, cada una con su test:
//   · solo dispara con `c.composed`, o sea cuando la composición se apoyó en el
//     NAV REAL del broker (arrastrado a feriados/fines de semana por FASE HI).
//     Sin NAV real no pasa nada y la calibración se queda: su razón de existir
//     es justamente que no había con qué medir ese día.
//   · misma banda que su hermana (8%, piso de $50): evidencia contra evidencia,
//     nunca una banda estadística.
//   · solo calibraciones GLOBALES (sin `_account`). Un ancla por cuenta vive en
//     su propio id compuesto, no es el arranque del portafolio, y compararla
//     contra una composición de portafolio completo sería comparar universos
//     distintos (la lección de FASE MI).
export function contradictedCalibrationDates(snapshots, composed, { tol = 0.08, minAbs = 50 } = {}) {
  const byDate = new Map()
  for (const s of snapshots || []) {
    if (!s || !s.date || s._account || !s._calibrated) continue
    const v = snapshotAssetsUSD(s)
    if (!isFinite(v) || v <= 0) continue
    byDate.set(s.date, v)
  }
  if (byDate.size === 0) return []
  const out = []
  for (const c of composed || []) {
    if (!c || !c.composed || !(c.total > 0)) continue
    const existing = byDate.get(c.date)
    if (existing == null) continue
    if (Math.abs(existing - c.total) > Math.max(minAbs, c.total * tol)) out.push(c.date)
  }
  return out
}

// Los campos que hay que APAGAR al reescribir un día calibrado. `saveSnapshot`
// fusiona, así que escribir `_source:'backfill'` encima NO borra `_calibrated`:
// el doc quedaría reescrito con el valor bueno y todavía badgeado como
// calibrado, y la insignia de la tarjeta seguiría mintiendo. Se exporta para
// que el backfill automático y "Reparar ahora" apaguen exactamente lo mismo.
export const CLEARED_CALIBRATION_FIELDS = {
  _calibrated: false,
  _calibrationKind: null,
  _calibratedAt: null,
}

// ⛔ FASE NN. La HERMANA de contradictedCalibrationDates, para la otra especie
// de calibración: la que es POR CUENTA.
//
// Corrige un hueco que FASE NL dejó anotado con una razón EQUIVOCADA. Ahí
// escribí que una calibración por cuenta "no se puede juzgar porque no hay
// evidencia en el archivo con la que juzgarla sola". Es falso, y por eso el
// arreglo de aquella fase no movió un centavo del caso real: la evidencia
// existe y es exactamente la misma que ya usa todo lo demás, el **NAV REAL del
// broker**, que también es un valor POR CUENTA. Compararlos no mezcla
// universos (la lección de FASE MI): son la misma cuenta, el mismo día.
//
// Por qué esta especie es invisible para la otra función: una calibración por
// cuenta NUNCA es el ancla guardada. Vive en su propio doc (`_account`) y se
// aplica EN MEMORIA, en cada render, dentro del memo returnYTD
// (combineAccountCalibrations cambia la rebanada ESTIMADA de esa cuenta por el
// valor despejado del % del broker). O sea el backfill puede reescribir el doc
// del 1 de enero con el valor perfecto y el arranque del año sale igual de
// inflado, porque la calibración se le vuelve a aplicar encima al leerlo.
// Reparar el archivo no alcanza: hay que dejar de APLICARLA.
//
// Solo se juzga una cuenta de BROKER: para una cuenta manual no existe una
// segunda medición independiente, así que ahí no hay nada que contrastar y la
// calibración se queda (misma honestidad que su hermana ante la ausencia de
// NAV). Misma banda (8%, piso de $50) y mismo arrastre acotado que el resto:
// el 1 de enero es feriado y su NAV es el cierre del 31 (FASE HI). Sin NAV
// dentro del tope no se juzga NADA: un valor de hace dos semanas puede diferir
// legítimamente más que la banda, y ahí la prueba dejaría de significar algo.
//
// Devuelve las calibraciones OFENSORAS (los objetos, no ids): el caller ya las
// tiene en la mano y así la pertenencia es exacta sin inventar una llave.
export function contradictedAccountCalibrations(calibrations, snapshots, {
  tol = 0.08, minAbs = 50, brokerAccounts = ['ibkr'], maxCarryDays = 4,
} = {}) {
  const out = []
  const cals = (calibrations || []).filter(
    (c) => c && c._account && c.date && Number.isFinite(Number(c.netWorthUSD)) && Number(c.netWorthUSD) > 0
  )
  if (cals.length === 0) return out
  const broker = new Set(brokerAccounts)
  const navByDate = buildNavByDate(snapshots)
  if (navByDate.size === 0) return out
  for (const c of cals) {
    if (!broker.has(c._account)) continue
    const e = navEntryAsOf(navByDate, c.date, { maxCarryDays })
    if (!e || !(e.value > 0)) continue
    const solved = Number(c.netWorthUSD)
    if (Math.abs(solved - e.value) > Math.max(minAbs, e.value * tol)) out.push(c)
  }
  return out
}

// Desde cuándo un doc 'daily' pudo contener al broker (FASE HG). Uno escrito
// ANTES de conectarlo suma solo las cuentas manuales y es intocable sin esta
// señal, así que queda congelado a ese nivel para siempre: el piso exacto del
// diente de sierra. Se lee de `createdAt` (cuándo existe el documento), NUNCA
// de `acquisitionDate`, que para una posición importada es el sello del sync.
// Compartida (FASE JU) por el backfill automático y por "Reparar ahora": las
// dos escriben los MISMOS docs y no pueden discrepar sobre qué día es un hueco.
export function brokerConnectedTsOf(items, brokerSource = 'ibkr') {
  const ts = (items || [])
    .filter((it) => it && it._source === brokerSource && it.createdAt)
    .map((it) => new Date(it.createdAt).getTime())
    .filter((n) => Number.isFinite(n))
  return ts.length > 0 ? Math.min(...ts) : null
}

export function staleBackfillDates(snapshots, { windowDays = 30, todayMs = Date.now(), treatDailyAsStale = false, brokerConnectedTs = null } = {}) {
  const bySource = new Map()
  // FASE GD: rango de "qué tan cubierto" está un día. Un NAV sincronizado
  // ('ibkr') mide UNA cuenta, no el portafolio: desde los docs paralelos de
  // FASE FU convive con la observación completa y no debe contar como
  // cobertura del día (si contara, un día solo-broker jamás recibiría su
  // reconstrucción de portafolio entero). 'ibkr_quarterly' SÍ sigue
  // bloqueando: es una transcripción hecha a mano por el usuario que vive en
  // el slot plano de la fecha, y marcarla como hueco haría que el backfill la
  // sobrescribiera (destruir trabajo del usuario, la lección de FASE DW).
  const RANK = { ibkr: 0, backfill: 1 } // daily/manual/quarterly/sin fuente: 2
  for (const s of snapshots || []) {
    const key = s && (s.date || s.id)
    if (!key) continue
    // Calibration anchors share their date with a compound id
    // (`date~kind~account`) and never stand in for the portfolio-wide doc a
    // plain date id represents, so they never block or unblock a day here.
    if (s._account) continue
    // Normalize "no _source field" to 'daily' up front (FASE DX: honest
    // full-portfolio history, same treatment as an explicit 'daily' doc).
    const src = s._source || 'daily'
    const rank = RANK[src] ?? 2
    const prev = bySource.get(key)
    if (!prev || rank > prev.rank) bySource.set(key, { src, rank })
  }

  const staleSources = treatDailyAsStale ? new Set(['backfill', 'daily']) : new Set(['backfill'])

  // FASE HG. Un 'daily' escrito ANTES de que el broker se conectara nunca tuvo
  // la oportunidad de incluirlo: es la suma honesta de lo que el usuario tenía
  // rastreado ESE día, y ese día el broker todavía no era parte del portafolio
  // en Chispu. Pero hasBrokerItem (el caller) mira solo el HOY, así que ese
  // doc viejo cae en la misma protección que un 'daily' escrito DESPUÉS de
  // conectar (que sí incluye al broker y no debe tocarse) — quedando congelado
  // para siempre, sin el broker, mientras el resto de los días del mismo rango
  // sí lo reflejan. Esa alternancia es el diente de sierra de la vista "Todas"
  // con IBKR conectado: mismo mecanismo que el caso XOCHI de arriba (FASE EG,
  // un activo agregado después con fecha retroactiva), una capa más arriba —
  // ahí era un solo activo, acá es una CUENTA DE BROKER entera. brokerConnectedTs
  // (la fecha del ítem de broker más antiguo, mismo patrón que manualAddedTs
  // en PortfolioGrowthChart.jsx pero del lado del broker) es la línea que
  // separa "este daily no pudo haber incluido al broker" de "este daily ya lo
  // tiene": solo el primer caso se libera para re-rellenarse, sin importar
  // treatDailyAsStale (que responde a una pregunta distinta: si HOY hay algún
  // broker conectado en absoluto).
  const brokerCutoffStr = brokerConnectedTs != null && isFinite(brokerConnectedTs)
    ? new Date(brokerConnectedTs).toISOString().split('T')[0]
    : null

  const out = []
  const today = new Date(todayMs)
  for (let d = 1; d <= windowDays; d++) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - d)
    const dateStr = dt.toISOString().split('T')[0]
    const best = bySource.get(dateStr)
    const dailyPredatesBroker = !!best && best.src === 'daily' && brokerCutoffStr != null && dateStr < brokerCutoffStr
    // Sin doc, con solo NAV de broker (rank 0), con la mejor cobertura en una
    // fuente stale, o un 'daily' de antes de que el broker existiera: el día
    // se (re)llena.
    if (!best || best.rank === 0 || staleSources.has(best.src) || dailyPredatesBroker) out.push(dateStr)
  }
  return out
}
