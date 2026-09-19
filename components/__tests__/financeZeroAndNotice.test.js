import { render, screen } from '@testing-library/react'
import PnlStatement from '@/components/finance/PnlStatement'
import DebtAgingCard from '@/components/finance/DebtAgingCard'
import RecurringChargesCard from '@/components/finance/RecurringChargesCard'
import { computeMonthlyAnalysis } from '@/lib/financeMonth'
import { buildPnlStatement } from '@/lib/financePnl'
import { resolveCategoryModel } from '@/lib/financeCategoryModel'

// FASE OQ. Tres defectos que solo se ven en la superficie:
//
//  1. El renglón final pintaba el CERO EXACTO con el verde de una ganancia.
//  2. El aviso de "pagos que no cuadran" vivía DENTRO del bucle por tarjeta, así
//     que con dos tarjetas y dos monedas se imprimía hasta cuatro veces la misma
//     oración de treinta palabras.
//  3. La detección de recurrencia corría tres veces por render; ahora la página
//     la hace UNA vez y la pasa. El test exige que el prop de verdad MANDE.

const MODEL = resolveCategoryModel(null)
const ID = (v) => v

const pnlFor = (txs) => buildPnlStatement(computeMonthlyAnalysis(txs, { month: 6, year: 2026 }, ID), MODEL)

const NEUTRAL = 'var(--text-primary)'
const GREEN = 'var(--accent-green)'
const RED = 'var(--text-negative)'

function bottomColor(container, text) {
  // El renglón final es el único con la clase de texto en negrita y fuente mono.
  const el = [...container.querySelectorAll('span')].find(
    (s) => s.className.includes('font-bold') && s.className.includes('tabular-nums') && s.textContent.includes(text)
  )
  return el?.style?.color || null
}

describe('FASE OQ: el cero exacto se pinta en tinta normal', () => {
  it('un mes que cierra en cero NO usa el verde de una ganancia', () => {
    const { container } = render(<PnlStatement pnl={pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 1000, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 1000, currency: 'GTQ' },
    ])} lang="es" />)
    const color = bottomColor(container, 'Q0.00')
    expect(color).toBe(NEUTRAL)
    expect(color).not.toBe(GREEN)
  })

  it('un superávit sigue en verde y un déficit en rojo (control positivo)', () => {
    const sup = render(<PnlStatement pnl={pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 1000, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 400, currency: 'GTQ' },
    ])} lang="es" />)
    expect(bottomColor(sup.container, 'Q600.00')).toBe(GREEN)

    const def = render(<PnlStatement pnl={pnlFor([
      { id: 'i', date: '2026-07-01', type: 'INCOME', category: 'Salario', amount: 400, currency: 'GTQ' },
      { id: 'e', date: '2026-07-02', type: 'EXPENSE', category: 'Alimentación', amount: 1000, currency: 'GTQ' },
    ])} lang="es" />)
    // Un negativo se imprime en paréntesis contables (FASE FK).
    expect(bottomColor(def.container, '(Q600.00)')).toBe(RED)
  })
})

describe('FASE OQ: la explicación de los pagos sin cuadrar se dice UNA vez', () => {
  // Dos tarjetas, y una de ellas con dos monedas: cuatro grupos, cuatro cifras
  // sin cuadrar. Es el caso real de quien importa BI y G&T con gastos en
  // quetzales y en dólares.
  const charge = (id, card, cur, date, amount) => ({
    id, date, type: 'EXPENSE', amount, currency: cur, cardKey: card,
    description: `Compra ${id}`, source: 'card_import', category: 'Otros Gastos',
  })
  const payment = (id, card, cur, date, amount) => ({
    id, date, type: 'INCOME', amount, currency: cur, cardKey: card,
    description: 'PAGO RECIBIDO', source: 'card_import', kind: 'payment', category: 'Salario',
  })

  const txs = [
    charge('c1', 'bi:9856', 'GTQ', '2026-06-10', 100),
    payment('p1', 'bi:9856', 'GTQ', '2026-06-20', 900),
    charge('c2', 'bi:9856', 'USD', '2026-06-11', 10),
    payment('p2', 'bi:9856', 'USD', '2026-06-21', 90),
    charge('c3', 'gyt:1234', 'GTQ', '2026-06-12', 50),
    payment('p3', 'gyt:1234', 'GTQ', '2026-06-22', 550),
  ]

  it('la oración aparece exactamente una vez con cuatro grupos afectados', () => {
    render(<DebtAgingCard transactions={txs} lang="es" />)
    const explain = screen.queryAllByText(/cubre consumos de un mes que todavía no has importado/)
    // Regresión NEGATIVA: vivía dentro del bucle, así que salía una vez por grupo.
    expect(explain.length).toBe(1)
  })

  it('pero cada grupo conserva SU cifra, que es por tarjeta y por moneda', () => {
    render(<DebtAgingCard transactions={txs} lang="es" />)
    // El texto de la cifra cambió de oración a RÓTULO en FASE OR (repetir la
    // oración entera por grupo seguía leyéndose como el mismo párrafo cuatro
    // veces). Lo que este test fija NO es la redacción sino el invariante: la
    // cifra sigue siendo por tarjeta y por moneda, y jamás se suma entre monedas.
    const amounts = screen.queryAllByText(/en pagos sin cargo asociado/)
    expect(amounts.length).toBeGreaterThan(1)
    // Y nunca se suman entre monedas: el quetzal y el dólar salen por separado.
    const joined = amounts.map((n) => n.textContent).join(' | ')
    expect(joined).toMatch(/Q/)
    expect(joined).toMatch(/\$/)
  })

  it('sin ningún pago sin cuadrar no se imprime la explicación', () => {
    render(<DebtAgingCard transactions={[
      charge('c1', 'bi:9856', 'GTQ', '2026-06-10', 100),
      payment('p1', 'bi:9856', 'GTQ', '2026-06-20', 100),
    ]} lang="es" />)
    expect(screen.queryAllByText(/cubre consumos de un mes/).length).toBe(0)
  })
})

describe('FASE OQ: el prop `recurring` manda sobre la detección propia', () => {
  it('la card usa lo que la página le pasa, no lo que ella detectaría', () => {
    // Un `recurring` fabricado que las transacciones (vacías) jamás producirían:
    // si la card lo dibuja, es porque usó el prop y no volvió a detectar.
    render(<RecurringChargesCard
      transactions={[]}
      recurring={{
        monthly: [{ key: 'spotify', label: 'SPOTIFY', currency: 'GTQ', latestAmount: 54.99, expectedDay: 12 }],
        totalMonthlyGtq: 54.99,
        longCadence: [],
      }}
      lang="es"
    />)
    expect(screen.getByText('SPOTIFY')).toBeTruthy()
  })

  it('sin el prop sigue detectando sola (se monta independiente)', () => {
    const { container } = render(<RecurringChargesCard transactions={[]} lang="es" />)
    // Sin nómina la card no se dibuja, que es su contrato de siempre.
    expect(container.textContent).toBe('')
  })
})
