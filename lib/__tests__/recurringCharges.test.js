import { detectRecurringCharges, longCadencePaymentsInMonth, annualPaymentsOfMonth, MISSING_GRACE_DAYS } from '../recurringCharges'

const tx = (date, merchant, amount, over = {}) => ({
  id: `${date}-${merchant}-${amount}`,
  type: 'EXPENSE', date, merchant, description: merchant,
  amount, currency: 'GTQ', category: 'Suscripciones',
  ...over,
})

// Una suscripción de manual: mismo comercio, mismo monto, una vez por mes.
const netflixRows = (months, amount = 54.99, day = '05') =>
  months.map((m) => tx(`${m}-${day}`, 'NETFLIX.COM GT', amount))

describe('detectRecurringCharges: la nómina mensual', () => {
  it('detecta una suscripción con 3+ meses consecutivos y la suma al total', () => {
    const rows = netflixRows(['2026-05', '2026-06', '2026-07', '2026-08'])
    const { monthly, totalMonthlyGtq } = detectRecurringCharges(rows, { nowDate: '2026-08-20' })
    expect(monthly).toHaveLength(1)
    expect(monthly[0].label).toBe('NETFLIX.COM GT')
    expect(monthly[0].latestAmount).toBe(54.99)
    expect(monthly[0].expectedDay).toBe(5)
    expect(monthly[0].monthsActive).toBe(4)
    expect(totalMonthlyGtq).toBeCloseTo(54.99, 2)
  })

  it('con solo 2 meses NO afirma recurrencia: sería una adivinanza con cara de dato', () => {
    const rows = netflixRows(['2026-07', '2026-08'])
    expect(detectRecurringCharges(rows, { nowDate: '2026-08-20' }).monthly).toHaveLength(0)
  })

  it('un supermercado con varios cobros al mes NO es una suscripción', () => {
    const rows = []
    for (const m of ['2026-06', '2026-07', '2026-08']) {
      for (const d of ['03', '08', '14', '19', '25']) rows.push(tx(`${m}-${d}`, 'LA TORRE GT', 250, { category: 'Alimentación' }))
    }
    expect(detectRecurringCharges(rows, { nowDate: '2026-08-28' }).monthly).toHaveLength(0)
  })

  it('dos colas de banco distintas del mismo comercio caen en UN grupo', () => {
    const rows = [
      tx('2026-05-05', 'SPOTIFY GT', 64.99),
      tx('2026-06-05', 'SPOTIFY ZONA 10 GT', 64.99),
      tx('2026-07-05', 'SPOTIFY', 64.99),
    ]
    const { monthly } = detectRecurringCharges(rows, { nowDate: '2026-07-20' })
    expect(monthly).toHaveLength(1)
    // La etiqueta es la variante más corta vista, no la primera.
    expect(monthly[0].label).toBe('SPOTIFY')
  })

  it('reporta un alza de precio reciente con el antes, el después y el mes', () => {
    const rows = [
      ...netflixRows(['2026-03', '2026-04', '2026-05'], 54.99),
      ...netflixRows(['2026-06', '2026-07'], 64.99),
    ]
    const { monthly } = detectRecurringCharges(rows, { nowDate: '2026-07-20' })
    expect(monthly[0].rise).toEqual({ from: 54.99, to: 64.99, month: '2026-06' })
  })

  it('un alza vieja (hace más de 3 meses) ya no es noticia', () => {
    const rows = [
      ...netflixRows(['2025-11', '2025-12'], 54.99),
      ...netflixRows(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'], 64.99),
    ]
    const { monthly } = detectRecurringCharges(rows, { nowDate: '2026-08-20' })
    expect(monthly[0].rise).toBeNull()
  })

  it('"no cobró este mes" respeta la gracia del día esperado', () => {
    const rows = netflixRows(['2026-05', '2026-06', '2026-07'], 54.99, '10')
    // El día 12 todavía no venció la gracia (10 + 5): no se afirma nada.
    const early = detectRecurringCharges(rows, { nowDate: `2026-08-${String(10 + MISSING_GRACE_DAYS - 3).padStart(2, '0')}` })
    expect(early.monthly[0].missing).toBe(false)
    // El día 16 sí: el cobro esperado ya debió caer.
    const late = detectRecurringCharges(rows, { nowDate: `2026-08-${String(10 + MISSING_GRACE_DAYS + 1).padStart(2, '0')}` })
    expect(late.monthly[0].missing).toBe(true)
  })

  it('un grupo cuyo último cobro es de hace 2+ meses sale de la nómina', () => {
    const rows = netflixRows(['2026-01', '2026-02', '2026-03'])
    expect(detectRecurringCharges(rows, { nowDate: '2026-08-20' }).monthly).toHaveLength(0)
  })

  it('exclusiones: cuotas, pagos, transferencias y reversos no cuentan', () => {
    const rows = [
      ...['2026-06', '2026-07', '2026-08'].map((m) => tx(`${m}-05`, 'ISHOP GT', 268.85, { installment: { num: 3, of: 36 } })),
      ...['2026-06', '2026-07', '2026-08'].map((m) => tx(`${m}-10`, 'PAGO EN LINEA', 5000, { kind: 'payment', type: 'INCOME' })),
      ...['2026-06', '2026-07', '2026-08'].map((m) => tx(`${m}-12`, 'ENVIO ZELLE', 1000, { category: 'Transferencia Enviada' })),
      ...['2026-06', '2026-07', '2026-08'].map((m) => tx(`${m}-15`, 'DEVOLUCION TIENDA', -120)),
    ]
    const out = detectRecurringCharges(rows, { nowDate: '2026-08-20' })
    expect(out.monthly).toHaveLength(0)
    expect(out.longCadence).toHaveLength(0)
  })

  it('una suscripción en dólares se compara en dólares y el total se convierte', () => {
    const rows = ['2026-05', '2026-06', '2026-07'].map((m) => tx(`${m}-08`, 'OPENAI CHATGPT', 20, { currency: 'USD' }))
    const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.7 : a)
    const { monthly, totalMonthlyGtq } = detectRecurringCharges(rows, { convert, nowDate: '2026-07-20' })
    expect(monthly[0].latestAmount).toBe(20)
    expect(monthly[0].currency).toBe('USD')
    expect(totalMonthlyGtq).toBeCloseTo(154, 2)
  })

  it('un grupo que mezcla monedas se rechaza: un mismo cargo no cambia de moneda', () => {
    const rows = [
      tx('2026-05-08', 'AMBIGUO GT', 20, { currency: 'USD' }),
      tx('2026-06-08', 'AMBIGUO GT', 154, { currency: 'GTQ' }),
      tx('2026-07-08', 'AMBIGUO GT', 20, { currency: 'USD' }),
    ]
    expect(detectRecurringCharges(rows, { nowDate: '2026-07-20' }).monthly).toHaveLength(0)
  })
})

