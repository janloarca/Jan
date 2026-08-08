// "Get this broker to 100%" — the ordered checklist a connection should lead
// into, instead of independent buttons the user has to know exist.
//
// IBKR is the only broker fully specified right now: it is the one with real
// depth (a synced API, a 365-day export cap, a broker chart with real
// pre-cap history, and its own performance screen). Every other broker gets
// whatever single door its lib/brokerHowTo.js entry already has (api first,
// else csv) — there is nothing more to sequence there YET, but the shape is
// the same, so adding a broker's own multi-step story later is just filling
// in this table.
//
// Every step is OPTIONAL — the checklist nudges, it never blocks. `done` is a
// pure function of app state so both the modal and any summary badge (an
// unfinished-step count) agree on what's left.
//
// FASE DR correction: this used to be four steps, with a "Subir los años
// anteriores (Flex XML)" step between connect and quarterly, on the theory
// that downloading one Flex Query per calendar year could reach back past the
// 365-day cap. It cannot — the cap is per ACCOUNT, not per file: IBKR does not
// let a Custom Date Range query reach further back than 365 days from today,
// no matter how the range is sliced. A file per year does not exist as a real
// action, so it never belonged in the checklist. The API/CSV connection (step
// 1) is the only door to real data, and it only ever covers the trailing
// ~365 days; everything older goes straight to quarterly transcription.
export const IBKR_STEPS = [
  {
    id: 'connect', kind: 'api',
    title: { es: 'Conectar con la API (Flex Query)', en: 'Connect via the API (Flex Query)' },
    desc: {
      es: 'Sync automático: posiciones, precios y los últimos ~365 días se mantienen al día solos.',
      en: 'Automatic sync: positions, prices and the trailing ~365 days stay up to date on their own.',
    },
    done: ({ ibkrConnected }) => !!ibkrConnected,
  },
  {
    id: 'quarterly', kind: 'quarterly',
    title: { es: 'Transcribir lo que el Flex Query no alcanza', en: 'Transcribe what the Flex Query cannot reach' },
    desc: {
      es: 'Si tu cuenta es más vieja que ~365 días, unos ~4 números por año desde Portfolio Analyst.',
      en: 'If your account is older than ~365 days, about ~4 numbers a year from Portfolio Analyst.',
    },
    done: ({ hasQuarterlyHistory }) => !!hasQuarterlyHistory,
    // Nothing to transcribe for an account younger than what the sync itself
    // already covers.
    skippable: ({ ibkrSnapshotSpanDays, earliestNeededDays }) =>
      earliestNeededDays != null && (ibkrSnapshotSpanDays || 0) >= earliestNeededDays,
  },
  {
    id: 'returns', kind: 'calibrate',
    title: { es: 'Copiar los retornos que muestra IBKR', en: 'Copy the returns IBKR shows' },
    // FASE FX. La calibración resuelve un retorno MONEY-weighted (Dietz), y
    // PortfolioAnalyst muestra TWR por defecto: hay que decirle al usuario que
    // cambie la métrica a MWR antes de copiar, o con depósitos/retiros en el
    // período el ancla queda resuelta contra la metodología equivocada. Sin
    // flujos en el período ambos números coinciden y da igual cuál copie.
    desc: {
      es: '1W, 1M, 3M, YTD, 1Y y desde el inicio: ancla tu curva a los números reales de tu broker. En PortfolioAnalyst cambia "Performance Measure" a MWR antes de copiar (nuestro cálculo es money-weighted; si no hiciste depósitos ni retiros en el período, TWR y MWR coinciden).',
      en: '1W, 1M, 3M, YTD, 1Y and since inception: anchors your curve to your broker\'s real numbers. In PortfolioAnalyst switch "Performance Measure" to MWR before copying (our math is money-weighted; with no deposits or withdrawals in the period, TWR and MWR match).',
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

// The gate for lib/inferredFlows.js: only once EVERY step of a broker's own
// checklist is done (or legitimately skippable) does the account have enough
// real data for an inference to be worth trusting. An account still missing a
// step — no quarterly transcription, no prior-year upload — gets nothing
// here: the existing manual "no-history" nudge keeps doing its job instead of
// this module guessing off a thinner data set than it was designed for.
// `howTo` matches getBrokerCompletionSteps's second argument; pass the same
// value BrokerCompletionModal already computes via getBrokerHowTo(brokerId).
export function hasCompleteBrokerData(brokerId, howTo, state) {
  const steps = getBrokerCompletionSteps(brokerId, howTo)
  if (steps.length === 0) return false
  return steps.every((s) => s.done(state) || (s.skippable && s.skippable(state)))
}
