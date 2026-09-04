/**
 * ⛔ FASE NP. El archivo contradiciéndose entre días vecinos.
 *
 * El caso real, con las cifras EXACTAS de la tercera captura del usuario: la
 * gráfica arranca el año en 9,968.11 - 3,945.00 + 3,282.11 = 9,305.22 y rotula
 * "Mayor caída del período -40.3% (1 ene 2026 -> 2 ene 2026)", o sea el día
 * siguiente vale 9,305.22 x (1 - 0.403) = 5,555.2.
 *
 * El MISMO 9,305.22 al centavo que las dos rondas anteriores, con FASE NL y
 * FASE NN ya desplegadas. Las dos exigen NAV real del broker para ese día
 * (`composed`), y sin él `composeDailyTotals` ni siquiera produce una entrada
 * para el 1 de enero: no hay con qué juzgar ni con qué reescribir.
 *
 * Esta prueba no necesita al broker: una caída del 40% de un día para el otro
 * sin que salga un centavo no ocurre.
 */
import {
  selfContradictedCalibrationDates,
  contradictedCalibrationDates,
  divergentDailyDates,
} from '../snapshotBackfill'

const ts = (d) => Date.parse(`${d}T00:00:00Z`)

// El ancla envenenada del caso real y el día que la contradice.
const CAL = { id: '2026-01-01', date: '2026-01-01', netWorthUSD: 9305.22, totalActivosUSD: 9305.22, _calibrated: true, _source: 'manual' }
const NEXT = { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 5555.2, totalActivosUSD: 5555.2, _source: 'daily' }
const PREV = { id: '2025-12-31', date: '2025-12-31', netWorthUSD: 5432.98, totalActivosUSD: 5432.98, _source: 'daily' }

describe('FASE NP: el pico aislado entre dos vecinos que coinciden', () => {
  it('marca el ancla del caso real', () => {
    expect(selfContradictedCalibrationDates([PREV, CAL, NEXT], [])).toEqual(['2026-01-01'])
  })

  it('un ancla que CUADRA con sus vecinos se respeta', () => {
    const ok = { ...CAL, netWorthUSD: 5500, totalActivosUSD: 5500 }
    expect(selfContradictedCalibrationDates([PREV, ok, NEXT], [])).toEqual([])
  })

  it('un DEPÓSITO que explica el salto protege la calibración', () => {
    // 5,432.98 el 31 + 3,900 depositados el 1 = 9,332.98, que es el ancla al
    // 0.3%. Y el vecino posterior tiene que verlo también, o los dos lados
    // discreparían: se deposita antes del 31 -> no. Acá el flujo cae DESPUÉS
    // del ancla, así que el vecino posterior lo descuenta igual.
    const flows = [{ ts: ts('2026-01-01') + 3600000, amount: 3900, type: 'DEPOSIT' }]
    const after = { ...NEXT, netWorthUSD: 9250, totalActivosUSD: 9250 }
    const before = { ...PREV, netWorthUSD: 9300, totalActivosUSD: 9300 }
    expect(selfContradictedCalibrationDates([before, { ...CAL, netWorthUSD: 5400, totalActivosUSD: 5400 }, after], flows)).toEqual([])
  })

  it('un RETIRO que explica la caída protege la calibración', () => {
    // El ancla vale 9,305.22, salen 3,750 ese mismo día, y el 2 de enero vale
    // 5,555.2: el archivo NO se está contradiciendo, se movió dinero.
    const flows = [{ ts: ts('2026-01-01') + 3600000, amount: 3750, type: 'WITHDRAWAL' }]
    expect(selfContradictedCalibrationDates([CAL, NEXT], flows)).toEqual([])
  })

  it('un depósito y un retiro del mismo monto no explican nada', () => {
    // El neto es lo que cuenta: contarlos por separado dejaría pasar el ancla.
    const flows = [
      { ts: ts('2026-01-01') + 3600000, amount: 3750, type: 'WITHDRAWAL' },
      { ts: ts('2026-01-01') + 7200000, amount: 3750, type: 'DEPOSIT' },
    ]
    expect(selfContradictedCalibrationDates([CAL, NEXT], flows)).toEqual(['2026-01-01'])
  })

  it('vecinos que NO coinciden entre sí no dan veredicto', () => {
    // Un cambio REAL de nivel deja a los dos lados en niveles distintos, y ahí
    // no se puede saber de qué lado cae el ancla: es el guard que protege una
    // caída de mercado genuina.
    const before = { ...PREV, netWorthUSD: 9300, totalActivosUSD: 9300 }
    expect(selfContradictedCalibrationDates([before, CAL, NEXT], [])).toEqual([])
  })

  it('con un solo vecino se exige un desvío mucho mayor', () => {
    // La mitad floja: un salto real de un día es indistinguible, así que la
    // banda de 8% no alcanza y se pide 25%.
    const soloDespues = [CAL, NEXT]
    expect(selfContradictedCalibrationDates(soloDespues, [])).toEqual(['2026-01-01'])

    const chico = { ...CAL, netWorthUSD: 6100, totalActivosUSD: 6100 } // +9.8% sobre 5,555
    expect(selfContradictedCalibrationDates([chico, NEXT], [])).toEqual([])
  })

  it('un vecino lejano no cuenta', () => {
    const lejano = { ...NEXT, id: '2026-01-20', date: '2026-01-20' }
    expect(selfContradictedCalibrationDates([CAL, lejano], [])).toEqual([])
  })

  it('un doc de NAV del broker no puede hacer de vecino', () => {
    // Mide UNA cuenta y no el portafolio: compararlos sería mezclar universos.
    const nav = { ...NEXT, _source: 'ibkr' }
    const navQ = { ...PREV, _source: 'ibkr_quarterly' }
    expect(selfContradictedCalibrationDates([navQ, CAL, nav], [])).toEqual([])
  })

  it('nunca juzga una observación real ni una calibración por cuenta', () => {
    const daily = { ...CAL, _calibrated: false, _source: 'daily' }
    expect(selfContradictedCalibrationDates([daily, NEXT], [])).toEqual([])

    const porCuenta = { ...CAL, _account: 'ibkr' }
    expect(selfContradictedCalibrationDates([porCuenta, PREV, NEXT], [])).toEqual([])
  })

  it('sin ninguna observación real no se toca nada', () => {
    expect(selfContradictedCalibrationDates([CAL], [])).toEqual([])
    expect(selfContradictedCalibrationDates(null, null)).toEqual([])
  })
})

