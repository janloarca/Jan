import {
  effectiveAnnualRate, simulateScenario, compareScenarios, termMonthsOf, newScenario, COMPOUND_OPTIONS,
} from '../investmentCompare'

describe('effectiveAnnualRate', () => {
  it('capitalización anual: la efectiva es la nominal', () => {
    expect(effectiveAnnualRate(7, 'annually')).toBeCloseTo(0.07, 12)
  })
  it('mensual rinde más que anual con la misma nominal', () => {
    expect(effectiveAnnualRate(12, 'monthly')).toBeCloseTo(Math.pow(1.01, 12) - 1, 12)
    expect(effectiveAnnualRate(12, 'monthly')).toBeGreaterThan(effectiveAnnualRate(12, 'annually'))
  })
  it('la continua es el techo de todas las demás', () => {
    const cont = effectiveAnnualRate(12, 'continuously')
    expect(cont).toBeCloseTo(Math.exp(0.12) - 1, 12)
    for (const o of COMPOUND_OPTIONS) {
      if (o.perYear != null) expect(effectiveAnnualRate(12, o.key)).toBeLessThan(cont + 1e-12)
    }
  })
  it('más frecuencia nunca rinde menos', () => {
    const discretas = COMPOUND_OPTIONS.filter((o) => o.perYear != null)
    for (let i = 1; i < discretas.length; i++) {
      expect(effectiveAnnualRate(8, discretas[i].key)).toBeGreaterThan(effectiveAnnualRate(8, discretas[i - 1].key) - 1e-12)
    }
  })
})

describe('el ancla: el caso exacto de calculator.net que trajo el usuario', () => {
  // $3 inicial, 7%, capitalización anual, 50 años, sin aportes.
  // La captura de calculator.net dice: Ending balance $88.37, Total principal
  // $3.00, Total interest $85.37.
  const s = newScenario('a', 'A', { initial: 3, ratePct: 7, compound: 'annually', years: 50 })

  it('reproduce el saldo final al centavo', () => {
    const r = simulateScenario(s, termMonthsOf(s))
    expect(r.endBalance.toFixed(2)).toBe('88.37')
    expect(r.totalContributed.toFixed(2)).toBe('3.00')
    expect(r.totalInterest.toFixed(2)).toBe('85.37')
  })

  it('y es exactamente la fórmula cerrada, no una aproximación', () => {
    const r = simulateScenario(s, termMonthsOf(s))
    expect(r.endBalance).toBeCloseTo(3 * Math.pow(1.07, 50), 9)
  })
})

describe('aportes: al inicio contra al final del período', () => {
  // $100 al mes, 12% capitalizado mensual, un año. Es la anualidad clásica:
  // ordinaria (al final) 1,268.25 y anticipada (al inicio) un mes más de
  // interés sobre cada aporte: × 1.01.
  const base = { id: 'x', initial: 0, monthly: 100, annual: 0, ratePct: 12, compound: 'monthly', years: 1, months: 0 }

  it('al final del período es la anualidad ordinaria', () => {
    const r = simulateScenario({ ...base, contributeAt: 'end' }, 12)
    expect(r.endBalance).toBeCloseTo(100 * ((Math.pow(1.01, 12) - 1) / 0.01), 6)
    expect(r.endBalance.toFixed(2)).toBe('1268.25')
  })

  it('al inicio rinde exactamente un período más', () => {
    const fin = simulateScenario({ ...base, contributeAt: 'end' }, 12)
    const ini = simulateScenario({ ...base, contributeAt: 'beginning' }, 12)
    expect(ini.endBalance).toBeCloseTo(fin.endBalance * 1.01, 6)
    expect(ini.endBalance.toFixed(2)).toBe('1280.93')
  })

  it('los dos aportan el mismo capital: la diferencia es solo interés', () => {
    const fin = simulateScenario({ ...base, contributeAt: 'end' }, 12)
    const ini = simulateScenario({ ...base, contributeAt: 'beginning' }, 12)
    expect(ini.totalContributed).toBe(fin.totalContributed)
    expect(ini.totalContributed).toBe(1200)
  })
})

