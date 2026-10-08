import {
  sanitizeObservations, upsertObservation, removeObservation, findObservation,
  applyObservations, observationGap,
} from '../sheetObservations'

const items = [{ id: 'f1', name: 'Fondo', institution: 'IDC', _category: 'bank', currency: 'USD' }]
const derived = () => ({
  '2026-08': { f1: { value: 5000, symbol: 'Fondo', estimated: false } },
  '2026-09': { f1: { value: 5006, symbol: 'Fondo', estimated: false } },
  '2026-10': { f1: { value: 5020, symbol: 'Fondo', estimated: false } },
})
const opts = { items, baseCurrency: 'USD', convert: (v) => v, currentMonthKey: '2026-10' }

describe('sanitizeObservations', () => {
  it('descarta filas mal formadas y no adivina', () => {
    const out = sanitizeObservations([
      { itemId: 'f1', month: '2026-09', value: 5015, currency: 'usd' },
      { itemId: '', month: '2026-09', value: 1 },
      { itemId: 'f1', month: '2026-13', value: 1 },
      { itemId: 'f1', month: '2026-9', value: 1 },
      { itemId: 'f1', month: '2026-08', value: -5 },
      { itemId: 'f1', month: '2026-08', value: NaN },
      { itemId: 'f1', month: '2026-08', value: 99_999_999 },
      null, 'x',
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ itemId: 'f1', month: '2026-09', value: 5015, currency: 'USD' })
  })
  it('acepta el doc completo o el arreglo, y una sola por (ítem, mes)', () => {
    const rows = [{ itemId: 'f1', month: '2026-09', value: 1 }, { itemId: 'f1', month: '2026-09', value: 2 }]
    expect(sanitizeObservations({ observations: rows })).toHaveLength(1)
    expect(sanitizeObservations(undefined)).toEqual([])
  })
})

describe('upsert / remove', () => {
  it('corregir dos veces el mismo mes REEMPLAZA, no apila', () => {
    let l = upsertObservation([], { itemId: 'f1', month: '2026-09', value: 5015 })
    l = upsertObservation(l, { itemId: 'f1', month: '2026-09', value: 5016 })
    expect(l).toHaveLength(1)
    expect(l[0].value).toBe(5016)
    expect(findObservation(l, 'f1', '2026-09').value).toBe(5016)
  })
  it('una observación inválida no corrompe la lista', () => {
    const l = upsertObservation([{ itemId: 'f1', month: '2026-09', value: 5015 }], { itemId: 'f1', month: '2026-08', value: -1 })
    expect(l).toHaveLength(1)
  })
  it('borrar devuelve a lo derivado', () => {
    const l = upsertObservation([], { itemId: 'f1', month: '2026-09', value: 5015 })
    const after = removeObservation(l, 'f1', '2026-09')
    expect(after).toEqual([])
    expect(applyObservations(derived(), after, opts)['2026-09'].f1.value).toBe(5006)
  })
})

describe('applyObservations', () => {
  it('fija SOLO el mes observado: los vecinos no se mueven (el bug de FASE PZ)', () => {
    const obs = [{ itemId: 'f1', month: '2026-09', value: 5015 }]
    const out = applyObservations(derived(), obs, opts)
    expect(out['2026-09'].f1.value).toBe(5015)
    expect(out['2026-09'].f1.estimated).toBe(false)
    expect(out['2026-08'].f1.value).toBe(5000)
    expect(out['2026-10'].f1.value).toBe(5020)
  })
  it('no muta la entrada', () => {
    const d = derived()
    applyObservations(d, [{ itemId: 'f1', month: '2026-09', value: 5015 }], opts)
    expect(d['2026-09'].f1.value).toBe(5006)
  })
  it('sin observaciones devuelve la MISMA referencia', () => {
    const d = derived()
    expect(applyObservations(d, [], opts)).toBe(d)
    expect(applyObservations(d, undefined, opts)).toBe(d)
  })
  it('el mes en curso lo gobierna la columna viva, no una observación', () => {
    const out = applyObservations(derived(), [{ itemId: 'f1', month: '2026-10', value: 1 }], opts)
    expect(out['2026-10'].f1.value).toBe(5020)
  })
  it('una observación llena un HUECO que la derivación no pudo', () => {
    const d = { '2026-07': {} }
    const out = applyObservations(d, [{ itemId: 'f1', month: '2026-07', value: 4900 }], opts)
    expect(out['2026-07'].f1).toMatchObject({ value: 4900, symbol: 'Fondo', institution: 'IDC' })
  })
  it('convierte a base desde la moneda en que se tecleó', () => {
    const convert = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const out = applyObservations(derived(), [{ itemId: 'f1', month: '2026-09', value: 7700, currency: 'GTQ' }], { ...opts, convert })
    expect(out['2026-09'].f1.value).toBeCloseTo(1000, 6)
  })
  it('un ítem de broker no se corrige a mano (su pasado es el NAV real)', () => {
    const d = derived()
    const ib = [{ id: 'b1', name: 'AAPL', _source: 'ibkr' }]
    expect(applyObservations(d, [{ itemId: 'b1', month: '2026-09', value: 1 }], { ...opts, items: ib })).toBe(d)
  })
  it('una observación de un ítem que ya no existe ni tiene celda se ignora', () => {
    const d = derived()
    expect(applyObservations(d, [{ itemId: 'ghost', month: '2026-09', value: 1 }], opts)).toBe(d)
  })
})

describe('observationGap', () => {
  it('dice cuánto se aparta la derivación', () => {
    expect(observationGap(5006, 5015)).toBe(9)
    expect(observationGap(null, 5015)).toBeNull()
  })
})
