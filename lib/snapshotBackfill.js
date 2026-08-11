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
