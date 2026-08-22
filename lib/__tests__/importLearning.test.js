import { isTeachableRow, applyCategoryToMatchingRows, learnablesFrom } from '../importLearning'

const row = (desc, over = {}) => ({
  description: desc, merchant: desc, kind: 'purchase',
  category: 'Otros Gastos', type: 'EXPENSE', ...over,
})

describe('qué fila se puede enseñar', () => {
  it('una compra en un comercio, sí', () => {
    expect(isTeachableRow(row('FRIDAS LA ESTACION'))).toBe(true)
  })

  it('lo que el estado ya clasificó por su KIND, no', () => {
    // Su texto no describe un comercio: aprender de ellas ensuciaría la tabla
    // con reglas que nunca vuelven a aplicar.
    for (const kind of ['payment', 'payment-adjustment', 'cashback', 'fee', 'installment']) {
      expect(isTeachableRow(row('GRACIAS POR SU PAGO', { kind }))).toBe(false)
    }
  })

  it('una fila sin comercio legible, no', () => {
    expect(isTeachableRow(row(''))).toBe(false)
    expect(isTeachableRow(null)).toBe(false)
  })
})

describe('corregir una fila arregla las hermanas del mismo comercio', () => {
  // El caso del usuario: FRIDAS aparece varias veces en el estado y corregir
  // una sola dejaba las demás en "Otros Gastos".
  const rows = [
    row('FRIDAS LA ESTACION'),
    row('SUPERMERCADOS LA TORRE', { category: 'Alimentación' }),
    row('FRIDAS LA ESTACION GT'), // misma tienda, cola distinta del banco
    row('CREDITO P/CARGOS BONIFICABLES', { kind: 'cashback', type: 'INCOME', category: 'Promoción de tarjeta' }),
  ]

  it('alcanza a la hermana aunque el banco escriba la cola distinta', () => {
    // merchantRuleKey recorta la cola, que es lo que hace que "FRIDAS LA
    // ESTACION" y "FRIDAS LA ESTACION GT" sean el mismo comercio.
    const { rows: next, changed } = applyCategoryToMatchingRows(rows, 0, 'Alimentación')
    expect(changed).toBe(2)
    expect(next[0].category).toBe('Alimentación')
    expect(next[2].category).toBe('Alimentación')
  })

  it('no toca otro comercio', () => {
    const { rows: next } = applyCategoryToMatchingRows(rows, 0, 'Compras')
    expect(next[1].category).toBe('Alimentación')
  })

  it('no toca una fila que el estado clasificó por su kind', () => {
    const { rows: next } = applyCategoryToMatchingRows(rows, 0, 'Alimentación')
    expect(next[3].category).toBe('Promoción de tarjeta')
  })

  it('respeta una hermana que el usuario ya decidió aparte', () => {
    // Su decisión sobre ESA fila es más específica que la consecuencia de
    // corregir otra.
    const conDecision = rows.map((r, i) => (i === 2 ? { ...r, category: 'Compras', _categorySetByUser: true } : r))
    const { rows: next } = applyCategoryToMatchingRows(conDecision, 0, 'Alimentación')
    expect(next[0].category).toBe('Alimentación')
    expect(next[2].category).toBe('Compras')
  })

  it('marca lo tocado para que Reclasificar nunca lo pise', () => {
    const { rows: next } = applyCategoryToMatchingRows(rows, 0, 'Alimentación')
    expect(next[0]._categorySetByUser).toBe(true)
    expect(next[2]._categorySetByUser).toBe(true)
  })

  it('un índice que no existe no rompe nada', () => {
    const { rows: next, changed } = applyCategoryToMatchingRows(rows, 99, 'Alimentación')
    expect(changed).toBe(0)
    expect(next).toBe(rows)
  })
})

describe('qué se enseña al terminar el import', () => {
  it('una entrada por comercio corregido', () => {
    const rows = [
      row('FRIDAS LA ESTACION', { category: 'Alimentación', _categorySetByUser: true }),
      row('FRIDAS LA ESTACION GT', { category: 'Alimentación', _categorySetByUser: true }),
      row('KRETA', { category: 'Alimentación', _categorySetByUser: true }),
      row('SIN TOCAR'),
    ]
    const out = learnablesFrom(rows)
    expect(out).toHaveLength(2)
    expect(out.map((x) => x.category)).toEqual(['Alimentación', 'Alimentación'])
    expect(out.some((x) => /SIN TOCAR/.test(x.merchant))).toBe(false)
  })

  it('si cambió de opinión, se aprende la última', () => {
    const rows = [
      row('FENIX', { category: 'Compras', _categorySetByUser: true }),
      row('FENIX GT', { category: 'Alimentación', _categorySetByUser: true }),
    ]
    expect(learnablesFrom(rows)).toEqual([{ merchant: 'FENIX GT', category: 'Alimentación' }])
  })

  it('nunca enseña una fila que el KIND clasificó', () => {
    const rows = [row('PAGO POR INTERNET', { kind: 'payment', type: 'INCOME', category: 'Salario', _categorySetByUser: true })]
    expect(learnablesFrom(rows)).toEqual([])
  })

  it('sin correcciones no hay nada que enseñar', () => {
    expect(learnablesFrom([row('A'), row('B')])).toEqual([])
    expect(learnablesFrom(null)).toEqual([])
  })
})
