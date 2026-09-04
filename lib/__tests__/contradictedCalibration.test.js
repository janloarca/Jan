/**
 * FASE NL. Una calibración GLOBAL que la composición autoritativa contradice.
 *
 * El caso real, reportado con captura: la tarjeta decía
 * `YTD -$3,217.57 (-26.10%) · calibrated` sobre un año que de verdad iba
 * +$654. Despejando el ancla del Dietz con los números de esa captura
 * (patrimonio 10,032.65, flujos 3,945) sale 9,305.22, cuando el NAV que el
 * propio broker reporta para diciembre es 5,432.98: el arranque del año
 * estaba inflado ~$3,872, casi exactamente los depósitos del año, que es la
 * firma del doble conteo.
 *
 * Ese doc era INMORTAL: `CalibrateReturnModal` escribe la calibración con
 * `_source: 'manual'`, y eso la disfraza de transcripción del usuario ante los
 * tres mecanismos de reparación (staleBackfillDates le da el rango más alto,
 * divergentDailyDates salta `_calibrated`, y el guard de FASE JW solo impide
 * PISAR un día que ya tiene dato). La promesa que el propio modal imprime
 * ("si después importas el historial real, esos datos reemplazan la
 * calibración automáticamente") se cumplía del lado del escritor y nunca del
 * lado del archivo.
 */
import {
  contradictedCalibrationDates,
  divergentDailyDates,
  staleBackfillDates,
  CLEARED_CALIBRATION_FIELDS,
} from '../snapshotBackfill'

// La composición del 1 de enero con el NAV REAL del broker de diciembre
// arrastrado al feriado (FASE HI) más la reconstrucción de lo manual.
const composed = [
  { date: '2026-01-01', total: 5567.32, composed: true },
  { date: '2026-01-02', total: 5580.10, composed: true },
]

const calibration = (value, extra = {}) => ({
  date: '2026-01-01',
  netWorthUSD: value,
  totalActivosUSD: value,
  _source: 'manual',
  _calibrated: true,
  _calibrationKind: 'ytd',
  ...extra,
})

describe('FASE NL: la calibración que el broker contradice', () => {
  it('marca el ancla inflada del caso real', () => {
    // 9,305.22 contra una composición de 5,567.32 respaldada por el NAV del
    // broker: el portafolio no pudo valer eso el 1 de enero.
    expect(contradictedCalibrationDates([calibration(9305.22)], composed)).toEqual(['2026-01-01'])
  })

  it('una calibración que CUADRA con el broker se respeta', () => {
    expect(contradictedCalibrationDates([calibration(5560)], composed)).toEqual([])
  })

  it('sin NAV real del broker no se toca nada', () => {
    // La razón de existir de una calibración es justamente que ese día no
    // había con qué medir. Juzgarla contra una reconstrucción que también
    // podría estar equivocada sería cambiar una estimación por otra.
    const soloEstimado = [{ date: '2026-01-01', total: 5567.32, composed: false }]
    expect(contradictedCalibrationDates([calibration(9305.22)], soloEstimado)).toEqual([])
  })

  it('un ancla POR CUENTA no se juzga contra el portafolio completo', () => {
    // Vive en su propio id compuesto y mide UNA cuenta: compararla contra la
    // composición del portafolio entero sería comparar universos distintos
    // (la lección de FASE MI).
    const porCuenta = [calibration(9305.22, { _account: 'ibkr', _accountName: 'Interactive Brokers' })]
    expect(contradictedCalibrationDates(porCuenta, composed)).toEqual([])
  })

  it('una diferencia chica en dólares no dispara reescritura', () => {
    expect(contradictedCalibrationDates([calibration(5610)], composed)).toEqual([])
  })

  it('no toca un doc que NO es calibración', () => {
    // De esos se ocupa divergentDailyDates, con su propia regla.
    const daily = [{ date: '2026-01-01', _source: 'daily', netWorthUSD: 9305.22 }]
    expect(contradictedCalibrationDates(daily, composed)).toEqual([])
  })

  it('sin ninguna calibración en el archivo no hace nada', () => {
    expect(contradictedCalibrationDates([], composed)).toEqual([])
    expect(contradictedCalibrationDates(null, composed)).toEqual([])
  })
})

describe('FASE NL: por qué hacía falta una función nueva', () => {
  // Los tres guardianes que YA existían y que, cada uno por su razón, dejaban
  // pasar este doc. Fijarlos acá es lo que impide "unificar" esto más adelante
  // creyendo que alguno ya lo cubría.
  it('divergentDailyDates lo salta a propósito: solo juzga docs daily', () => {
    expect(divergentDailyDates([calibration(9305.22)], composed)).toEqual([])
  })

  it('staleBackfillDates no lo cuenta como hueco: su _source es manual', () => {
    const gaps = staleBackfillDates([calibration(9305.22)], {
      windowDays: 366,
      todayMs: new Date('2026-09-04T12:00:00Z').getTime(),
    })
    expect(gaps).not.toContain('2026-01-01')
  })

  it('al reescribir se APAGAN las marcas de calibración', () => {
    // saveSnapshot FUSIONA: sin esto el doc quedaría con el valor bueno y
    // todavía badgeado como calibrado, y la insignia de la tarjeta seguiría
    // afirmando algo que dejó de ser cierto.
    expect(CLEARED_CALIBRATION_FIELDS._calibrated).toBe(false)
    expect(CLEARED_CALIBRATION_FIELDS._calibrationKind).toBeNull()
    expect(CLEARED_CALIBRATION_FIELDS._calibratedAt).toBeNull()
    // Firestore rechaza `undefined`: los tres tienen que ser valores escribibles.
    for (const v of Object.values(CLEARED_CALIBRATION_FIELDS)) {
      expect(v).not.toBeUndefined()
    }
  })
})

// Los dos escritores del historial (el backfill automático y "Reparar ahora")
// escriben los MISMOS docs, así que tienen que aplicar la MISMA regla o
// volverían a escribir historias distintas (la lección de FASE JU). Viven en
// un efecto y en un callback que jest no puede montar sin el dashboard entero,
// así que se fijan LEYENDO LA FUENTE: precedente ibkrImportGate.test.js.
describe('FASE NL: las dos superficies que reescriben el historial', () => {
  const fs = require('fs')
  const path = require('path')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const hook = strip(fs.readFileSync(path.join(__dirname, '../../hooks/useDashboardData.js'), 'utf8'))
  const chart = strip(fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8'))

  for (const [name, src] of [['el backfill automático', hook], ['"Reparar ahora"', chart]]) {
    it(`${name} marca las calibraciones contradichas`, () => {
      expect(src).toMatch(/contradictedCalibrationDates\(/)
    })

    it(`${name} las suma al conjunto que reescribe`, () => {
      expect(src).toMatch(/\.\.\.contradictedCal/)
    })

    it(`${name} APAGA las marcas de calibración al reescribir`, () => {
      // saveSnapshot fusiona: sin esto el doc queda con el valor bueno y la
      // insignia "calibrado" encima, afirmando algo que dejó de ser cierto.
      expect(src).toMatch(/contradictedCal\.has\(f\.date\)\s*\?\s*CLEARED_CALIBRATION_FIELDS/)
    })
  }
})
