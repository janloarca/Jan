// Ficha de un activo: las cifras que la Hoja muestra al tocar su nombre.
//
// ⛔ Solo LECTURA y SIN fórmula propia. Todo sale de las funciones de la
// convención de rendimiento (components/dashboard/utils.js, lógica congelada
// A/E, spec en lib/assetLogic/corporateBondWithEntryFee.js), con la MISMA
// receta que usa Asignación de Activos:
//
//   ganancia  = (valor − principalCost) + ingresos que el activo generó
//   retorno % = ganancia / invertido      (invertido = getInvestedCapital)
//
// Si esta ficha calculara su propio "invertido" o su propio retorno, la misma
// posición diría dos números según la pantalla que se mire (VITALI: 3.94% acá
// y 4.00% o 2.33% allá). Por eso este módulo no suma, no resta ni divide nada
// que no sea la presentación de esas piezas.
//
// Dos decisiones de honestidad:
//  - Una DEUDA no tiene "rendimiento": se devuelve `isDebt` y sin ganancia ni
//    múltiplo. Decir "ganaste" sobre un préstamo es contar al revés.
//  - Sin capital invertido (invertido <= 0) no hay porcentaje ni múltiplo:
//    `null`, nunca 0 ni Infinity. "No se puede medir" no es "rindió cero".
import {
  getItemValue,
  getItemPrincipalCost,
  getInvestedCapital,
  getDividendIncomeByItem,
  getIncomeReceivedByItem,
  getOwnReinvestedYieldByItem,
  getSectorFromItem,
  getGeographyFromItem,
  getTypeCategory,
} from '@/components/dashboard/utils'

export function assetSummary(item, { transactions = [], items = [], convert, baseCurrency = 'USD' } = {}) {
  if (!item) return null
  const value = getItemValue(item)
  const common = {
    id: item.id,
    sector: getSectorFromItem(item),
    location: getGeographyFromItem(item),
    category: getTypeCategory(item),
    institution: item.institution || '',
    currency: baseCurrency,
  }
  if (item.isDebt) {
    return { ...common, isDebt: true, balance: Math.abs(value), invested: null, gain: null, gainPct: null, multiple: null, ownYield: 0 }
  }

  const all = items && items.length ? items : [item]
  const income = getDividendIncomeByItem(transactions, all, convert, baseCurrency).get(item.id) || 0
  const received = getIncomeReceivedByItem(transactions, all, convert, baseCurrency).get(item.id)
  const ownYield = getOwnReinvestedYieldByItem(transactions, all, convert, baseCurrency).get(item.id) || 0

  const principal = getItemPrincipalCost(item)
  const invested = getInvestedCapital(item, received, ownYield)
  const gain = (value - principal) + income
  const measurable = invested > 0

  return {
    ...common,
    isDebt: false,
    balance: value,
    invested,
    gain,
    gainPct: measurable ? (gain / invested) * 100 : null,
    multiple: measurable ? value / invested : null,
    ownYield,
  }
}