describe('FASE NP: por qué hacía falta una función nueva', () => {
  // El control que fija la razón de que exista: si alguien "unifica" esto más
  // adelante creyendo que alguna hermana ya lo cubría, esto falla en vez de
  // pasar en silencio.
  it('contradictedCalibrationDates no puede verla sin NAV del broker', () => {
    // Sin `composed` no hay entrada para el 1 de enero, que es exactamente el
    // caso del usuario: el broker conectado pero sin NAV arrastrable a esa
    // fecha hace que composeDailyTotals SALTE el día.
    const sinComposicion = [{ date: '2026-01-01', total: 5555.2, composed: false }]
    expect(contradictedCalibrationDates([CAL], sinComposicion)).toEqual([])
    expect(contradictedCalibrationDates([CAL], [])).toEqual([])
  })

  it('divergentDailyDates salta lo calibrado a propósito', () => {
    const composed = [{ date: '2026-01-01', total: 5555.2, composed: true }]
    expect(divergentDailyDates([CAL], composed)).toEqual([])
  })
})

// Las tres superficies viven en un efecto, un callback y un memo que jest no
// puede montar sin el dashboard entero, así que se fijan LEYENDO LA FUENTE
// (precedente ibkrImportGate.test.js). Los comentarios se strippean primero:
// los de arriba nombran las funciones que este guardián vigila.
describe('FASE NP: las superficies cableadas', () => {
  const fs = require('fs')
  const path = require('path')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const hook = strip(fs.readFileSync(path.join(__dirname, '../../hooks/useDashboardData.js'), 'utf8'))
  const chart = strip(fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8'))

  // Los dos escritores tocan los MISMOS docs: si uno aplica la regla y el otro
  // no, vuelven a escribir historias distintas (la lección de FASE JU). La
  // aserción es sobre el conjunto que de verdad se REESCRIBE, no sobre que la
  // función se llame: llamarla y tirar el resultado se ve igual desde afuera.
  it('el backfill automático la suma al conjunto que reescribe', () => {
    expect(hook).toMatch(/const contradictedCal = new Set\(\[[\s\S]{0,400}?\.\.\.selfContradictedCalibrationDates\(/)
    expect(hook).toMatch(/\.\.\.contradictedCal/)
  })

  it('"Reparar ahora" la suma al conjunto que reescribe', () => {
    expect(chart).toMatch(/const selfCal = new Set\(selfContradictedCalibrationDates\(/)
    expect(chart).toMatch(/const contradictedCal = new Set\(\[[\s\S]{0,200}?\.\.\.selfCal,/)
    expect(chart).toMatch(/\.\.\.contradictedCal/)
  })

  it('el hook DEJA DE USAR el ancla contradicha, no solo la repara', () => {
    // La mitad que hace que esto sirva cuando la reparación no puede correr.
    expect(hook).toMatch(/const contradictedAnchors = useMemo/)
    expect(hook).toMatch(/contradictedAnchors\.has\(s\.date\)/)
  })

  it('los reparadores leen la lista CRUDA, no la filtrada', () => {
    // Si el backfill leyera `snapshots`, el doc filtrado sería invisible para
    // él y jamás se repararía: la app lo ignoraría para siempre en vez de
    // arreglarlo cuando por fin haya con qué.
    expect(hook).toMatch(/selfContradictedCalibrationDates\(snapshotsAll,/)
    expect(hook).toMatch(/contradictedCalibrationDates\(snapshotsAll,/)
  })

  it('la tarjeta lo dice', () => {
    const card = strip(fs.readFileSync(path.join(__dirname, '../../components/dashboard/NetWorthCard.jsx'), 'utf8'))
    expect(card).toMatch(/ytdAnchorIgnored/)
    expect(hook).toMatch(/ytdAnchorIgnored: contradictedAnchors\.size/)
  })

  it('la lista de flujos tiene UNA sola definición', () => {
    // Dos copias de "cuánto entró" es cómo los dos motores terminan
    // protegiendo rachas distintas sobre los mismos depósitos.
    for (const src of [hook, chart]) expect(src).toMatch(/usdFlowEvents\(/)
    expect(hook).not.toMatch(/DEPOSIT\|WITHDRAWAL/)
  })
})
