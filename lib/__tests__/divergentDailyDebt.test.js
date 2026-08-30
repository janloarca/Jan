import { divergentDailyDates, composeDailyTotals } from '@/lib/snapshotBackfill'
import { snapshotAssetsUSD } from '@/lib/assetReturns'

// ⛔ FASE MI. `divergentDailyDates` existe para DESTRUIR docs 'daily', que son
// observaciones escritas en vivo, y solo puede hacerlo cuando se demuestra que
// están corruptos (FASE HO: "evidencia contra evidencia, no una banda
// estadística"). Comparaba la composición (SOLO-ACTIVOS desde FASE LU) contra el
// `netWorthUSD` del doc guardado, o sea dos universos distintos, y la diferencia
// era exactamente la deuda: con una deuda mayor a la tolerancia, TODOS los docs
// salían "corruptos" y la capa de observaciones se perdía entera, todos los días.
describe('la deuda no puede hacer pasar por corrupto a un doc sano', () => {
  const dias = ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
  // El portafolio real del usuario: ~$27,000 en activos con $4,000 de deuda.
  const sanos = dias.map((d) => ({
    date: d, _source: 'daily', netWorthUSD: 23000, totalActivosUSD: 27000, totalDebtUSD: 4000,
  }))
  // La composición es SOLO-ACTIVOS: el caller filtra la deuda antes de pedir la
  // reconstrucción ("Only ASSETS go to portfolio-history").
  const composed = dias.map((d) => ({ date: d, total: 27000, composed: true }))

  it('con deuda viva, un doc que CUADRA no se marca', () => {
    expect(divergentDailyDates(sanos, composed)).toEqual([])
  })

  // La diferencia es la deuda EXACTA, así que cualquier deuda sobre la
  // tolerancia (8%, piso $50) marcaba el 100% de los días.
  it('regresión: leyendo el patrimonio NETO se marcaban los cuatro', () => {
    const comoAntes = (snaps, comp) => (comp || [])
      .filter((c) => c && c.composed && c.total > 0)
      .filter((c) => {
        const s = (snaps || []).find((x) => x.date === c.date)
        if (!s) return false
        const existing = Number(s.netWorthUSD ?? s.totalActivosUSD)
        return Math.abs(existing - c.total) > Math.max(50, c.total * 0.08)
      })
      .map((c) => c.date)
    expect(comoAntes(sanos, composed)).toEqual(dias)
  })

  // Control POSITIVO: sin esto, "no marca nada" podría significar que la función
  // dejó de marcar NUNCA, y el pico de fin de semana de FASE HO volvería.
  it('control: un pico real SÍ se sigue marcando, aun con deuda', () => {
    const conPico = sanos.map((s, i) => (i === 1
      ? { ...s, netWorthUSD: 35000, totalActivosUSD: 39000 }
      : s))
    expect(divergentDailyDates(conPico, composed)).toEqual(['2026-08-26'])
  })

  it('un portafolio SIN deuda se comporta igual que siempre', () => {
    const sinDeuda = dias.map((d) => ({
      date: d, _source: 'daily', netWorthUSD: 27000, totalActivosUSD: 27000, totalDebtUSD: 0,
    }))
    expect(divergentDailyDates(sinDeuda, composed)).toEqual([])
  })

  // Un doc viejo sin noción de deuda cae al respaldo de `snapshotAssetsUSD`, que
  // lee `netWorthUSD`: en una era sin deuda ESE es el total de activos.
  it('un doc viejo sin los campos de deuda se sigue leyendo', () => {
    const viejos = dias.map((d) => ({ date: d, _source: 'daily', netWorthUSD: 27000 }))
    expect(divergentDailyDates(viejos, composed)).toEqual([])
  })

  // Las dos superficies tienen que leer los activos con la MISMA regla, o el
  // arreglo vuelve a abrirse por la puerta de al lado.
  it('la lectura es la compartida de FASE LU/MG', () => {
    expect(snapshotAssetsUSD(sanos[0])).toBe(27000)
  })

  // Las protecciones que ya existían no se movieron.
  it('sigue sin tocar manual, calibraciones, docs por cuenta ni backfill', () => {
    const protegidos = [
      { date: dias[0], _source: 'manual', netWorthUSD: 1, totalActivosUSD: 1, totalDebtUSD: 0 },
      { date: dias[1], _source: 'daily', _calibrated: true, netWorthUSD: 1, totalActivosUSD: 1, totalDebtUSD: 0 },
      { date: dias[2], _source: 'daily', _account: 'U1', netWorthUSD: 1, totalActivosUSD: 1, totalDebtUSD: 0 },
      { date: dias[3], _source: 'backfill', netWorthUSD: 1, totalActivosUSD: 1, totalDebtUSD: 0 },
    ]
    expect(divergentDailyDates(protegidos, composed)).toEqual([])
  })

  // Solo actúa contra una composición que usó NAV real, nunca contra otra
  // reconstrucción que también podría estar equivocada.
  it('sin `composed` no marca nada', () => {
    const estimada = dias.map((d) => ({ date: d, total: 27000, composed: false }))
    expect(divergentDailyDates(sanos, estimada)).toEqual([])
  })
})

// La vara y lo que se escribe tienen que hablar del mismo universo: el caller
// escribe `totalActivosUSD: total`, así que comparar contra ESE campo es lo que
// hace que un doc recién escrito no se marque a sí mismo en la pasada siguiente.
describe('un doc recién compuesto no se marca a sí mismo', () => {
  it('la composición y el doc que produce coinciden', () => {
    const composed = composeDailyTotals({
      gaps: ['2026-08-26'],
      manualPoints: [{ ts: Date.parse('2026-08-26T00:00:00Z'), total: 20000 }],
      navByDate: new Map([['2026-08-26', 7000]]),
      hasBrokerItems: true,
    })
    expect(composed).toHaveLength(1)
    const total = composed[0].total
    // Lo que el caller escribe para ese día, con una deuda viva de 4,000.
    const escrito = {
      date: '2026-08-26', _source: 'daily',
      netWorthUSD: total - 4000, totalActivosUSD: total, totalDebtUSD: 4000,
    }
    expect(divergentDailyDates([escrito], composed)).toEqual([])
  })
})
