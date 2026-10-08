import {
  learnRate, learnedRateSuggestion, learnedRateSignature, applyPatch, dismissPatch,
  declaredFixedRate, MIN_MONTHS,
} from '../learnedRate'

const item = (extra = {}) => ({
  id: 'f1', name: 'Fondo', type: 'Cuenta de ahorro', symbol: 'FONDO', currency: 'USD',
  quantity: 1, currentPrice: 1000, purchasePrice: 1000,
  incomeMode: 'percent', incomeRate: 4, ...extra,
})
const obs = (month, value, extra = {}) => ({ itemId: 'f1', month, value, currency: 'USD', ...extra })
// Saldo que crece a una tasa anual dada, mes a mes (días reales).
function series(startValue, annualPct, months) {
  const out = []
  let v = startValue
  const [y, m] = months[0].split('-').map(Number)
  months.forEach((mk, i) => {
    if (i > 0) {
      const [yy, mm] = mk.split('-').map(Number)
      const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
      v = v * Math.pow(1 + annualPct / 100, days / 365.25)
    }
    out.push(obs(mk, Math.round(v * 100) / 100))
  })
  return out
}
// Igual, pero aplicando un movimiento (monto con signo) al cierre de un mes.
function seriesWithFlow(startValue, annualPct, months, flowMonth, flow) {
  const out = []
  let v = startValue
  months.forEach((mk, i) => {
    if (i > 0) {
      const [yy, mm] = mk.split('-').map(Number)
      const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
      v = v * Math.pow(1 + annualPct / 100, days / 365.25)
      if (mk === flowMonth) v += flow
    }
    out.push(obs(mk, Math.round(v * 100) / 100))
  })
  return out
}
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']

