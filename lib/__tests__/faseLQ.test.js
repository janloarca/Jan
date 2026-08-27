// FASE LQ: los avisos de "Chispu te sugiere" que afirmaban cosas falsas.
//
// Cada bloque ejercita el motor REAL (`analyzeDataCompleteness`) con la forma
// que dispara el defecto, y varios fijan el comportamiento viejo como
// regresión negativa explícita.

import { analyzeDataCompleteness } from '../dataCompleteness'
import { getGeographyFromItem } from '../../components/dashboard/utils'

const NOW = new Date('2026-08-27T12:00:00Z').getTime()
const codes = (r) => r.findings.map((f) => f.code)
const find = (r, code) => r.findings.find((f) => f.code === code)

// Cuenta líquida sana: país, institución, fechas y meses puestos, y el saldo
// confirmado este mes. Es la forma que la app produce al guardar desde
// cualquiera de las tres superficies que corrigen un saldo.
const FONDO = {
  id: 'f1', name: 'FONDO LÍQUIDO $', type: 'Cash', currency: 'USD',
  quantity: 1, currentPrice: 1300,
  acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z',
  assetCountry: 'GT', institution: 'IDC',
  balanceAsOf: '2026-08-01',
  dividendYield: 5, dividendAction: 'reinvest',
  incomeMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}
const DEPOSITO = { id: 't1', type: 'DEPOSIT', _linkedItemId: 'f1', totalAmount: 1000, currency: 'USD', date: '2025-02-01' }

const run = (over = {}, transactions = [DEPOSITO]) =>
  analyzeDataCompleteness({ items: [{ ...FONDO, ...over }], transactions, baseCurrency: 'USD', now: NOW })

// ── 1. `stale-value` ignoraba el campo que contesta su propia pregunta ────
describe('un saldo confirmado este mes no está viejo', () => {
  it('con balanceAsOf reciente no se avisa', () => {
    expect(codes(run())).not.toContain('stale-value')
  })

  // Regresión negativa: sin leer `balanceAsOf`, el check cae a la fecha de
  // adquisición (2025-01-01) y afirma "más de 180 días" sobre una cuenta cuyo
  // saldo el usuario confirmó hace 26 días.
  it('el comportamiento viejo (ignorar balanceAsOf) sí lo habría avisado', () => {
    expect(codes(run({ balanceAsOf: null }))).toContain('stale-value')
  })

  it('un balanceAsOf de verdad viejo sigue avisando', () => {
    expect(codes(run({ balanceAsOf: '2025-06-01' }))).toContain('stale-value')
  })

  it('`balanceAsOf` gana sobre las otras fuentes, no las reemplaza', () => {
    // Sin balanceAsOf pero con valuación reciente: sigue sin avisar.
    expect(codes(run({ balanceAsOf: null, lastValuationDate: '2026-08-10' }))).not.toContain('stale-value')
  })
})

// ── 2. Una cuenta que REINVIERTE no tiene pagos que registrar ─────────────
describe('income-never-received no puede acusar a una cuenta que compone', () => {
  it('reinvertir no genera el aviso', () => {
    expect(codes(run())).not.toContain('income-never-received')
  })

  // Regresión negativa: es exactamente el gate que su hermano `income-no-dest`
  // ya aplicaba tres bloques arriba.
  it('sin el gate de reinvest, el aviso salía', () => {
    expect(codes(run({ dividendAction: 'cash', incomeDestination: 'otra' }))).toContain('income-never-received')
  })

  it('una cuenta que SÍ paga en efectivo y nunca cobró sigue avisando', () => {
    const r = run({ dividendAction: 'cash', incomeDestination: 'otra' })
    const f = find(r, 'income-never-received')
    expect(f.action.kind).toBe('cashflow')
    expect(f.action.prefill.origin).toBe('yield')
  })

  it('una cuenta que reinvierte y encima ya tiene pagos tampoco avisa', () => {
    const conPago = [DEPOSITO, { id: 't2', type: 'DIVIDEND', _linkedItemId: 'f1', _reinvested: true, totalAmount: 12, currency: 'USD', date: '2026-07-01' }]
    expect(codes(run({}, conPago))).not.toContain('income-never-received')
  })
})

