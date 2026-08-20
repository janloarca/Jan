import { planRecategorize } from '../recategorize'

const tx = (over = {}) => ({
  id: 'x', type: 'EXPENSE', category: 'Otros Gastos', source: 'card_import',
  description: 'SEGUROS UNIVERSALES -M-', ...over,
})

describe('planRecategorize', () => {
  it('rescues the rows a better classifier can now name', () => {
    const plan = planRecategorize([
      tx({ id: '1', description: 'SEGUROS UNIVERSALES -M-' }),
      tx({ id: '2', description: 'DECLARAGUATE - TESORERIA' }),
      tx({ id: '3', description: 'COMISION POR SERVICIOS', kind: 'fee' }),
    ])
    expect(plan.map((p) => [p.id, p.to])).toEqual([
      ['1', 'Seguros'], ['2', 'Impuestos'], ['3', 'Comisiones'],
    ])
  })

  it('leaves a hand-typed transaction alone', () => {
    // No source at all: the user typed it, wording and category included.
    expect(planRecategorize([tx({ source: undefined, _source: undefined })])).toEqual([])
  })

  it('leaves a category the user chose alone, even in the fallback bucket', () => {
    expect(planRecategorize([tx({ _categorySetByUser: true })])).toEqual([])
  })

  it('never overwrites a real category, right or wrong', () => {
    // A row already in a real category is either a good guess or the user's
    // own correction; a fresh guess is not better than either.
    expect(planRecategorize([tx({ category: 'Alimentación', description: 'SEGUROS UNIVERSALES' })])).toEqual([])
  })

  it('reports nothing when the classifier still cannot tell', () => {
    expect(planRecategorize([tx({ description: 'FRIDAS LA ESTACION' })])).toEqual([])
  })

  it('reads an instalment by its merchant, and files a bare contract as financing', () => {
    const plan = planRecategorize([
      tx({ id: 'a', kind: 'installment', description: 'FIN/CT 0013 000001 27' }),
      tx({ id: 'b', kind: 'installment', description: 'ISHOP GUATEMALA NL 01 (22/36)' }),
    ])
    expect(plan.map((p) => [p.id, p.to])).toEqual([['a', 'Financiamiento'], ['b', 'Compras']])
  })

  it('applies rules the user taught the classifier', () => {
    const plan = planRecategorize([tx({ description: 'FRIDAS LA ESTACION' })], {
      rules: [{ match: 'fridas la estacion', category: 'Alimentación' }],
    })
    expect(plan).toEqual([{ id: 'x', from: 'Otros Gastos', to: 'Alimentación', description: 'FRIDAS LA ESTACION' }])
  })

  it('rescues a row whose category is no longer a real one', () => {
    // Defensive: a category dropped from the schema would otherwise be
    // invisible to the breakdown forever.
    const plan = planRecategorize([tx({ category: 'Categoría Vieja', description: 'DECLARAGUATE' })])
    expect(plan).toEqual([{ id: 'x', from: 'Categoría Vieja', to: 'Impuestos', description: 'DECLARAGUATE' }])
  })

  it('leaves income alone: there is no merchant classifier for it', () => {
    expect(planRecategorize([tx({ type: 'INCOME', category: 'Otros Ingresos', description: 'TE DEVUELVE' })])).toEqual([])
  })

  it('skips rows with no id, since there is nothing to update', () => {
    expect(planRecategorize([tx({ id: undefined })])).toEqual([])
  })

  it('an empty plan is a real answer, not a failure', () => {
    expect(planRecategorize([])).toEqual([])
    expect(planRecategorize(null)).toEqual([])
  })
})
