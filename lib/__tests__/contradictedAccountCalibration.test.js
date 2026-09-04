/**
 * ⛔ FASE NN. Una calibración POR CUENTA que el NAV real del broker contradice.
 *
 * El caso real, con las cifras EXACTAS de la captura del usuario: la tarjeta
 * decía `YTD -$3,296.15 (-26.73%) · calibrado` sobre un patrimonio de
 * $9,954.07 con $3,945.00 de aportes en el año. Despejando el ancla del Dietz:
 *
 *     arranque = 9,954.07 - 3,945.00 + 3,296.15 = 9,305.22
 *
 * El MISMO 9,305.22 que la ronda anterior, al centavo, aunque FASE NL ya había
 * desplegado su reparación: la firma de un valor que se COMPUTA en vivo desde
 * un porcentaje guardado, no de un doc que un backfill pueda tocar.
 *
 * Y la Hoja del propio usuario muestra el NAV real del broker para diciembre:
 * 5,432.98. Con la composición al 100% en acciones de IBKR, ese es el arranque
 * verdadero, así que el año real es +$576 y no -$3,296.
 *
 * Por qué FASE NL no lo tocó: aquella función salta las calibraciones con
 * `_account` a propósito, con una razón que resultó FALSA ("no hay evidencia
 * en el archivo con la que juzgarla sola"). El NAV del broker ES esa
 * evidencia, y también es por cuenta.
 */
import {
  contradictedAccountCalibrations,
  contradictedCalibrationDates,
} from '../snapshotBackfill'

// El NAV real que la Hoja del usuario muestra para diciembre. El 1 de enero es
// feriado de mercado, así que su NAV es el cierre del 31 (arrastre de FASE HI).
const brokerNav = [
  { date: '2025-12-30', _source: 'ibkr', netWorthUSD: 5209.98 },
  { date: '2025-12-31', _source: 'ibkr', netWorthUSD: 5432.98 },
]

const cal = (value, extra = {}) => ({
  id: `cal-${value}`,
  date: '2026-01-01',
  netWorthUSD: value,
  _account: 'ibkr',
  _calibrated: true,
  _calibrationKind: 'ytd',
  ...extra,
})

describe('FASE NN: la calibración por cuenta que el broker contradice', () => {
  it('marca la calibración inflada del caso real', () => {
    // 9,305.22 despejado contra 5,432.98 reportados por el broker: la cuenta
    // no pudo valer eso el 1 de enero.
    const bad = cal(9305.22)
    expect(contradictedAccountCalibrations([bad], brokerNav)).toEqual([bad])
  })

  it('una calibración que CUADRA con el NAV del broker se respeta', () => {
    expect(contradictedAccountCalibrations([cal(5450)], brokerNav)).toEqual([])
  })

  it('usa el cierre arrastrado: el 1 de enero es feriado y no tiene NAV propio', () => {
    // Sin arrastre no habría con qué comparar y la calibración envenenada
    // seguiría aplicándose, que es exactamente el defecto.
    const soloDic31 = [{ date: '2025-12-31', _source: 'ibkr', netWorthUSD: 5432.98 }]
    expect(contradictedAccountCalibrations([cal(9305.22)], soloDic31)).toHaveLength(1)
  })

  it('sin NAV dentro del tope de arrastre no se juzga NADA', () => {
    // Un NAV de hace dos semanas puede diferir legítimamente más que la banda:
    // ahí la prueba dejaría de significar algo, así que la calibración se queda.
    const viejo = [{ date: '2025-12-01', _source: 'ibkr', netWorthUSD: 5432.98 }]
    expect(contradictedAccountCalibrations([cal(9305.22)], viejo)).toEqual([])
  })

  it('una cuenta MANUAL no se juzga: no hay segunda medición', () => {
    const manual = cal(9305.22, { _account: 'idc' })
    expect(contradictedAccountCalibrations([manual], brokerNav)).toEqual([])
  })

  it('sin ningún NAV de broker no se toca nada', () => {
    expect(contradictedAccountCalibrations([cal(9305.22)], [])).toEqual([])
    expect(contradictedAccountCalibrations([cal(9305.22)], null)).toEqual([])
  })

  it('una diferencia chica no dispara', () => {
    // Misma banda que su hermana: 8% con piso de $50.
    expect(contradictedAccountCalibrations([cal(5600)], brokerNav)).toEqual([])
  })

  it('ignora lo que no es una calibración por cuenta', () => {
    const global = { date: '2026-01-01', netWorthUSD: 9305.22, _calibrated: true }
    const sinValor = cal(0)
    expect(contradictedAccountCalibrations([global, sinValor], brokerNav)).toEqual([])
  })
})

describe('FASE NN: por qué la función de FASE NL no podía verla', () => {
  // El control que fija la razón de que exista una función nueva: si alguien
  // "unifica" esto más adelante creyendo que la hermana ya lo cubría, esto
  // falla en vez de pasar en silencio.
  it('contradictedCalibrationDates la salta: solo juzga calibraciones GLOBALES', () => {
    const composed = [{ date: '2026-01-01', total: 5432.98, composed: true }]
    expect(contradictedCalibrationDates([cal(9305.22)], composed)).toEqual([])
  })
})
