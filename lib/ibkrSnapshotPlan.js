// FASE FU. Planificador de escrituras de NAV de IBKR (Equity Summary).
//
// El problema que reemplaza: cada fecha compartía UN doc de snapshot con el
// snapshot diario del portafolio completo, y la regla de colisión descartaba
// el NAV del broker salvo que fuera MAYOR que el total del portafolio, cosa
// que una cuenta individual nunca cumple. Como el usuario abre la app casi a
// diario, casi todas las fechas tenían doc 'daily' y el NAV real de IBKR se
// tiraba: la vista "Interactive Brokers" se dibujaba con una reconstrucción
// estimada que mostraba valores que la cuenta jamás tuvo (reporte real:
// $10,487 el 23 jul sobre una cuenta que nunca pasó de ~$10.4K).
//
// La regla nueva: el NAV del broker se guarda SIEMPRE. Si la fecha está libre
// (o la ocupa otra medición del MISMO broker, o una reconstrucción que el NAV
// real debe corregir), va al doc plano de la fecha, igual que siempre. Si la
// fecha la ocupa una observación de portafolio COMPLETO ('daily'/'manual'),
// el NAV va a su propio doc (`fecha~nav~ibkr`) y AMBOS conviven: la vista
// escopada usa el NAV real denso, y preferFullPortfolioPerDay
// (lib/snapshotSelect.js) hace que todo consumidor de portafolio completo
// siga usando la observación completa, cero cambio en la vista "Todas".
//
// Módulo puro sin imports (jest-safe). La conversión de moneda llega como
// función (toUSD) porque el Equity Summary viene en la moneda base de la
// cuenta de IBKR, no necesariamente USD.

export const IBKR_NAV_DOC_SUFFIX = '~nav~ibkr'

// equityHistory: filas del parser ({date, netWorthUSD, totalActivosUSD,
//   totalDebtUSD, _equityCurrency}).
// existingSnapshots: docs actuales (con .id), SIN anclas _account (el caller
//   ya las filtra, pero se re-filtran defensivamente).
// toUSD: (valor, moneda) => USD.
//
// Devuelve entradas listas para bulkImport; las que llevan `_docId` se
// escriben bajo ese id (doc paralelo) en vez del id-fecha plano.
export function planEquitySnapshotWrites(equityHistory, existingSnapshots, toUSD) {
  const t = typeof toUSD === 'function' ? toUSD : (v) => v || 0
  const fullByDate = new Map()
  const ibkrByDate = new Map()
  for (const s of existingSnapshots || []) {
    if (!s || !s.date || s._account || s._calibrated) continue
    if (s._source === 'ibkr') {
      if (!ibkrByDate.has(s.date)) ibkrByDate.set(s.date, s)
      continue
    }
    if (!fullByDate.has(s.date)) fullByDate.set(s.date, s)
  }

  const out = []
  const seenDates = new Set()
  for (const entry of equityHistory || []) {
    if (!entry || !entry.date || seenDates.has(entry.date)) continue
    seenDates.add(entry.date)
    const cur = entry._equityCurrency || 'USD'
    const nav = t(entry.netWorthUSD || 0, cur)
    if (!(nav > 0) || !isFinite(nav)) continue

    // Sin cambio de valor contra lo que ya guardamos de ESTE broker para esa
    // fecha: no reescribir cientos de docs idénticos en cada sync (el Flex
    // re-entrega el año completo cada corrida).
    const prevIbkr = ibkrByDate.get(entry.date)
    if (prevIbkr && Math.abs((prevIbkr.netWorthUSD ?? 0) - nav) < 0.005) continue

    const snap = {
      date: entry.date,
      totalActivosUSD: t(entry.totalActivosUSD || entry.netWorthUSD || 0, cur),
      totalDebtUSD: t(entry.totalDebtUSD || 0, cur),
      netWorthUSD: nav,
      _source: 'ibkr',
    }

    if (prevIbkr && prevIbkr.id && prevIbkr.id !== entry.date) {
      // Ya vive en un doc paralelo: se actualiza AHÍ, nunca se duplica.
      snap._docId = prevIbkr.id
    } else if (!prevIbkr) {
      const occupant = fullByDate.get(entry.date)
      // FASE GD. CUALQUIER doc de portafolio completo ('daily', 'manual',
      // 'backfill' o sin _source) manda el NAV al doc paralelo. La regla
      // anterior reemplazaba en su lugar las fechas ocupadas por 'backfill'
      // ("el NAV real corrige reconstrucciones"), heredada del mundo
      // un-doc-por-fecha: con docs paralelos ese reemplazo DESTRUYE la
      // observación de portafolio completo sin necesidad (la vista escopada
      // ya recibe el NAV por el doc paralelo), y así fue como la vista
      // "Todas" perdió ene-jul de un sync a otro y cayó al nivel de una sola
      // cuenta. Solo 'ibkr_quarterly' se sigue reemplazando plano: es NAV del
      // MISMO broker, más grueso (transcripción), y el NAV diario real es su
      // upgrade natural en el mismo slot.
      const occupiedByFull = occupant && occupant._source !== 'ibkr_quarterly'
      if (occupiedByFull) snap._docId = `${entry.date}${IBKR_NAV_DOC_SUFFIX}`
    }
    // prevIbkr con id plano y valor distinto: sin _docId, el set plano lo
    // actualiza en su propio doc, igual que antes de FASE FU.
    out.push(snap)
  }
  return out
}