describe('learnRate', () => {
  test('recupera la tasa de una serie limpia', () => {
    const r = learnRate({ item: item(), observations: series(1000, 6, MONTHS) })
    expect(r.status).toBe('ok')
    expect(r.ratePct).toBeCloseTo(6, 1)
    expect(r.used).toBe(4)
  })

  test('con menos de MIN_MONTHS meses utilizables no propone nada', () => {
    const r = learnRate({ item: item(), observations: series(1000, 6, MONTHS.slice(0, MIN_MONTHS)) })
    expect(r.status).toBe('insufficient')
    expect(r.ratePct).toBeNull()
  })

  test('meses no consecutivos no forman un par', () => {
    const o = series(1000, 6, ['2026-01', '2026-03', '2026-05', '2026-07', '2026-09'])
    expect(learnRate({ item: item(), observations: o }).status).toBe('insufficient')
  })

  test('un retiro REGISTRADO se descuenta y no estropea la tasa', () => {
    // En marzo salieron 300 (registrados): el saldo observado ya los refleja.
    const adj = seriesWithFlow(1000, 6, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], '2026-03', -300)
    const tx = [{ type: 'WITHDRAWAL', _linkedItemId: 'f1', date: '2026-03-10', totalAmount: 300, currency: 'USD' }]
    const r = learnRate({ item: item(), observations: adj, transactions: tx })
    expect(r.status).toBe('ok')
    expect(r.ratePct).toBeGreaterThan(5)
    expect(r.ratePct).toBeLessThan(7.5)
    expect(r.ignored.some((x) => x.reason === 'balance-dropped')).toBe(false)
  })

  test('un retiro SIN registrar (el saldo baja) se ignora, no se promedia', () => {
    const adj = seriesWithFlow(1000, 6, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'], '2026-04', -200)
    const r = learnRate({ item: item(), observations: adj })
    expect(r.ignored.some((x) => x.reason === 'balance-dropped')).toBe(true)
    expect(r.ratePct).toBeCloseTo(6, 0)
  })

  test('un dedazo al teclear un saldo queda fuera', () => {
    const base = series(5000, 5, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    const typo = base.map((o) => (o.month === '2026-04' ? { ...o, value: o.value + 120 } : o))
    const clean = learnRate({ item: item(), observations: base })
    const r = learnRate({ item: item(), observations: typo })
    expect(r.status).toBe('ok')
    expect(Math.abs(r.ratePct - clean.ratePct)).toBeLessThan(1.5)
    expect(r.ignored.length).toBeGreaterThan(0)
  })

  test('un mes dominado por un movimiento grande no cuenta', () => {
    const base = series(1000, 6, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
    const adj = base.map((o, i) => (i >= 3 ? { ...o, value: o.value + 800 } : o))
    const tx = [{ type: 'DEPOSIT', _linkedItemId: 'f1', date: '2026-04-05', totalAmount: 800, currency: 'USD' }]
    const r = learnRate({ item: item(), observations: adj, transactions: tx })
    expect(r.ignored.some((x) => x.reason === 'flow-dominated')).toBe(true)
  })

  test('el rendimiento que el usuario declaró (manual_yield) es crecimiento, no aporte', () => {
    const o = series(1000, 6, MONTHS)
    const tx = [{ type: 'DIVIDEND', _linkedItemId: 'f1', _source: 'manual_yield', date: '2026-03-31', totalAmount: 4, currency: 'USD' }]
    const withTx = learnRate({ item: item(), observations: o, transactions: tx })
    const without = learnRate({ item: item(), observations: o })
    expect(withTx.ratePct).toBeCloseTo(without.ratePct, 5)
  })

  test('el mes en curso nunca entra', () => {
    const o = series(1000, 6, MONTHS)
    const r = learnRate({ item: item(), observations: o, currentMonthKey: '2026-05' })
    expect(r.used).toBe(3)
  })

  test('una serie con tasas absurdas (>25% anual) no propone', () => {
    const r = learnRate({ item: item(), observations: series(1000, 90, MONTHS) })
    expect(r.status).toBe('insufficient')
    expect(r.ignored.every((x) => x.reason === 'implausible')).toBe(true)
  })

  test('observaciones en otra moneda se convierten a la del ítem', () => {
    const o = series(1000, 6, MONTHS).map((x) => ({ ...x, value: x.value * 7.5, currency: 'GTQ' }))
    const convert = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.5 : v)
    const r = learnRate({ item: item(), observations: o, convert })
    expect(r.ratePct).toBeCloseTo(6, 1)
  })
})

describe('learnedRateSuggestion', () => {
  const o = series(1000, 6, MONTHS)

  test('propone y deja aplicar cuando hay una tasa fija declarada distinta', () => {
    const s = learnedRateSuggestion({ item: item({ incomeRate: 4 }), observations: o })
    expect(s.ratePct).toBeCloseTo(6, 1)
    expect(s.declaredPct).toBe(4)
    expect(s.canApply).toBe(true)
  })

  test('no molesta si la declarada ya coincide', () => {
    expect(learnedRateSuggestion({ item: item({ incomeRate: 6 }), observations: o })).toBeNull()
  })

  test('sin tasa declarada se muestra pero NO se ofrece aplicar', () => {
    const s = learnedRateSuggestion({ item: item({ incomeMode: undefined, incomeRate: undefined }), observations: o })
    expect(s).not.toBeNull()
    expect(s.canApply).toBe(false)
    expect(declaredFixedRate(item({ rateType: 'variable' }))).toBeNull()
  })

  test('solo cuentas líquidas: un bono no aprende tasa', () => {
    const bond = item({ type: 'Bono', symbol: 'BONO-X' })
    expect(learnedRateSuggestion({ item: bond, observations: o })).toBeNull()
  })

  test('descartar la sugerencia la silencia hasta que cambien los datos', () => {
    const s = learnedRateSuggestion({ item: item(), observations: o })
    const dismissed = item({ ...dismissPatch(s) })
    expect(learnedRateSuggestion({ item: dismissed, observations: o })).toBeNull()
    const more = series(1000, 6, [...MONTHS, '2026-06'])
    expect(learnedRateSuggestion({ item: dismissed, observations: more })).not.toBeNull()
  })

  test('el parche de aplicar solo toca la tasa y deja constancia', () => {
    const s = learnedRateSuggestion({ item: item(), observations: o })
    const p = applyPatch(s, new Date('2026-10-08T00:00:00Z'))
    expect(Object.keys(p).sort()).toEqual(['_learnedRate', 'incomeRate'])
    expect(p.incomeRate).toBe(s.ratePct)
    expect(p._learnedRate.dismissed).toBe(false)
  })

  test('la firma depende de las observaciones del ítem', () => {
    const a = learnedRateSignature({ ratePct: 6, used: 4 }, o, 'f1')
    const b = learnedRateSignature({ ratePct: 6, used: 4 }, [...o, obs('2026-06', 9999)], 'f1')
    expect(a).not.toBe(b)
  })
})
