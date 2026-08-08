// FASE FR. corruptSnapshotRunIds: la limpieza de rachas de snapshots diarios
// corruptos (el caso real: ~2 semanas pegadas en ~$35K sobre ~$23K reales,
// escritas antes del fix de FASE FE).

import { corruptSnapshotRunIds, DELETABLE_SNAPSHOT_SOURCES } from '@/lib/corruptSnapshots'

const day = (n) => {
  const d = new Date(Date.UTC(2026, 6, 1 + n)) // 1 jul 2026 + n dias
  return d.toISOString().slice(0, 10)
}
const dayTs = (n) => new Date(`${day(n)}T00:00:00Z`).getTime()

const snap = (n, value, source = 'daily', extra = {}) => ({
  id: day(n), date: day(n), netWorthUSD: value, _source: source, ...extra,
})

// El escenario real: nivel ~21.5K, 14 dias corruptos en ~35.2K, regreso a ~23.2K.
function realScenario() {
  const rows = []
  for (let n = 0; n < 23; n++) rows.push(snap(n, 21500 + n * 30))
  for (let n = 23; n < 37; n++) rows.push(snap(n, 35186.5))
  rows.push(snap(37, 23181.43))
  rows.push(snap(38, 23200))
  return rows
}

describe('el escenario real: meseta de 14 dias inflada que regresa', () => {
  it('detecta exactamente los 14 dias corruptos, nada mas', () => {
    const ids = corruptSnapshotRunIds(realScenario())
    expect(ids).toHaveLength(14)
    expect(ids[0]).toBe(day(23))
    expect(ids[13]).toBe(day(36))
  })

  it('con un deposito real que explica el salto, NO borra nada (dinero estacionado)', () => {
    const flows = [{ ts: dayTs(23), amount: 13000, type: 'DEPOSIT' }]
    expect(corruptSnapshotRunIds(realScenario(), flows)).toHaveLength(0)
  })

  it('un retiro al FINAL de la racha no la "explica": el borde que importa es la entrada', () => {
    // El caso real trae un WITHDRAWAL misterioso justo donde la meseta cae.
    // Si ese flujo contara como explicacion, la limpieza jamas correria.
    const flows = [{ ts: dayTs(37), amount: 12005, type: 'WITHDRAWAL' }]
    expect(corruptSnapshotRunIds(realScenario(), flows)).toHaveLength(14)
  })

  it('un deposito chico (menos de la mitad del salto) no explica el salto', () => {
    const flows = [{ ts: dayTs(23), amount: 2000, type: 'DEPOSIT' }]
    expect(corruptSnapshotRunIds(realScenario(), flows)).toHaveLength(14)
  })
})

describe('protecciones: lo que NUNCA se borra', () => {
  it('un deposito genuino cambia el nivel para siempre: sin round-trip, sin borrado', () => {
    const rows = []
    for (let n = 0; n < 10; n++) rows.push(snap(n, 10000))
    for (let n = 10; n < 30; n++) rows.push(snap(n, 22000)) // nivel nuevo permanente
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('un NAV real de broker dentro de la racha la aborta entera', () => {
    const rows = []
    for (let n = 0; n < 10; n++) rows.push(snap(n, 21500))
    for (let n = 10; n < 15; n++) rows.push(snap(n, 35000))
    rows.push(snap(15, 35100, 'ibkr')) // el broker CONFIRMA el nivel alto
    for (let n = 16; n < 20; n++) rows.push(snap(n, 35000))
    rows.push(snap(20, 22000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('una racha mas larga que maxRunDays no se toca', () => {
    const rows = []
    rows.push(snap(0, 21500))
    for (let n = 1; n < 41; n++) rows.push(snap(n, 35000)) // 40 dias
    rows.push(snap(41, 22000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('una racha que llega al final del archivo (sin punto de regreso) no se toca', () => {
    const rows = []
    for (let n = 0; n < 10; n++) rows.push(snap(n, 21500))
    for (let n = 10; n < 14; n++) rows.push(snap(n, 35000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('snapshots manuales e ibkr_quarterly jamas entran a una racha', () => {
    const rows = []
    for (let n = 0; n < 5; n++) rows.push(snap(n, 21500))
    rows.push(snap(5, 35000, 'manual'))
    rows.push(snap(6, 35000, 'ibkr_quarterly'))
    rows.push(snap(7, 22000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('anclas de calibracion y docs por-cuenta se ignoran por completo', () => {
    const rows = [
      snap(0, 21500),
      snap(1, 90000, 'daily', { _calibrated: true }),
      { id: 'x', date: day(2), netWorthUSD: 90000, _source: 'daily', _account: 'ibkr' },
      snap(3, 21600),
    ]
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })

  it('variacion normal de mercado (dentro de banda) nunca matchea', () => {
    const rows = []
    for (let n = 0; n < 30; n++) rows.push(snap(n, 20000 + Math.sin(n) * 2000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(0)
  })
})

describe('dips hacia abajo: simetrico', () => {
  it('un hueco corrupto hacia abajo sin retiro que lo explique se borra', () => {
    const rows = []
    for (let n = 0; n < 10; n++) rows.push(snap(n, 20000))
    for (let n = 10; n < 13; n++) rows.push(snap(n, 9000))
    for (let n = 13; n < 16; n++) rows.push(snap(n, 20100))
    const ids = corruptSnapshotRunIds(rows)
    expect(ids).toEqual([day(10), day(11), day(12)])
  })

  it('el mismo dip CON retiro real al inicio se respeta', () => {
    const rows = []
    for (let n = 0; n < 10; n++) rows.push(snap(n, 20000))
    for (let n = 10; n < 13; n++) rows.push(snap(n, 9000))
    for (let n = 13; n < 16; n++) rows.push(snap(n, 20100))
    const flows = [{ ts: dayTs(10), amount: 11000, type: 'WITHDRAWAL' }]
    expect(corruptSnapshotRunIds(rows, flows)).toHaveLength(0)
  })
})

describe('bordes', () => {
  it('menos de 3 filas: nada', () => {
    expect(corruptSnapshotRunIds([snap(0, 100), snap(1, 500)])).toHaveLength(0)
    expect(corruptSnapshotRunIds([])).toHaveLength(0)
    expect(corruptSnapshotRunIds(null)).toHaveLength(0)
  })

  it('las fuentes borrables son solo daily y backfill', () => {
    expect(DELETABLE_SNAPSHOT_SOURCES).toEqual(['daily', 'backfill'])
  })

  it('una racha backfill corrupta tambien se detecta', () => {
    const rows = []
    for (let n = 0; n < 6; n++) rows.push(snap(n, 21500))
    for (let n = 6; n < 9; n++) rows.push(snap(n, 35000, 'backfill'))
    rows.push(snap(9, 22000))
    expect(corruptSnapshotRunIds(rows)).toHaveLength(3)
  })
})