// FASE GD. Docs de NAV de broker atrapados en el SLOT PLANO de la fecha
// (id === fecha, _source 'ibkr'): la herencia del mundo un-doc-por-fecha y de
// la regla de reemplazo que FASE GD eliminó. Mientras un NAV ocupe el slot
// plano, esa fecha no puede volver a tener observación de portafolio completo
// (el backfill escribiría ENCIMA del NAV y lo destruiría). La migración los
// mueve a su doc paralelo (`fecha~nav~ibkr`) para liberar el slot; el caller
// escribe el doc nuevo PRIMERO y borra el plano después (nunca al revés).
// ⛔ FASE JZ. Ejecutar esas migraciones, en UN solo lugar, porque son DOS los
// que las necesitan (el backfill automático y el botón "Reparar ahora") y
// porque el ORDEN es un invariante: se escribe el doc paralelo PRIMERO y se
// borra el plano DESPUÉS. Al revés, un fallo entre las dos operaciones borra el
// NAV sin haberlo guardado en ningún lado.
//
// LANZA si algo falla, a propósito. Un caller que siga adelante después de una
// migración fallida va a escribir su total compuesto en el slot plano que el
// NAV todavía ocupa (staleBackfillDates cuenta un NAV de broker como día SIN
// cobertura, así que esa fecha entra como hueco) y saveSnapshot fusiona por
// id = fecha: la medición real del broker queda reemplazada por una
// estimación, y el día desaparece de la vista escopada para siempre. Un hueco
// es mejor que eso.
export async function applyNavMigrations({ snapshots, bulkImport, deleteSnapshot }) {
  const migrations = misplacedPlainNavMigrations(snapshots)
  if (migrations.length === 0) return 0
  await bulkImport({ snapshots: migrations.map((m) => m.snap) })
  for (const m of migrations) await deleteSnapshot(m.plainId)
  return migrations.length
}

export function misplacedPlainNavMigrations(snapshots) {
  const out = []
  for (const s of snapshots || []) {
    if (!s || !s.date || s._account || s._calibrated) continue
    if (s._source !== 'ibkr') continue
    const id = s.id || s.date
    if (id !== s.date) continue // ya es paralelo (o compuesto), nada que mover
    out.push({
      plainId: id,
      snap: {
        date: s.date,
        totalActivosUSD: s.totalActivosUSD ?? s.netWorthUSD ?? 0,
        totalDebtUSD: s.totalDebtUSD ?? 0,
        netWorthUSD: s.netWorthUSD ?? s.totalActivosUSD ?? 0,
        _source: 'ibkr',
        _docId: `${s.date}${IBKR_NAV_DOC_SUFFIX}`,
      },
    })
  }
  return out
}