describe('cadencia larga (anual / semestral), el insumo de la feature 4', () => {
  it('dos primas a ~un año se leen como anuales, nunca como suscripción', () => {
    const rows = [
      tx('2025-07-14', 'SEGUROS UNIVERSALES', 39782, { category: 'Seguros' }),
      tx('2026-07-15', 'SEGUROS UNIVERSALES', 39782, { category: 'Seguros' }),
    ]
    const out = detectRecurringCharges(rows, { nowDate: '2026-08-20' })
    expect(out.monthly).toHaveLength(0)
    expect(out.longCadence).toHaveLength(1)
    expect(out.longCadence[0].cadence).toBe('annual')
    expect(out.longCadence[0].latestAmount).toBe(39782)
  })

  it('~6 meses es semestral; 3 meses no es ninguna de las dos', () => {
    const semi = [tx('2026-01-10', 'COLEGIO ABC', 7583), tx('2026-07-08', 'COLEGIO ABC', 7583)]
    expect(detectRecurringCharges(semi, { nowDate: '2026-08-20' }).longCadence[0].cadence).toBe('semiannual')
    const quarterly = [tx('2026-01-10', 'TRIMESTRAL SA', 500), tx('2026-04-10', 'TRIMESTRAL SA', 500)]
    const out = detectRecurringCharges(quarterly, { nowDate: '2026-08-20' })
    expect(out.longCadence).toHaveLength(0)
  })

  it('longCadencePaymentsInMonth suma las filas REALES del mes marcadas como cadencia larga', () => {
    const history = [
      tx('2025-07-14', 'SEGUROS UNIVERSALES', 5166, { currency: 'USD', category: 'Seguros' }),
      tx('2026-07-15', 'SEGUROS UNIVERSALES', 5166, { currency: 'USD', category: 'Seguros' }),
      tx('2026-07-20', 'LA TORRE GT', 690, { category: 'Alimentación' }),
    ]
    const { longCadence } = detectRecurringCharges(history, { nowDate: '2026-08-20' })
    const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.7 : a)
    const july = longCadencePaymentsInMonth(history, '2026-07', longCadence, { convert })
    expect(july.rows).toHaveLength(1)
    expect(july.totalGtq).toBeCloseTo(5166 * 7.7, 2)
    // Un mes sin la prima no suma nada.
    expect(longCadencePaymentsInMonth(history, '2026-06', longCadence, { convert }).totalGtq).toBe(0)
  })
})

