import { getTypeCategory, getItemValue, computeModifiedDietz } from './utils'

function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stddev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

export function computeSharpeRatio({ returns, riskFreeRate }) {
  if (!returns || returns.length < 3) return { sharpe: null, annualizedReturn: null, annualizedVolatility: null }
  const rf = riskFreeRate ?? 0.04 / 12
  const avgReturn = mean(returns)
  const sd = stddev(returns)
  if (sd === 0) return { sharpe: null, annualizedReturn: avgReturn * 12 * 100, annualizedVolatility: 0 }
  const sharpe = ((avgReturn - rf) / sd) * Math.sqrt(12)
  return {
    sharpe: Math.round(sharpe * 100) / 100,
    annualizedReturn: avgReturn * 12 * 100,
    annualizedVolatility: sd * Math.sqrt(12) * 100,
  }
}

export function computeVolatility({ returns, periodsPerYear }) {
  if (!returns || returns.length < 2) return null
  let ppy = periodsPerYear
  if (!ppy && returns.length >= 2) {
    ppy = 12
  }
  const sd = stddev(returns)
  return Math.round(sd * Math.sqrt(ppy) * 100 * 100) / 100
}

export function computeMaxDrawdown(valueSeries) {
  if (!valueSeries || valueSeries.length < 2) {
    return { maxDrawdownPct: 0, peakDate: null, troughDate: null, currentDrawdownPct: 0 }
  }

  let peak = -Infinity
  let peakTs = null
  let maxDD = 0
  let maxDDPeakTs = null
  let maxDDTroughTs = null

  for (const pt of valueSeries) {
    const val = pt.value ?? pt.total ?? pt.close ?? 0
    if (val > peak) {
      peak = val
      peakTs = pt.ts
    }
    if (peak > 0) {
      const dd = (peak - val) / peak
      if (dd > maxDD) {
        maxDD = dd
        maxDDPeakTs = peakTs
        maxDDTroughTs = pt.ts
      }
    }
  }

  const lastVal = valueSeries[valueSeries.length - 1]
  const lastV = lastVal.value ?? lastVal.total ?? lastVal.close ?? 0
  const currentDD = peak > 0 ? (peak - lastV) / peak : 0

  return {
    maxDrawdownPct: Math.round(maxDD * 10000) / 100,
    peakDate: maxDDPeakTs,
    troughDate: maxDDTroughTs,
    currentDrawdownPct: Math.round(currentDD * 10000) / 100,
  }
}

export function computeHHI(positions) {
  if (!positions || positions.length === 0) return { hhi: 0, level: 'low', equivalentPositions: 0 }
  const total = positions.reduce((s, p) => s + (p.value || 0), 0)
  if (total <= 0) return { hhi: 0, level: 'low', equivalentPositions: 0 }

  let hhi = 0
  positions.forEach((p) => {
    const weight = ((p.value || 0) / total) * 100
    hhi += weight * weight
  })
  hhi = Math.round(hhi)

  const level = hhi > 2500 ? 'high' : hhi > 1500 ? 'medium' : 'low'
  return { hhi, level, equivalentPositions: hhi > 0 ? Math.round(10000 / hhi) : 0 }
}

export function computeHHIByDimension(items, dimensionFn) {
  if (!items || items.length === 0) return { hhi: 0, level: 'low', groups: [] }
  const groups = {}
  let total = 0
  items.forEach((it) => {
    const key = dimensionFn(it) || 'Unknown'
    const val = getItemValue(it)
    groups[key] = (groups[key] || 0) + val
    total += val
  })
  const positions = Object.entries(groups).map(([name, value]) => ({
    name,
    value,
    pct: total > 0 ? (value / total) * 100 : 0,
  }))
  const { hhi, level, equivalentPositions } = computeHHI(positions)
  return { hhi, level, equivalentPositions, groups: positions.sort((a, b) => b.value - a.value) }
}

