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
export function staleBackfillDates(snapshots, { windowDays = 30, todayMs = Date.now(), treatDailyAsStale = false } = {}) {
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

  const out = []
  const today = new Date(todayMs)
  for (let d = 1; d <= windowDays; d++) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - d)
    const dateStr = dt.toISOString().split('T')[0]
    const best = bySource.get(dateStr)
    // Sin doc, con solo NAV de broker (rank 0), o con la mejor cobertura en
    // una fuente stale: el día se (re)llena.
    if (!best || best.rank === 0 || staleSources.has(best.src)) out.push(dateStr)
  }
  return out
}