describe('annualPaymentsOfMonth: marca manual + cadencia detectada, sin tocar el total', () => {
  const convert = (a, from, to) => (from === 'USD' && to === 'GTQ' ? a * 7.7 : a)

  it('una fila marcada a mano cuenta aunque sea la UNICA aparicion del comercio', () => {
    // El caso real de FASE JW: la prima aparece UNA vez en 3 meses de historia,
    // asi que ninguna cadencia puede detectarla. La marca del usuario es la via.
    const rows = [
      tx('2026-07-15', 'SEGUROS UNIVERSALES', 5166, { currency: 'USD', category: 'Seguros', _annualCadence: true }),
      tx('2026-07-20', 'LA TORRE GT', 690, { category: 'Alimentación' }),
    ]
    const out = annualPaymentsOfMonth(rows, '2026-07', { convert, longCadence: [] })
    expect(out.rows).toHaveLength(1)
    expect(out.totalGtq).toBeCloseTo(5166 * 7.7, 2)
    // Otro mes: nada.
    expect(annualPaymentsOfMonth(rows, '2026-08', { convert, longCadence: [] }).totalGtq).toBe(0)
  })

  it('una fila marcada Y detectada cuenta UNA vez (dedupe por id)', () => {
    const history = [
      tx('2025-07-14', 'SEGUROS UNIVERSALES', 39782, { category: 'Seguros' }),
      tx('2026-07-15', 'SEGUROS UNIVERSALES', 39782, { category: 'Seguros', _annualCadence: true }),
    ]
    const { longCadence } = detectRecurringCharges(history, { nowDate: '2026-08-20' })
    expect(longCadence).toHaveLength(1)
    const out = annualPaymentsOfMonth(history, '2026-07', { longCadence })
    expect(out.rows).toHaveLength(1)
    expect(out.totalGtq).toBeCloseTo(39782, 2)
  })

  it('un ingreso o un reverso marcados por error no cuentan', () => {
    const rows = [
      tx('2026-07-10', 'BONO ANUAL', 20000, { type: 'INCOME', _annualCadence: true }),
      tx('2026-07-12', 'DEVOLUCION SEGURO', -500, { _annualCadence: true }),
    ]
    expect(annualPaymentsOfMonth(rows, '2026-07', {}).totalGtq).toBe(0)
  })
})