function boxMullerRandom() {
  let u1 = 0, u2 = 0
  while (u1 === 0) u1 = Math.random()
  while (u2 === 0) u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function runMonteCarloSimulation({
  startValue,
  monthlyContribution = 0,
  years = 10,
  expectedReturn = 0.08,
  volatility = 0.15,
  numSimulations = 1000,
  goalValue = 0,
}) {
  const totalMonths = years * 12
  const dt = 1 / 12
  const mu = expectedReturn
  const sigma = volatility

  const allFinals = []
  const pathsByMonth = Array.from({ length: totalMonths + 1 }, () => [])

  for (let sim = 0; sim < numSimulations; sim++) {
    let value = startValue
    pathsByMonth[0].push(value)

    for (let m = 1; m <= totalMonths; m++) {
      const Z = boxMullerRandom()
      value = value * Math.exp((mu - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * Z)
      value += monthlyContribution
      pathsByMonth[m].push(value)
    }
    allFinals.push(value)
  }

  function getPercentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.floor((p / 100) * (sorted.length - 1))
    return sorted[idx]
  }

  const percentiles = { p10: [], p25: [], p50: [], p75: [], p90: [] }
  for (let m = 0; m <= totalMonths; m++) {
    const vals = pathsByMonth[m]
    percentiles.p10.push(getPercentile(vals, 10))
    percentiles.p25.push(getPercentile(vals, 25))
    percentiles.p50.push(getPercentile(vals, 50))
    percentiles.p75.push(getPercentile(vals, 75))
    percentiles.p90.push(getPercentile(vals, 90))
  }

  let goalProbability = null
  if (goalValue > 0) {
    const reachedGoal = allFinals.filter((v) => v >= goalValue).length
    goalProbability = Math.round((reachedGoal / numSimulations) * 100)
  }

  return {
    percentiles,
    goalProbability,
    medianFinal: getPercentile(allFinals, 50),
    p10Final: getPercentile(allFinals, 10),
    p90Final: getPercentile(allFinals, 90),
  }
}

export function computeNetContributions(transactions, convert, baseCurrency) {
  if (!transactions || transactions.length === 0) {
    return { totalContributed: 0, totalWithdrawn: 0, netContributions: 0 }
  }

  let totalContributed = 0
  let totalWithdrawn = 0

  transactions.forEach((tx) => {
    const type = (tx.type || '').toUpperCase()
    const amt = tx.totalAmount ?? 0
    const converted = convert ? convert(amt, tx.currency || 'USD', baseCurrency || 'USD') : amt

    if (type === 'DEPOSIT') {
      totalContributed += converted
    } else if (type === 'WITHDRAWAL') {
      totalWithdrawn += converted
    }
  })

  return {
    totalContributed,
    totalWithdrawn,
    netContributions: totalContributed - totalWithdrawn,
  }
}

export function generateInsights({ netWorth, benchmarkReturn, portfolioReturn, sharpe, volatility, maxDrawdown, hhi, incomeYield, goals, topContributor, topDrag }) {
  const insights = []

  if (benchmarkReturn != null && portfolioReturn != null) {
    const delta = portfolioReturn - benchmarkReturn
    if (delta > 0) {
      insights.push({
        type: 'positive',
        textEs: `Tu portafolio supera al S&P 500 por ${Math.abs(delta).toFixed(1)}%`,
        textEn: `Your portfolio outperforms the S&P 500 by ${Math.abs(delta).toFixed(1)}%`,
        priority: 1,
      })
    } else if (delta < -2) {
      insights.push({
        type: 'warning',
        textEs: `Tu portafolio está ${Math.abs(delta).toFixed(1)}% por debajo del S&P 500. Considera exposición a índices.`,
        textEn: `Your portfolio is ${Math.abs(delta).toFixed(1)}% below the S&P 500. Consider index fund exposure.`,
        priority: 2,
      })
    }
  }

  if (topContributor && topContributor.contribution > 0.5) {
    insights.push({
      type: 'positive',
      textEs: `${topContributor.symbol} es tu mayor impulsor: +${topContributor.contribution.toFixed(2)}% al portafolio`,
      textEn: `${topContributor.symbol} is your top contributor: +${topContributor.contribution.toFixed(2)}% to portfolio`,
      priority: 1.5,
    })
  }

  if (topDrag && topDrag.contribution < -0.5) {
    insights.push({
      type: 'warning',
      textEs: `${topDrag.symbol} es tu mayor lastre: ${topDrag.contribution.toFixed(2)}% al portafolio`,
      textEn: `${topDrag.symbol} is your biggest drag: ${topDrag.contribution.toFixed(2)}% on portfolio`,
      priority: 1.5,
    })
  }

  if (sharpe != null) {
    if (sharpe > 1) {
      insights.push({
        type: 'positive',
        textEs: `Excelente retorno ajustado al riesgo (Sharpe: ${sharpe.toFixed(2)})`,
        textEn: `Excellent risk-adjusted returns (Sharpe: ${sharpe.toFixed(2)})`,
        priority: 3,
      })
    } else if (sharpe < 0.5 && sharpe >= 0) {
      insights.push({
        type: 'warning',
        textEs: `Retorno ajustado al riesgo bajo (Sharpe: ${sharpe.toFixed(2)}). Considera reducir posiciones volátiles.`,
        textEn: `Low risk-adjusted returns (Sharpe: ${sharpe.toFixed(2)}). Consider reducing volatile positions.`,
        priority: 4,
      })
    }
  }

  if (maxDrawdown != null && maxDrawdown > 20) {
    insights.push({
      type: 'warning',
      textEs: `Caída máxima de ${maxDrawdown.toFixed(1)}%. Esto representa riesgo significativo.`,
      textEn: `Maximum drawdown of ${maxDrawdown.toFixed(1)}%. This represents significant risk.`,
      priority: 5,
    })
  }

  if (hhi != null && hhi > 2500) {
    const equivPos = hhi > 0 ? Math.round(10000 / hhi) : 0
    insights.push({
      type: 'warning',
      textEs: `Portafolio concentrado (equivale a ${equivPos} posiciones). Diversifica para reducir riesgo.`,
      textEn: `Concentrated portfolio (equivalent to ${equivPos} positions). Diversify to reduce risk.`,
      priority: 6,
    })
  } else if (hhi != null && hhi <= 1500 && hhi > 0) {
    const equivPos = Math.round(10000 / hhi)
    insights.push({
      type: 'positive',
      textEs: `Buena diversificación (equivale a ${equivPos} posiciones iguales)`,
      textEn: `Well diversified (equivalent to ${equivPos} equal positions)`,
      priority: 8,
    })
  }

  if (incomeYield != null && incomeYield > 0 && incomeYield < 2 && netWorth > 10000) {
    insights.push({
      type: 'info',
      textEs: `Rendimiento pasivo bajo (${incomeYield.toFixed(1)}%). Considera instrumentos con dividendos.`,
      textEn: `Low passive income yield (${incomeYield.toFixed(1)}%). Consider dividend-paying instruments.`,
      priority: 7,
    })
  }

  if (incomeYield != null && incomeYield >= 4) {
    insights.push({
      type: 'positive',
      textEs: `Buen rendimiento pasivo: ${incomeYield.toFixed(1)}% anual en ingresos.`,
      textEn: `Strong passive income: ${incomeYield.toFixed(1)}% annual yield.`,
      priority: 7,
    })
  }

  return insights.sort((a, b) => a.priority - b.priority).slice(0, 6)
}

export function computeHoldingPeriod(acquisitionDate) {
  if (!acquisitionDate) return null
  const acq = new Date(acquisitionDate)
  if (isNaN(acq.getTime())) return null
  const now = new Date()
  const diffMs = now.getTime() - acq.getTime()
  if (diffMs < 0) return null
  const days = Math.floor(diffMs / 86400000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return { days, years, months }
}

export function computeCAGR(startValue, endValue, years) {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return 0
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100
}

export function computePeriodicReturns(snapshots, transactions, convert, baseCurrency) {
  if (!snapshots || snapshots.length < 2) return []
  const sorted = [...snapshots].sort((a, b) => {
    const da = new Date(a.date).getTime()
    const db = new Date(b.date).getTime()
    return da - db
  })
  const returns = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].netWorthUSD ?? sorted[i - 1].totalActivosUSD ?? 0
    const curr = sorted[i].netWorthUSD ?? sorted[i].totalActivosUSD ?? 0
    if (prev > 0) {
      if (transactions && convert) {
        const prevTs = new Date(sorted[i - 1].date).getTime()
        const currTs = new Date(sorted[i].date).getTime()
        const { pct } = computeModifiedDietz({
          startValue: prev, endValue: curr,
          startTs: prevTs, endTs: currTs,
          transactions, convert, baseCurrency,
        })
        returns.push(pct / 100)
      } else {
        returns.push((curr - prev) / prev)
      }
    }
  }
  return returns
}

