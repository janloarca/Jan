// "Get this broker to 100%" — the ordered checklist a connection should lead
// into, instead of four independent buttons the user has to know exist.
//
// IBKR is the only broker fully specified right now: it is the one with real
// depth (a synced API, a 365-day export cap, a broker chart with real
// pre-cap history, and its own performance screen), so it is the one where
// "connect" is genuinely just step 1 of 4. Every other broker gets whatever
// single door its lib/brokerHowTo.js entry already has (api first, else csv) —
// there is nothing more to sequence there YET, but the shape is the same, so
// adding a broker's own multi-step story later is just filling in this table.
//
// Every step is OPTIONAL — the checklist nudges, it never blocks. `done` is a
// pure function of app state so both the modal and any summary badge (an
// unfinished-step count) agree on what's left.

export const IBKR_STEPS = [
  {
    id: 'connect', kind: 'api',
    title: { es: 'Conectar con la API (Flex Query)', en: 'Connect via the API (Flex Query)' },
    desc: {
      es: 'Sync automático: posiciones, precios y el año en curso se mantienen al día solos.',
      en: 'Automatic sync: positions, prices and the current year stay up to date on their own.',
    },
    done: ({ ibkrConnected }) => !!ibkrConnected,
  },
  {
    id: 'history', kind: 'csv',
    title: { es: 'Subir los años anteriores (Flex XML)', en: 'Upload prior years (Flex XML)' },
    desc: {
      es: 'Un archivo por año calendario, desde que abriste la cuenta hasta el año pasado.',
      en: 'One file per calendar year, from when you opened the account through last year.',
    },
    // Heuristic, not a hard check: real day-level IBKR history reaching back
    // further than ~13 months means at least one prior-year file landed (the
    // live API sync alone only ever covers the trailing year).
    done: ({ ibkrSnapshotSpanDays }) => (ibkrSnapshotSpanDays || 0) > 400,
  },
  {
    id: 'quarterly', kind: 'quarterly',
    title: { es: 'Transcribir lo que el archivo no alcanzó', en: 'Transcribe what the file could not reach' },
    desc: {
      es: 'Si tu cuenta es más vieja que los archivos que tienes, unos ~4 números por año desde Portfolio Analyst.',
      en: 'If your account is older than the files you have, about ~4 numbers a year from Portfolio Analyst.',
    },
    done: ({ hasQuarterlyHistory }) => !!hasQuarterlyHistory,
    // Nothing to do here once step 2 already reaches back far enough.
    skippable: ({ ibkrSnapshotSpanDays, earliestNeededDays }) =>
      earliestNeededDays != null && (ibkrSnapshotSpanDays || 0) >= earliestNeededDays,
  },
  {
    id: 'returns', kind: 'calibrate',
    title: { es: 'Copiar los retornos que muestra IBKR', en: 'Copy the returns IBKR shows' },
    desc: {
      es: '1W, 1M, 3M, YTD, 1Y y desde el inicio: ancla tu curva a los números reales de tu broker.',
      en: '1W, 1M, 3M, YTD, 1Y and since inception: anchors your curve to your broker\'s real numbers.',
    },
    done: ({ hasIbkrCalibration }) => !!hasIbkrCalibration,
  },
]

const GENERIC_STEP = (howTo) => {
  if (!howTo) return []
  if (howTo.api) return [{ id: 'connect', kind: 'api', title: { es: 'Conectar', en: 'Connect' }, desc: null, done: ({ connected }) => !!connected }]
  if (howTo.csv) return [{ id: 'import', kind: 'csv', title: { es: 'Importar archivo', en: 'Import file' }, desc: null, done: ({ imported }) => !!imported }]
  return []
}

export function getBrokerCompletionSteps(brokerId, howTo) {
  if (brokerId === 'ibkr') return IBKR_STEPS
  return GENERIC_STEP(howTo)
}

// Span (in days) covered by real per-day broker NAV — the finest source
// (`_source: 'ibkr'`), not the transcribed quarterly one. Used to guess
// whether a prior-year Flex XML has already been uploaded.
export function ibkrSnapshotSpanDays(snapshots, now = new Date()) {
  const dates = (snapshots || [])
    .filter((s) => s && s._source === 'ibkr' && s.date)
    .map((s) => new Date(s.date).getTime())
    .filter((t) => isFinite(t))
  if (dates.length === 0) return 0
  const earliest = Math.min(...dates)
  return Math.round((now.getTime() - earliest) / 86400000)
}

// How far back the account NEEDS to reach, in days, so the quarterly step can
// mark itself skippable once a Flex XML already covers the whole account.
// null when there is no known start date to compare against.
export function earliestNeededDays(items, now = new Date()) {
  const dates = (items || [])
    .map((it) => it.acquisitionDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => isFinite(t))
  if (dates.length === 0) return null
  const earliest = Math.min(...dates)
  return Math.round((now.getTime() - earliest) / 86400000)
}
