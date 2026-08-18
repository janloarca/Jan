import { categorizeExpense, ruleFromCorrection, MERCHANT_RULES } from '../expenseCategorize'
import { FINANCE_CATEGORIES } from '../financeCategories'

describe('categorizeExpense', () => {
  it('classifies the notification that started this feature', () => {
    const { category, confidence } = categorizeExpense('Rally Padel Guatemala')
    expect(category).toBe('Entretenimiento')
    expect(confidence).toBe('rule')
  })

  it('matches regardless of case and accents', () => {
    expect(categorizeExpense('FARMACIA GALENO ZONA 10').category).toBe('Salud')
    expect(categorizeExpense('Panadería San Martín').category).toBe('Alimentación')
  })

  it('classifies common merchants into their group', () => {
    const cases = [
      ['UBER TRIP HELP.UBER.COM', 'Transporte'],
      ['NETFLIX.COM 866-579-7172', 'Suscripciones'],
      ['WALMART LOS PROCERES', 'Alimentación'],
      ['GASOLINERA PUMA CALZADA', 'Transporte'],
      ['EEGSA PAGO EN LINEA', 'Servicios'],
      ['CINEPOLIS OAKLAND', 'Entretenimiento'],
      ['AMAZON MKTPLACE PMTS', 'Compras'],
    ]
    for (const [merchant, expected] of cases) {
      expect([merchant, categorizeExpense(merchant).category]).toEqual([merchant, expected])
    }
  })

  it('falls back to Otros Gastos and flags it as unknown', () => {
    const res = categorizeExpense('ZZQX 4471')
    expect(res.category).toBe('Otros Gastos')
    expect(res.confidence).toBe('unknown')
  })

  it('handles an empty merchant without throwing', () => {
    expect(categorizeExpense('').category).toBe('Otros Gastos')
    expect(categorizeExpense(null).confidence).toBe('unknown')
  })

  it('word-boundary needles do not fire on substrings', () => {
    // 'uno ' (the fuel brand) must not match 'desayuno', 'bar ' not 'barberia'.
    expect(categorizeExpense('Desayuno sorpresa').category).not.toBe('Transporte')
    expect(categorizeExpense('Barberia Central').category).not.toBe('Alimentación')
  })

  it('covers the generic shapes that real Guatemalan statements print', () => {
    // Learned from a coverage pass over three real card statements. Only
    // GENERIC patterns belong here; a named local restaurant is what the
    // learned per-merchant rules are for.
    const cases = [
      ['EST. DE SERV. VISTA HE', 'Transporte'],
      ['ESTACION DE SERVICIO M', 'Transporte'],
      ['PARK-CENTRO', 'Transporte'],
      ['CADEJO BREWING COMPANY', 'Alimentación'],
      ['ARTE Y GASTRONOMIA', 'Alimentación'],
      ['FARMA VALUE Z15', 'Salud'],
      ['HOSTALES CA', 'Entretenimiento'],
    ]
    for (const [merchant, expected] of cases) {
      expect([merchant, categorizeExpense(merchant).category]).toEqual([merchant, expected])
    }
  })

  it("'park ' matches the whole word only, never inside 'parking'", () => {
    // 'parking' has its own needle; the point is that adding 'park ' did not
    // create a second, sloppier way to match it.
    expect(categorizeExpense('PARKING CENTRAL').matchedBy).toBe('parking')
    expect(categorizeExpense('PARK-CENTRO').matchedBy).toBe('park ')
  })

  it('user rules beat built-in rules', () => {
    const rules = [{ match: 'rally padel', category: 'Salud' }]
    const res = categorizeExpense('Rally Padel Guatemala', { rules })
    expect(res.category).toBe('Salud')
    expect(res.confidence).toBe('user')
  })

  it('the most specific user rule wins', () => {
    const rules = [
      { match: 'super', category: 'Alimentación' },
      { match: 'super mall entretenimiento', category: 'Entretenimiento' },
    ]
    expect(categorizeExpense('SUPER MALL ENTRETENIMIENTO ZONA 4', { rules }).category).toBe('Entretenimiento')
  })

  it('ignores malformed user rules instead of throwing', () => {
    const rules = [null, {}, { match: '' }, { category: 'Salud' }]
    expect(categorizeExpense('Uber trip', { rules }).category).toBe('Transporte')
  })

  it('every built-in rule targets a real expense category', () => {
    for (const rule of MERCHANT_RULES) {
      expect(FINANCE_CATEGORIES.EXPENSE).toContain(rule.category)
    }
  })
})

describe('ruleFromCorrection', () => {
  it('builds a normalized rule from a correction, sin la cola del banco', () => {
    // "Guatemala" al final es cola, no identidad: la regla igual reconoce a
    // "Rally Padel Guatemala" (es subcadena) Y al "RALLY PADEL" truncado que
    // imprime el estado de cuenta. Antes había que enseñar el mismo comercio
    // dos veces, una por cada forma de escribirlo.
    const rule = ruleFromCorrection('Rally Pádel Guatemala', 'Salud')
    expect(rule.match).toBe('rally padel')
    expect(rule.category).toBe('Salud')
    expect(categorizeExpense('RALLY PADEL', { rules: [rule] }).category).toBe('Salud')
    expect(categorizeExpense('Rally Padel Guatemala', { rules: [rule] }).category).toBe('Salud')
  })

  it('guarda la etiqueta que el usuario escribió, sin usarla para matchear', () => {
    // "mecánico" es para que después se vea "DONALD · mecánico" en vez de un
    // código de banco. Quien decide la categoría es la categoría, no el texto.
    const rule = ruleFromCorrection('DONALD', 'Transporte', '  mecánico  ')
    expect(rule).toEqual(expect.objectContaining({ match: 'donald', category: 'Transporte', label: 'mecánico' }))
  })

  it('sin etiqueta no inventa el campo', () => {
    expect(ruleFromCorrection('DONALD', 'Transporte').label).toBeUndefined()
  })

  it('returns null when there is nothing to learn', () => {
    expect(ruleFromCorrection('', 'Salud')).toBeNull()
    expect(ruleFromCorrection('Uber', '')).toBeNull()
  })
})