export function computeBeta(portfolioReturns, benchmarkReturns) {
  if (!portfolioReturns || !benchmarkReturns || portfolioReturns.length < 3 || benchmarkReturns.length < 3) {
    return null
  }
  const len = Math.min(portfolioReturns.length, benchmarkReturns.length)
  const pSlice = portfolioReturns.slice(-len)
  const bSlice = benchmarkReturns.slice(-len)

  const pMean = mean(pSlice)
  const bMean = mean(bSlice)

  let covariance = 0
  let bVariance = 0
  for (let i = 0; i < len; i++) {
    covariance += (pSlice[i] - pMean) * (bSlice[i] - bMean)
    bVariance += (bSlice[i] - bMean) ** 2
  }
  covariance /= len - 1
  bVariance /= len - 1

  if (bVariance === 0) return null
  return Math.round((covariance / bVariance) * 100) / 100
}

export function computeTWRSeries(chartData, transactions, convert, baseCurrency) {
  if (!chartData || chartData.length < 2) return []

  const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
  const flows = (transactions || [])
    .filter((tx) => tx.date && flowTypes[(tx.type || '').toUpperCase()] != null)
    .map((tx) => {
      const sign = flowTypes[(tx.type || '').toUpperCase()]
      const amt = convert
        ? convert((tx.totalAmount ?? 0) * sign, tx.currency || 'USD', baseCurrency || 'USD')
        : (tx.totalAmount ?? 0) * sign
      return { ts: new Date(tx.date).getTime(), flow: amt }
    })
    .sort((a, b) => a.ts - b.ts)

  let cumTWR = 1
  const series = [0]

  for (let i = 1; i < chartData.length; i++) {
    const prevTs = chartData[i - 1].ts
    const currTs = chartData[i].ts
    const prevVal = chartData[i - 1].value ?? chartData[i - 1].total ?? 0
    const currVal = chartData[i].value ?? chartData[i].total ?? 0

    const netFlow = flows
      .filter((f) => f.ts > prevTs && f.ts <= currTs)
      .reduce((s, f) => s + f.flow, 0)

    const adjustedStart = prevVal + netFlow
    const subReturn = adjustedStart > 0 ? currVal / adjustedStart - 1 : 0
    cumTWR *= 1 + subReturn
    series.push((cumTWR - 1) * 100)
  }

  return series
}

export function computeAssetAttribution(items) {
  if (!items || items.length === 0) return []
  const totalValue = items.reduce((s, it) => s + (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0), 0)
  if (totalValue <= 0) return []

  return items.map((it) => {
    const qty = it.quantity || 0
    const cur = it.currentPrice || it.purchasePrice || 0
    const cost = it._originalPurchasePrice || it.purchasePrice || cur
    const value = qty * cur
    const gain = value - qty * cost
    return {
      symbol: it.symbol || it.name || '',
      value,
      weight: (value / totalValue) * 100,
      gain,
      contribution: (gain / totalValue) * 100,
    }
  }).sort((a, b) => b.contribution - a.contribution)
}
