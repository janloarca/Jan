import { parseEquitySummary, normalizeFlexDate } from '../parsers/ibkrEquitySummary'

describe('normalizeFlexDate', () => {
  it('parses YYYYMMDD', () => {
    expect(normalizeFlexDate('20260102')).toBe('2026-01-02')
  })
  it('parses YYYY-MM-DD and trims stray punctuation', () => {
    expect(normalizeFlexDate('2026-01-02')).toBe('2026-01-02')
    expect(normalizeFlexDate('2026-01-02;')).toBe('2026-01-02')
  })
  it('returns undefined for junk/empty', () => {
    expect(normalizeFlexDate('')).toBeUndefined()
    expect(normalizeFlexDate('nope')).toBeUndefined()
    expect(normalizeFlexDate(undefined)).toBeUndefined()
  })
})

describe('parseEquitySummary', () => {
  it('parses self-closing rows', () => {
    const xml = `
      <EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="9000" totalShort="0" cash="300" />
      <EquitySummaryByReportDateInBase reportDate="20260601" total="10112" totalLong="9800" totalShort="0" cash="312" />
    `
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      date: '2026-01-02', netWorthUSD: 9300, totalActivosUSD: 9300, totalDebtUSD: 0, _source: 'ibkr',
    })
    expect(out[1].date).toBe('2026-06-01')
    expect(out[1].netWorthUSD).toBe(10112)
  })

  it('parses PAIRED (non-self-closing) rows — the shape a /> regex dropped', () => {
    const xml = `
      <EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="9000" cash="300"></EquitySummaryByReportDateInBase>
      <EquitySummaryByReportDateInBase reportDate="20260103" total="9350" totalLong="9050" cash="300"></EquitySummaryByReportDateInBase>
    `
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(2)
    expect(out.map((e) => e.date)).toEqual(['2026-01-02', '2026-01-03'])
  })

  it('handles a mix of self-closing and paired rows', () => {
    const xml = `
      <EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="9000" cash="300" />
      <EquitySummaryByReportDateInBase reportDate="20260103" total="9350" totalLong="9050" cash="300"></EquitySummaryByReportDateInBase>
    `
    expect(parseEquitySummary(xml)).toHaveLength(2)
  })

  it('skips rows with total=0 or no reportDate', () => {
    const xml = `
      <EquitySummaryByReportDateInBase reportDate="20260102" total="0" totalLong="0" cash="0" />
      <EquitySummaryByReportDateInBase reportDate="" total="500" totalLong="500" cash="0" />
      <EquitySummaryByReportDateInBase reportDate="20260104" total="9400" totalLong="9100" cash="300" />
    `
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-04')
  })

  it('dedupes repeated report dates (banks repeat rows across pages)', () => {
    const xml = `
      <EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="9000" cash="300" />
      <EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="9000" cash="300" />
    `
    expect(parseEquitySummary(xml)).toHaveLength(1)
  })

  it('multi-cuenta: el NAV del dia es la SUMA de las cuentas, no la primera', () => {
    // El defecto real: con dedupe por fecha a secas, un reporte de dos cuentas
    // guardaba 10,000 y la segunda desaparecia del historial de valor sin
    // ningun aviso. Este caso lo fija.
    const xml = `
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260102" total="10000" totalLong="9700" totalShort="0" cash="300" />
      <EquitySummaryByReportDateInBase accountId="U222" reportDate="20260102" total="7000" totalLong="6800" totalShort="0" cash="200" />
    `
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(1)
    expect(out[0].netWorthUSD).toBe(17000)
    expect(out[0].totalActivosUSD).toBe(17000)
  })

  it('la misma cuenta repetida entre paginas sigue contando UNA vez', () => {
    const xml = `
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260102" total="10000" totalLong="9700" cash="300" />
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260102" total="10000" totalLong="9700" cash="300" />
      <EquitySummaryByReportDateInBase accountId="U222" reportDate="20260102" total="7000" totalLong="6800" cash="200" />
    `
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(1)
    expect(out[0].netWorthUSD).toBe(17000)
  })

  it('la deuda de cada cuenta tambien suma', () => {
    const xml = `
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260102" total="9300" totalLong="10000" totalShort="-700" cash="0" />
      <EquitySummaryByReportDateInBase accountId="U222" reportDate="20260102" total="4900" totalLong="5000" totalShort="-100" cash="0" />
    `
    const out = parseEquitySummary(xml)
    expect(out[0].netWorthUSD).toBe(14200)
    expect(out[0].totalDebtUSD).toBe(800)
  })

  it('una sola cuenta se comporta EXACTAMENTE igual que antes', () => {
    const xml = `
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260102" total="9300" totalLong="9000" totalShort="0" cash="300" />
      <EquitySummaryByReportDateInBase accountId="U111" reportDate="20260103" total="9350" totalLong="9050" totalShort="0" cash="300" />
    `
    expect(parseEquitySummary(xml)).toEqual([
      { date: '2026-01-02', netWorthUSD: 9300, totalActivosUSD: 9300, totalDebtUSD: 0, _source: 'ibkr' },
      { date: '2026-01-03', netWorthUSD: 9350, totalActivosUSD: 9350, totalDebtUSD: 0, _source: 'ibkr' },
    ])
  })

  it('reflects short positions as debt via totalShort', () => {
    const xml = `<EquitySummaryByReportDateInBase reportDate="20260102" total="9300" totalLong="10000" totalShort="-700" cash="0" />`
    const out = parseEquitySummary(xml)
    expect(out[0].totalDebtUSD).toBe(700)
  })

  it('returns [] for empty/missing xml', () => {
    expect(parseEquitySummary('')).toEqual([])
    expect(parseEquitySummary(null)).toEqual([])
    expect(parseEquitySummary('<FlexStatement></FlexStatement>')).toEqual([])
  })
})
