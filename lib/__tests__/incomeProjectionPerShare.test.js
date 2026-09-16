// FASE OC. La proyección anual de un activo con dividendo POR ACCIÓN tiene que
// decir lo mismo que el motor de pagos escribe: una acción de 100 unidades con
// dividendo trimestral de 0.83 por acción cobra 83 por pago (332 al año). La
// card de Ingresos Pasivos, el "Ingreso anual est." y los correos proyectaban
// 3.32, o sea leían `incomeAmount` como si fuera el pago entero, mientras el
// motor (`monthlyIncomeAmount` con `isPerShare`) multiplicaba por la cantidad.
import fs from 'fs'
import path from 'path'
import { projectItemAnnualIncome, getEffectiveYield, isPerShareIncome } from '../../components/dashboard/utils'
import { monthlyIncomeAmount } from '../incomeSchedule'

const stock = { type: 'Stock', symbol: 'T', quantity: 100, purchasePrice: 50, incomeAmount: 0.83, incomeMonths: [1, 4, 7, 10] }
const bond = { type: 'Bond', symbol: 'VITALI', quantity: 1, purchasePrice: 6000, incomeAmount: 240, incomeMonths: [4, 11] }

function engineAnnual(it) {
  const balance = it.quantity * it.purchasePrice
  const per = monthlyIncomeAmount({
    balance, qty: it.quantity, isPerShare: isPerShareIncome(it),
    incomeAmount: it.incomeAmount, incomeMonths: it.incomeMonths, incomePayDay: 1,
  }, it.incomeMonths.length)
  return per * it.incomeMonths.length
}

describe('FASE OC: proyección anual por acción', () => {
  test('el caso real: 100 acciones x 0.83 trimestral proyectan 332, no 3.32', () => {
    const annual = projectItemAnnualIncome(stock, 5000)
    expect(annual).toBeCloseTo(332, 6)
    expect(annual).not.toBeCloseTo(3.32, 6)
  })

  test('la proyección es EXACTAMENTE lo que el motor paga en el año (acción y bono)', () => {
    expect(projectItemAnnualIncome(stock, 5000)).toBeCloseTo(engineAnnual(stock), 6)
    expect(projectItemAnnualIncome(bond, 6000)).toBeCloseTo(engineAnnual(bond), 6)
  })

  test('regresión negativa: un bono con cupón fijo NO se multiplica por su cantidad', () => {
    // 240 x 2 pagos = 480, con cantidad 1 o con la cantidad 5 heredada de FASE OA.
    expect(projectItemAnnualIncome(bond, 6000)).toBe(480)
    expect(projectItemAnnualIncome({ ...bond, quantity: 5 }, 30000)).toBe(480)
  })

  test('un ETF, un fondo y una cripto también van por acción; banco y alternativo no', () => {
    expect(isPerShareIncome({ type: 'ETF' })).toBe(true)
    expect(isPerShareIncome({ type: 'Fund' })).toBe(true)
    expect(isPerShareIncome({ type: 'Crypto' })).toBe(true)
    expect(isPerShareIncome({ type: 'Bank' })).toBe(false)
    expect(isPerShareIncome({ type: 'Alternative' })).toBe(false)
    expect(isPerShareIncome({})).toBe(false)
  })

  test('el rendimiento efectivo de una acción sin dividendYield sale del pago real, no del pago por acción', () => {
    // 332 / 5000 = 6.64%; el bug daba 0.0664%.
    expect(getEffectiveYield(stock)).toBeCloseTo(6.64, 6)
    expect(getEffectiveYield(bond)).toBeCloseTo(8, 6)
  })

  test('sin cantidad, el monto por acción cuenta como una unidad (mismo respaldo que el motor)', () => {
    const noQty = { ...stock, quantity: undefined }
    expect(projectItemAnnualIncome(noQty, 50)).toBeCloseTo(3.32, 6)
  })
})

describe('FASE OC: guardián de fuente, un solo predicado para motor y proyección', () => {
  const hook = fs.readFileSync(path.join(__dirname, '../../hooks/useDashboardData.js'), 'utf8')
  const utils = fs.readFileSync(path.join(__dirname, '../../components/dashboard/utils.js'), 'utf8')

  test('el motor de pagos pide isPerShare al helper compartido, no a un regex propio', () => {
    expect(hook).toMatch(/isPerShare:\s*isPerShareIncome\(it\)/)
    // La copia vieja: si vuelve, motor y card pueden divergir sobre el mismo activo.
    expect(hook).not.toMatch(/isPerShare:\s*\/stock\|etf\|fund\|crypto\/i/)
  })

  test('la proyección y el rendimiento efectivo usan el mismo helper', () => {
    const fn = (name) => {
      const i = utils.indexOf(`export function ${name}(`)
      expect(i).toBeGreaterThan(-1)
      return utils.slice(i, utils.indexOf('\nexport function', i + 1))
    }
    expect(fn('projectItemAnnualIncome')).toMatch(/isPerShareIncome\(item\)/)
    expect(fn('getEffectiveYield')).toMatch(/isPerShareIncome\(item\)/)
  })
})
