import { render, screen } from '@testing-library/react'
import DebtAgingCard from '@/components/finance/DebtAgingCard'
import { buildDebtAging } from '@/lib/debtAging'

// FASE OR. Lo que el usuario vio en su iPad y llamó feo, con su causa:
//
//  1. Los comercios se imprimían en MAYÚSCULAS crudas del banco ("DONALD
//     EXPRESS GT") aunque él YA hubiera escrito que Donald es su mecánico. El
//     dato existía en dos lugares (`tx.userLabel` y `rule.label`) y esta card
//     no consultaba ninguno.
//  2. "Lo más viejo sin pagar lleva N días: X" era el MISMO hecho que la
//     primera fila de la lista que va justo abajo. No por casualidad: el motor
//     devuelve `oldest = outstanding[0]`, la misma referencia.
//  3. La cifra de pagos sin cuadrar repetía la oración entera por grupo.

const charge = (id, card, date, amount, description) => ({
  id, date, type: 'EXPENSE', amount, currency: 'GTQ', cardKey: card,
  description, source: 'card_import', category: 'Otros Gastos',
})
const payment = (id, card, date, amount) => ({
  id, date, type: 'INCOME', amount, currency: 'GTQ', cardKey: card,
  description: 'PAGO RECIBIDO', source: 'card_import', kind: 'payment', category: 'Salario',
})

// El caso de la captura: un cargo viejo sin pagar encabezando la lista.
const TXS = [
  charge('c0', 'gyt:3294', '2026-07-01', 500, 'CARGO PAGADO'),
  charge('c1', 'gyt:3294', '2026-07-25', 2673.6, 'DONALD EXPRESS GT'),
  charge('c2', 'gyt:3294', '2026-07-29', 118.65, 'UBER*EATS GT'),
  payment('p1', 'gyt:3294', '2026-07-10', 500),
]

describe('FASE OR: el rótulo que el usuario escribió gana sobre la cadena del banco', () => {
  it('con una regla enseñada, la fila dice "mecánico" y no "DONALD EXPRESS GT"', () => {
    render(<DebtAgingCard
      transactions={TXS}
      rules={[{ match: 'donald express', category: 'Transporte', label: 'mecánico' }]}
      lang="es"
    />)
    expect(screen.queryByText('mecánico')).toBeTruthy()
    // Regresión NEGATIVA: la cadena cruda del banco ya no se imprime para ese
    // comercio (lo que hacía la card antes de este cambio).
    expect(screen.queryByText('DONALD EXPRESS GT')).toBeNull()
  })

  it('el rótulo de la fila gana sobre el de la regla: es lo último que dijo', () => {
    render(<DebtAgingCard
      transactions={TXS.map((t) => (t.id === 'c1' ? { ...t, userLabel: 'taller de Donald' } : t))}
      rules={[{ match: 'donald express', category: 'Transporte', label: 'mecánico' }]}
      lang="es"
    />)
    expect(screen.queryByText('taller de Donald')).toBeTruthy()
    expect(screen.queryByText('mecánico')).toBeNull()
  })

  it('SIN rótulo se muestra la cadena del banco tal cual, sin transformarla', () => {
    // Control positivo y a la vez la regla dura: ningún `capitalize` de CSS
    // (convierte "iShares" en "IShares") ni title-case de JS (rompe "BAC
    // CREDOMATIC"). Lo único que puede reemplazar la cadena es lo que el
    // usuario escribió.
    const { container } = render(<DebtAgingCard transactions={TXS} rules={[]} lang="es" />)
    expect(screen.queryByText('DONALD EXPRESS GT')).toBeTruthy()
    expect(screen.queryByText('UBER*EATS GT')).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/capitalize/)
  })
})

describe('FASE OR: la lista dice el orden, y el hecho no se imprime dos veces', () => {
  it('la frase de "lo más viejo" ya no está, porque la primera fila ES ese cargo', () => {
    const [g] = buildDebtAging(TXS)
    // El motor lo confirma: no son dos lecturas, es el mismo objeto.
    expect(g.oldest).toBe(g.outstanding[0])

    render(<DebtAgingCard transactions={TXS} lang="es" />)
    expect(screen.queryAllByText(/Lo más viejo sin pagar lleva/).length).toBe(0)
    // Y el hecho NO se perdió: la fila sigue ahí con su monto, que es más de lo
    // que decía la oración.
    expect(screen.queryByText('DONALD EXPRESS GT')).toBeTruthy()
    expect(screen.queryByText('Q2,673.60')).toBeTruthy()
  })

  it('el orden de la lista se DICE, que es lo que nadie decía', () => {
    render(<DebtAgingCard transactions={TXS} lang="es" />)
    expect(screen.queryByText(/del más viejo primero/)).toBeTruthy()
  })

  it('el monto y la edad son columnas propias, no una cadena concatenada', () => {
    // Antes eran un solo span "Q2,673.60 · 55 días" alineado a la derecha, así
    // que los montos no alineaban entre sí. Ahora cada uno es su propia celda.
    render(<DebtAgingCard transactions={TXS} lang="es" />)
    expect(screen.queryByText('Q2,673.60')).toBeTruthy()
    expect(screen.queryAllByText(/^Q2,673\.60 ·/).length).toBe(0)
  })
})

describe('FASE OR: el contexto va en una línea, no en tres párrafos apilados', () => {
  it('promedio, mediana y conteo salen juntos', () => {
    const txs = [
      charge('a', 'bi:9856', '2026-06-01', 100, 'UNO'),
      payment('pa', 'bi:9856', '2026-06-06', 100),
      charge('b', 'bi:9856', '2026-06-01', 900, 'DOS'),
      payment('pb', 'bi:9856', '2026-06-12', 900),
    ]
    render(<DebtAgingCard transactions={txs} lang="es" />)
    const meta = screen.queryByText(/en promedio, sobre 2 gastos pagados/)
    expect(meta).toBeTruthy()
    expect(meta.textContent).toMatch(/ponderado por monto/)
    // La mediana, cuando difiere del promedio, viaja en la MISMA línea en vez
    // de ser un segundo párrafo del mismo tamaño y el mismo gris.
    expect(screen.queryAllByText(/^La mitad se paga en/).length).toBe(0)
  })
})
