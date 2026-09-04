import { IBKR_JOURNEY_STEPS, ibkrJourneyProgress } from '../ibkrJourney'
import { IBKR_STEPS } from '../brokerCompletion'

const NOTHING = {
  ibkrConnected: false, ibkrNavDays: 0, ibkrSnapshotSpanDays: 0,
  hasQuarterlyHistory: false, hasIbkrCalibration: false, earliestNeededDays: 400,
}

describe('IBKR_JOURNEY_STEPS', () => {
  it('reuses brokerCompletion predicates instead of copying them', () => {
    const byId = (id) => IBKR_JOURNEY_STEPS.find((s) => s.id === id)
    expect(byId('connect').done).toBe(IBKR_STEPS.find((s) => s.id === 'connect').done)
    expect(byId('quarterly').done).toBe(IBKR_STEPS.find((s) => s.id === 'quarterly').done)
    expect(byId('quarterly').skippable).toBe(IBKR_STEPS.find((s) => s.id === 'quarterly').skippable)
    expect(byId('returns').done).toBe(IBKR_STEPS.find((s) => s.id === 'returns').done)
    // FASE NT: el aviso también se referencia, no se copia.
    expect(byId('returns').attention).toBe(IBKR_STEPS.find((s) => s.id === 'returns').attention)
  })

  it('FASE NT: the progress carries the attention text of step 4 without marking it done', () => {
    const p = ibkrJourneyProgress({ ...NOTHING, ibkrConnected: true, ibkrCalibrationIgnored: 1 })
    const returns = p.steps.find((s) => s.id === 'returns')
    expect(returns.status).toBe('todo')
    expect(returns.attention).toEqual({ es: expect.any(String), en: expect.any(String) })
    expect(returns.attention.es).toMatch(/ignorando/)
    // Los demás pasos no llevan aviso.
    expect(p.steps.filter((s) => s.attention)).toHaveLength(1)
    // Y sin nada ignorado, ninguno.
    expect(ibkrJourneyProgress({ ...NOTHING, ibkrConnected: true }).steps.every((s) => s.attention === null)).toBe(true)
  })

  it('maps every requirement to its journey step number', () => {
    expect(IBKR_JOURNEY_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4])
  })

  it('counts the history step as done off NAV documents, not span', () => {
    const history = IBKR_JOURNEY_STEPS.find((s) => s.id === 'history')
    // A sync that ran TODAY has a span of 0 days but did bring real data.
    expect(history.done({ ibkrNavDays: 1, ibkrSnapshotSpanDays: 0 })).toBe(true)
    expect(history.done({ ibkrNavDays: 0, ibkrSnapshotSpanDays: 0 })).toBe(false)
  })
})

describe('ibkrJourneyProgress', () => {
  it('is 0% and not started with nothing done', () => {
    const p = ibkrJourneyProgress(NOTHING)
    expect(p.pct).toBe(0)
    expect(p.done).toBe(0)
    expect(p.started).toBe(false)
    expect(p.complete).toBe(false)
    expect(p.nextStep).toBe(1)
  })

  it('flips to started at the first completed requirement', () => {
    const p = ibkrJourneyProgress({ ...NOTHING, ibkrConnected: true })
    expect(p.started).toBe(true)
    expect(p.done).toBe(1)
    expect(p.pct).toBe(25)
    expect(p.nextStep).toBe(2)
  })

  it('points to the first PENDING step, skipping the ones already done', () => {
    const p = ibkrJourneyProgress({ ...NOTHING, ibkrConnected: true, ibkrNavDays: 200, hasIbkrCalibration: true })
    expect(p.nextStep).toBe(3)
    expect(p.pct).toBe(75)
  })

  it('counts a legitimately unnecessary step toward 100%', () => {
    // Account younger than the synced span: there is nothing older to transcribe.
    const p = ibkrJourneyProgress({
      ibkrConnected: true, ibkrNavDays: 300, ibkrSnapshotSpanDays: 500,
      hasQuarterlyHistory: false, hasIbkrCalibration: true, earliestNeededDays: 400,
    })
    expect(p.steps.find((s) => s.id === 'quarterly').status).toBe('skippable')
    expect(p.pct).toBe(100)
    expect(p.complete).toBe(true)
    expect(p.nextStep).toBe(null)
    // Still honest about what was actually DONE by the user.
    expect(p.done).toBe(3)
  })

  it('reports a done step as done, never as unnecessary', () => {
    const p = ibkrJourneyProgress({
      ibkrConnected: true, ibkrNavDays: 300, ibkrSnapshotSpanDays: 500,
      hasQuarterlyHistory: true, hasIbkrCalibration: true, earliestNeededDays: 400,
    })
    expect(p.steps.find((s) => s.id === 'quarterly').status).toBe('done')
    expect(p.done).toBe(4)
    expect(p.pct).toBe(100)
  })

  it('reaches 100% with all four genuinely done', () => {
    const p = ibkrJourneyProgress({
      ibkrConnected: true, ibkrNavDays: 300, ibkrSnapshotSpanDays: 200,
      hasQuarterlyHistory: true, hasIbkrCalibration: true, earliestNeededDays: 900,
    })
    expect(p.pct).toBe(100)
    expect(p.complete).toBe(true)
  })

  it('tolerates an empty state without throwing', () => {
    const p = ibkrJourneyProgress()
    expect(p.pct).toBe(0)
    expect(p.steps).toHaveLength(4)
  })
})
