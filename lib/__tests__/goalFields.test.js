import {
  legacyProfileGoals, goalAdoptionPatch, goalsDiffer, goalsMigratedStamp,
  PROFILE_GOAL_CURRENCY,
} from '../goalFields'

// La tasa que usa el resto de las pruebas del repo.
const convert = (a, from, to) => (from === 'GTQ' && to === 'USD' ? a / 7.7 : a)

// El perfil real del usuario: Q3,000,000 para 2030, con meta de ingreso
// pasivo MENSUAL.
const PROFILE = { portfolioGoal: 3000000, targetYear: 2030, incomeGoal: 2000 }

describe('legacyProfileGoals', () => {
  it('encuentra lo que quedó guardado en el perfil', () => {
    expect(legacyProfileGoals(PROFILE)).toEqual({ incomeGoal: 2000, portfolioGoal: 3000000, targetYear: 2030 })
  })

  it('un perfil sin metas no tiene nada que migrar', () => {
    expect(legacyProfileGoals({ monthlyIncome: 8400 })).toBeNull()
    expect(legacyProfileGoals(null)).toBeNull()
  })

  it('un cero o un texto no son una meta', () => {
    expect(legacyProfileGoals({ portfolioGoal: 0, incomeGoal: '', targetYear: '' })).toBeNull()
  })

  it('la pregunta se hace UNA vez: ya resuelta, no vuelve', () => {
    expect(legacyProfileGoals({ ...PROFILE, _goalsMigratedAt: '2026-08-19T00:00:00Z' })).toBeNull()
  })
})

describe('goalAdoptionPatch', () => {
  it('convierte la moneda: el perfil vive en quetzales y las metas en la base', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals(PROFILE), { baseCurrency: 'USD', convert })
    // Q3,000,000 son ~$389,610, NO $3,000,000. Sin convertir, la meta se
    // multiplicaba por ocho.
    expect(patch.portfolioGoal).toBeCloseTo(3000000 / 7.7, 6)
    expect(patch.goalCurrency).toBe('USD')
  })

  it('la meta de ingreso pasa de MENSUAL a ANUAL', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals(PROFILE), { baseCurrency: 'USD', convert })
    // Q2,000 al mes son Q24,000 al año = ~$3,116. Sin el ×12 la meta quedaba
    // dividida entre doce.
    expect(patch.incomeGoal).toBeCloseTo((2000 * 12) / 7.7, 6)
  })

  it('el año objetivo no se convierte ni se escala', () => {
    expect(goalAdoptionPatch(legacyProfileGoals(PROFILE), { baseCurrency: 'USD', convert }).targetYear).toBe(2030)
  })

  it('con la base en quetzales no se convierte nada', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals(PROFILE), { baseCurrency: PROFILE_GOAL_CURRENCY, convert })
    expect(patch.portfolioGoal).toBe(3000000)
    expect(patch.incomeGoal).toBe(24000)
  })

  it('sin base conocida no estampa moneda: el legacy queda intacto', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals(PROFILE), {})
    expect(patch.goalCurrency).toBeUndefined()
  })

  it('sin tasa disponible usa el monto crudo en vez de propagar NaN', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals(PROFILE), { baseCurrency: 'USD', convert: () => NaN })
    expect(Number.isFinite(patch.portfolioGoal)).toBe(true)
    expect(patch.portfolioGoal).toBe(3000000)
  })

  it('solo emite los campos que de verdad estaban', () => {
    const patch = goalAdoptionPatch(legacyProfileGoals({ portfolioGoal: 500000 }), { baseCurrency: 'USD', convert })
    expect(patch.incomeGoal).toBeUndefined()
    expect(patch.targetYear).toBeUndefined()
    expect(patch.portfolioGoal).toBeCloseTo(500000 / 7.7, 6)
  })

  it('sin nada que migrar devuelve null', () => {
    expect(goalAdoptionPatch(null, { baseCurrency: 'USD', convert })).toBeNull()
  })
})

describe('goalsDiffer', () => {
  const legacy = legacyProfileGoals(PROFILE)

  it('el caso real: el perfil dice una cosa y el tablero mide contra su default', () => {
    expect(goalsDiffer(legacy, { portfolioGoal: 100000, targetYear: 2031 }, { baseCurrency: 'USD', convert })).toBe(true)
  })

  it('compara CONVERTIDO, no el número crudo', () => {
    // Metas ya tiene el equivalente exacto: no hay nada que preguntar.
    const yaIgual = { portfolioGoal: 3000000 / 7.7, incomeGoal: (2000 * 12) / 7.7, targetYear: 2030 }
    expect(goalsDiffer(legacy, yaIgual, { baseCurrency: 'USD', convert })).toBe(false)
  })

  it('una diferencia de centavos por redondeo de tasa no cuenta como diferencia', () => {
    const casiIgual = { portfolioGoal: (3000000 / 7.7) + 12, incomeGoal: (2000 * 12) / 7.7, targetYear: 2030 }
    expect(goalsDiffer(legacy, casiIgual, { baseCurrency: 'USD', convert })).toBe(false)
  })

  it('una meta que el tablero no tiene sí es una diferencia', () => {
    expect(goalsDiffer(legacy, {}, { baseCurrency: 'USD', convert })).toBe(true)
  })

  it('sin metas viejas no hay pregunta', () => {
    expect(goalsDiffer(null, { portfolioGoal: 100000 }, { baseCurrency: 'USD', convert })).toBe(false)
  })

  it('un año objetivo distinto cuenta aunque los montos coincidan', () => {
    const mismoMonto = { portfolioGoal: 3000000 / 7.7, incomeGoal: (2000 * 12) / 7.7, targetYear: 2035 }
    expect(goalsDiffer(legacy, mismoMonto, { baseCurrency: 'USD', convert })).toBe(true)
  })
})

describe('goalsMigratedStamp', () => {
  it('deja la marca que impide que la pregunta vuelva en cada carga', () => {
    const stamp = goalsMigratedStamp('2026-08-19T12:00:00Z')
    expect(stamp._goalsMigratedAt).toBe('2026-08-19T12:00:00Z')
    expect(legacyProfileGoals({ ...PROFILE, ...stamp })).toBeNull()
  })
})