describe('el aporte anual cae una vez al año', () => {
  it('doce meses aportan el anual una sola vez', () => {
    const s = { initial: 0, monthly: 0, annual: 1200, ratePct: 0, compound: 'annually', years: 1, contributeAt: 'end' }
    expect(simulateScenario(s, 12).totalContributed).toBe(1200)
    expect(simulateScenario({ ...s, years: 3 }, 36).totalContributed).toBe(3600)
  })
})

describe('plazos distintos: el corto se congela en efectivo', () => {
  const corto = newScenario('a', 'Corto', { initial: 1000, ratePct: 10, compound: 'annually', years: 2 })
  const largo = newScenario('b', 'Largo', { initial: 1000, ratePct: 7, compound: 'annually', years: 10 })

  it('el horizonte común es el plazo más largo', () => {
    expect(compareScenarios([corto, largo]).horizonMonths).toBe(120)
  })

  it('al vencer, el saldo del corto deja de crecer', () => {
    const r = simulateScenario(corto, 120)
    expect(r.maturityBalance).toBeCloseTo(1000 * 1.21, 9)
    expect(r.endBalance).toBeCloseTo(r.maturityBalance, 9) // congelado ocho años
  })

  it('el corto va ganando al principio y el largo lo pasa después', () => {
    const c = compareScenarios([corto, largo])
    expect(c.yearly[2].bestIndex).toBe(0)   // año 2: el corto va arriba
    expect(c.winnerIndex).toBe(1)           // al año 10 gana el largo
  })

  it('un plazo congelado tampoco sigue recibiendo aportes', () => {
    const conAportes = newScenario('c', 'C', { initial: 0, monthly: 100, ratePct: 0, compound: 'annually', years: 1 })
    const r = simulateScenario(conAportes, 60)
    expect(r.totalContributed).toBe(1200)
    expect(r.endBalance).toBe(1200)
  })
})

describe('compareScenarios', () => {
  it('la última fila dice el saldo final, no un año inventado más allá del horizonte', () => {
    const s = newScenario('a', 'A', { initial: 100, ratePct: 10, compound: 'annually', years: 2, months: 6 })
    const c = compareScenarios([s])
    const last = c.yearly[c.yearly.length - 1]
    expect(last.partial).toBe(true)
    expect(last.values[0]).toBeCloseTo(c.results[0].endBalance, 9)
  })

  it('la diferencia contra el mejor es cero para el ganador y negativa para el resto', () => {
    const a = newScenario('a', 'A', { initial: 1000, ratePct: 5, years: 10 })
    const b = newScenario('b', 'B', { initial: 1000, ratePct: 9, years: 10 })
    const c = compareScenarios([a, b])
    expect(c.winnerIndex).toBe(1)
    expect(c.results[1].deltaVsBest).toBe(0)
    expect(c.results[0].deltaVsBest).toBeLessThan(0)
  })

  it('sin escenarios no explota', () => {
    const c = compareScenarios([])
    expect(c.results).toEqual([])
    expect(c.winnerIndex).toBe(-1)
    expect(c.horizonMonths).toBe(1)
  })

  it('un plazo de cero deja el capital intacto', () => {
    const r = simulateScenario(newScenario('a', 'A', { initial: 500, years: 0, months: 0 }), 12)
    expect(r.endBalance).toBe(500)
    expect(r.totalInterest).toBe(0)
  })
})

describe('entradas basura', () => {
  it('un texto en un campo numérico cuenta como cero, nunca como NaN', () => {
    const r = simulateScenario({ initial: 'hola', monthly: null, annual: undefined, ratePct: '', years: 1 }, 12)
    expect(Number.isFinite(r.endBalance)).toBe(true)
    expect(r.endBalance).toBe(0)
  })

  it('una tasa que destruye todo el capital no produce NaN', () => {
    const r = simulateScenario({ initial: 1000, ratePct: -200, compound: 'annually', years: 3 }, 36)
    expect(Number.isFinite(r.endBalance)).toBe(true)
    expect(r.endBalance).toBe(0)
  })
})