// ── 3. No se puede afirmar que falta MÁS dinero del que la cuenta tiene ───
describe('movimientos que netean negativo sobre un saldo positivo', () => {
  // El caso REAL del usuario, reproducido al pie: saldo 500, un depósito de
  // 500 y un retiro de 722. El motor viejo imprimía "Solo el 0% del saldo
  // tiene historia: faltan aportes por USD 722" y prellenaba 722.
  const CASO = [
    { id: 'd', type: 'DEPOSIT', _linkedItemId: 'f1', totalAmount: 500, currency: 'USD', date: '2025-02-01' },
    { id: 'w', type: 'WITHDRAWAL', _linkedItemId: 'f1', totalAmount: 722, currency: 'USD', date: '2025-03-01' },
  ]
  const r = () => run({ currentPrice: 500, dividendYield: 0 }, CASO)

  it('ya no se reporta como historia parcial', () => {
    expect(codes(r())).not.toContain('partial-history')
  })

  it('se nombra el hecho real, con los dos números y sin adivinar la causa', () => {
    const f = find(r(), 'flows-exceed-balance')
    expect(f).toBeTruthy()
    // El número que se publica es el EXCESO DE SALIDAS (722 - 500 = 222), un
    // hecho de los propios movimientos. Los 722 del aviso viejo eran
    // `saldo - neto`, o sea una cifra MAYOR que el saldo de la cuenta, y ese
    // era justo el defecto.
    expect(f.textEs).toContain('USD 222')
    expect(f.textEs).not.toContain('722')
    expect(f.textEs).toContain('USD 500')
    expect(f.textEs).toContain('falta una entrada')
    expect(f.textEs).toContain('sobra una salida')
  })

  it('⛔ NUNCA prellena un aporte: no hay un evento único que corresponda', () => {
    const f = find(r(), 'flows-exceed-balance')
    expect(f.action.kind).toBe('edit-item')
    expect(f.action.prefill).toBeUndefined()
  })

  it('ninguna cifra publicada excede el saldo de la cuenta', () => {
    const f = find(r(), 'flows-exceed-balance')
    // El monto que se nombra es el EXCESO de salidas, un hecho de los propios
    // movimientos, nunca "lo que falta" medido contra el saldo.
    expect(f.textEs).not.toMatch(/faltan aportes/)
  })

  it('un residuo chico no dispara nada (piso compartido)', () => {
    const chico = [
      { id: 'd', type: 'DEPOSIT', _linkedItemId: 'f1', totalAmount: 500, currency: 'USD', date: '2025-02-01' },
      { id: 'w', type: 'WITHDRAWAL', _linkedItemId: 'f1', totalAmount: 520, currency: 'USD', date: '2025-03-01' },
    ]
    const c = codes(run({ currentPrice: 500, dividendYield: 0 }, chico))
    expect(c).not.toContain('flows-exceed-balance')
    expect(c).not.toContain('partial-history')
  })

  it('la historia parcial de verdad se sigue reportando igual que siempre', () => {
    // Saldo 2000 con un solo depósito de 400: 20% explicado, 1600 sin explicar.
    const f = find(run({ currentPrice: 2000, dividendYield: 0 }, [
      { id: 'd', type: 'DEPOSIT', _linkedItemId: 'f1', totalAmount: 400, currency: 'USD', date: '2025-02-01' },
    ]), 'partial-history')
    expect(f.textEs).toContain('20%')
    // El monto de la acción sigue siendo el HUECO que el texto imprime (FASE JH).
    expect(f.action.prefill.amount).toBe(1600)
    expect(f.textEs).toContain('USD 1,600')
  })
})

// ── 4. `no-country` solo donde de verdad se cuenta como EE.UU. ────────────
describe('el aviso de país solo sale cuando su consecuencia es cierta', () => {
  it('una cuenta sin símbolo resuelve a Unknown, no a US', () => {
    expect(getGeographyFromItem({ type: 'Cash', name: 'FONDO LÍQUIDO $' })).toBe('Unknown')
    expect(codes(run({ assetCountry: null }))).not.toContain('no-country')
  })

  it('un inmueble sin símbolo tampoco', () => {
    const r = analyzeDataCompleteness({
      items: [{ id: 'r1', name: '120 street miami', type: 'RealEstate', currency: 'USD', quantity: 1, currentPrice: 90000, acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z', institution: 'X', balanceAsOf: '2026-08-01' }],
      transactions: [], baseCurrency: 'USD', now: NOW,
    })
    expect(getGeographyFromItem({ type: 'RealEstate', name: '120 street miami' })).toBe('Unknown')
    expect(codes(r)).not.toContain('no-country')
  })

  it('un bono con símbolo sintético SÍ cae en el default estadounidense y sigue avisando', () => {
    expect(getGeographyFromItem({ type: 'Bond', symbol: 'VITALI' })).toBe('US')
    const r = analyzeDataCompleteness({
      items: [{ id: 'b1', name: 'VITALI', symbol: 'VITALI', type: 'Bond', currency: 'USD', quantity: 1, currentPrice: 6000, acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z', institution: 'IDC', balanceAsOf: '2026-08-01', _newMoneyConfirmed: true }],
      transactions: [], baseCurrency: 'USD', now: NOW,
    })
    expect(codes(r)).toContain('no-country')
  })

  it('el aviso nunca contradice a la función que resuelve la geografía', () => {
    // Invariante: para todo hallazgo `no-country` emitido, la geografía de ese
    // ítem TIENE que ser 'US'. Es lo que su propio texto afirma.
    const items = [
      { id: 'a', name: 'Cash', type: 'Cash', currency: 'USD', quantity: 1, currentPrice: 5000, institution: 'X', acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z', balanceAsOf: '2026-08-01', _newMoneyConfirmed: true },
      { id: 'b', name: 'VITALI', symbol: 'VITALI', type: 'Bond', currency: 'USD', quantity: 1, currentPrice: 6000, institution: 'X', acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z', balanceAsOf: '2026-08-01', _newMoneyConfirmed: true },
      { id: 'c', name: 'Casa', type: 'RealEstate', currency: 'USD', quantity: 1, currentPrice: 90000, institution: 'X', acquisitionDate: '2025-01-01', createdAt: '2025-01-01T00:00:00.000Z', balanceAsOf: '2026-08-01', _newMoneyConfirmed: true },
    ]
    const byId = new Map(items.map((it) => [it.id, it]))
    const r = analyzeDataCompleteness({ items, transactions: [], baseCurrency: 'USD', now: NOW })
    const flagged = r.findings.filter((f) => f.code === 'no-country')
    expect(flagged.length).toBeGreaterThan(0)
    for (const f of flagged) expect(getGeographyFromItem(byId.get(f.itemId))).toBe('US')
  })
})

// ── 5. Una cuenta bien puesta deja de generar avisos ──────────────────────
describe('el ruido de fondo', () => {
  it('una cuenta líquida completa no produce ningún hallazgo', () => {
    expect(codes(run())).toEqual([])
  })
})
