// FASE FT. stripStaleIbkrEntries: la protección contra el doble conteo que el
// usuario detectó en el Spreadsheet (bucket sintético de FASE FH sumándose
// ENCIMA de las acciones por-item cacheadas bajo la lógica vieja).

import { stripStaleIbkrEntries } from '@/lib/spreadsheetSanitize'

const PREFIX = '__ibkr_unknown__'
const bucketKey = `${PREFIX}Interactive Brokers__stocks`

describe('el caso real: bucket + residuo por-accion del mismo broker', () => {
  const poisoned = {
    [bucketKey]: { value: 10010, category: 'stocks', institution: 'Interactive Brokers', _syntheticIbkr: true },
    'ibkr-item-1': { value: 5000, category: 'stocks' },
    'ibkr-item-2': { value: 4662, category: 'stocks' },
    'vitali': { value: 6000, category: 'bonds' },
  }
  const ibkrIds = new Set(['ibkr-item-1', 'ibkr-item-2'])

  it('quita las entradas por-item de IBKR y deja el bucket y lo manual', () => {
    const out = stripStaleIbkrEntries(poisoned, ibkrIds, PREFIX)
    expect(Object.keys(out).sort()).toEqual([bucketKey, 'vitali'].sort())
    expect(out[bucketKey].value).toBe(10010)
    expect(out.vitali.value).toBe(6000)
  })

  it('la suma de la categoria vuelve al valor real (10,010, no 19,672)', () => {
    const out = stripStaleIbkrEntries(poisoned, ibkrIds, PREFIX)
    const stocksTotal = Object.values(out).filter((v) => v.category === 'stocks').reduce((s, v) => s + v.value, 0)
    expect(stocksTotal).toBe(10010)
  })
})

describe('cuando NO hay nada que sanear, el objeto queda intacto (misma referencia)', () => {
  it('mes sin bucket (doc puramente pre-FH): se respeta el desglose por-accion', () => {
    const preFH = { 'ibkr-item-1': { value: 5000 }, 'ibkr-item-2': { value: 4662 } }
    const out = stripStaleIbkrEntries(preFH, new Set(['ibkr-item-1', 'ibkr-item-2']), PREFIX)
    expect(out).toBe(preFH)
  })

  it('bucket presente pero sin ids de IBKR actuales: nada que quitar', () => {
    const entries = { [bucketKey]: { value: 100 }, 'manual-1': { value: 50 } }
    expect(stripStaleIbkrEntries(entries, new Set(), PREFIX)).toBe(entries)
    expect(stripStaleIbkrEntries(entries, null, PREFIX)).toBe(entries)
  })

  it('bucket presente, ids que no aparecen en el mes: misma referencia', () => {
    const entries = { [bucketKey]: { value: 100 }, 'manual-1': { value: 50 } }
    expect(stripStaleIbkrEntries(entries, new Set(['otro-id']), PREFIX)).toBe(entries)
  })

  it('items manuales jamas se tocan aunque haya bucket', () => {
    const entries = { [bucketKey]: { value: 100 }, 'vitali': { value: 6000 } }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-item-1']), PREFIX)
    expect(out.vitali.value).toBe(6000)
  })
})

describe('bordes', () => {
  it('entries null/undefined o sin prefijo: pasan tal cual', () => {
    expect(stripStaleIbkrEntries(null, new Set(['x']), PREFIX)).toBeNull()
    expect(stripStaleIbkrEntries(undefined, new Set(['x']), PREFIX)).toBeUndefined()
    const e = { a: { value: 1 } }
    expect(stripStaleIbkrEntries(e, new Set(['a']), '')).toBe(e)
  })

  it('acepta array de ids ademas de Set', () => {
    const entries = { [bucketKey]: { value: 100 }, 'ibkr-item-1': { value: 50 } }
    const out = stripStaleIbkrEntries(entries, ['ibkr-item-1'], PREFIX)
    expect(Object.keys(out)).toEqual([bucketKey])
  })

  it('varios buckets (dos categorias del mismo broker) cuentan como bucket presente', () => {
    const entries = {
      [`${PREFIX}Interactive Brokers__stocks`]: { value: 100 },
      [`${PREFIX}Interactive Brokers__crypto`]: { value: 20 },
      'ibkr-item-1': { value: 50 },
    }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-item-1']), PREFIX)
    expect(Object.keys(out).sort()).toEqual([
      `${PREFIX}Interactive Brokers__crypto`,
      `${PREFIX}Interactive Brokers__stocks`,
    ].sort())
  })
})

// ── FASE NJ ────────────────────────────────────────────────────────────────
// Desde FASE NJ una posición de IBKR CON ledger de trades se reconstruye por
// posición, así que un mes puede traer legítimamente el bucket Y filas por item
// del MISMO broker. La regla vieja ("si hay bucket, ninguna fila por item de
// IBKR es válida") borraba justo las reconstruidas: el guard contra el doble
// conteo se llevaba por delante lo que aquella fase vino a mostrar.
//
// `_covers` es lo que lo distingue: dice QUÉ ids explica ese bucket. Un bucket
// viejo no lo trae, y ahí se conserva la regla de siempre.
describe('FASE NJ: buckets que declaran a quién cubren', () => {
  it('conserva las filas por item que el bucket NO dice cubrir', () => {
    const entries = {
      [bucketKey]: { value: 300, _covers: ['ibkr-cash'] },
      'ibkr-cash': { value: 300 },
      'ibkr-aaa': { value: 1000 },
      'ibkr-bbb': { value: 500 },
    }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-cash', 'ibkr-aaa', 'ibkr-bbb']), PREFIX)
    expect(Object.keys(out).sort()).toEqual([bucketKey, 'ibkr-aaa', 'ibkr-bbb'].sort())
  })

  it('un bucket que no cubre a nadie no toca ninguna fila', () => {
    const entries = {
      [bucketKey]: { value: 0, _covers: [] },
      'ibkr-aaa': { value: 1000 },
    }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-aaa']), PREFIX)
    expect(out).toBe(entries)
  })

  it('un bucket VIEJO (sin _covers) conserva la regla de siempre', () => {
    const entries = {
      [bucketKey]: { value: 1500 },
      'ibkr-aaa': { value: 1000 },
    }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-aaa']), PREFIX)
    expect(Object.keys(out)).toEqual([bucketKey])
  })

  it('mezclando bucket viejo y nuevo manda la union, que es el lado conservador', () => {
    const entries = {
      [`${PREFIX}Interactive Brokers__stocks`]: { value: 100, _covers: ['ibkr-aaa'] },
      [`${PREFIX}Interactive Brokers__crypto`]: { value: 20 },
      'ibkr-aaa': { value: 1000 },
      'ibkr-bbb': { value: 500 },
    }
    const out = stripStaleIbkrEntries(entries, new Set(['ibkr-aaa', 'ibkr-bbb']), PREFIX)
    expect(Object.keys(out).sort()).toEqual([
      `${PREFIX}Interactive Brokers__crypto`,
      `${PREFIX}Interactive Brokers__stocks`,
    ].sort())
  })
})
