import { lateItemsStart, persistedLateStart, lateStartToPersist } from '../ytdAnchor'

// FASE RX: el arranque del audit del 12 nov saltaba entre el doc solo
// ($344,088.20) y el doc + un activo tardio ($1,256.60) segun llegara o no la
// reconstruccion en vivo. Con el valor guardado, las dos cargas dan lo mismo.
const DOC = 344088.2
const late = [{ id: 'casa', symbol: 'CASA', acquisitionDate: '2025-06-01' }]

function arranque({ live, settings }) {
  const persisted = persistedLateStart(settings, '2026-01-02')
  const add = lateItemsStart({ lateItems: late, startByKey: { ...(live || {}), ...persisted } })
  return add ? DOC + add.total : DOC
}

describe('arranque estable con activos tardios', () => {
  it('sin guardar, el arranque depende de si llega la reconstruccion (el bug)', () => {
    expect(arranque({ live: { casa: 1256.6 }, settings: {} })).toBeCloseTo(345344.8, 2)
    expect(arranque({ live: null, settings: {} })).toBeCloseTo(344088.2, 2)
  })

  it('guardado una vez, las dos cargas dan el mismo arranque', () => {
    const toSave = lateStartToPersist({ lateItems: late, startUSDByKey: { casa: 1256.6 } })
    const settings = { _ytdLateStartUSD: { '2026-01-02': toSave } }
    expect(arranque({ live: { casa: 1256.6 }, settings })).toBeCloseTo(345344.8, 2)
    expect(arranque({ live: null, settings })).toBeCloseTo(345344.8, 2)
  })

  it('lo guardado manda sobre una medicion posterior distinta', () => {
    const settings = { _ytdLateStartUSD: { '2026-01-02': { casa: 1256.6 } } }
    expect(arranque({ live: { casa: 1300 }, settings })).toBeCloseTo(345344.8, 2)
  })

  it('no vuelve a guardar lo ya guardado ni un simbolo caido a hold-flat', () => {
    expect(lateStartToPersist({ lateItems: late, startUSDByKey: { casa: 1256.6 }, persisted: { casa: 1256.6 } })).toBeNull()
    expect(lateStartToPersist({ lateItems: late, startUSDByKey: { casa: 1256.6 }, unmeasuredSymbols: ['casa'] })).toBeNull()
    expect(lateStartToPersist({ lateItems: late, startUSDByKey: {} })).toBeNull()
  })

  it('convierte lo guardado a la moneda base y descarta basura', () => {
    const settings = { _ytdLateStartUSD: { '2026-01-02': { casa: 100, roto: 'x' } } }
    expect(persistedLateStart(settings, '2026-01-02', (v) => v * 7.7)).toEqual({ casa: 770 })
    expect(persistedLateStart(settings, '2026-01-01')).toEqual({})
    expect(persistedLateStart(null, '2026-01-02')).toEqual({})
  })
})
