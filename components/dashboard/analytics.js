import { getTypeCategory, getItemValue, computeModifiedDietz, flowsAfterAnchor, getInvestmentClass, INVESTMENT_CLASS_META, isExcludedFromNetWorth, getItemPrincipalCost, getDividendIncomeByItem } from './utils'
import { snapshotAssetsUSD } from '@/lib/assetReturns'
import { preferFullPortfolioPerDay } from '@/lib/snapshotSelect'

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

// Infer how many return-periods fit in a year from the actual snapshot cadence,
// so volatility/Sharpe annualize correctly whether snapshots are daily (~252),
// monthly (~12) or irregular. Defaults to 12 when there isn't enough to tell.
export function inferPeriodsPerYear(snapshots) {
  const dates = (snapshots || [])
    .map((s) => new Date(s?.date).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)
  if (dates.length < 2) return 12
  const spanYears = (dates[dates.length - 1] - dates[0]) / (365.25 * 86400000)
  if (spanYears <= 0) return 12
  const ppy = (dates.length - 1) / spanYears
  return Math.max(4, Math.min(365, ppy))
}

export function computeSharpeRatio({ returns, periodsPerYear = 12, riskFreeRate }) {
  if (!returns || returns.length < 3) return { sharpe: null, annualizedReturn: null, annualizedVolatility: null }
  const ppy = periodsPerYear > 0 ? periodsPerYear : 12
  const rf = riskFreeRate ?? 0.04 / ppy
  const avgReturn = mean(returns)
  const sd = stddev(returns)
  if (sd === 0) return { sharpe: null, annualizedReturn: avgReturn * ppy * 100, annualizedVolatility: 0 }
  const sharpe = ((avgReturn - rf) / sd) * Math.sqrt(ppy)
  const clamped = Math.max(-10, Math.min(10, sharpe))
  return {
    sharpe: Math.round(clamped * 100) / 100,
    annualizedReturn: avgReturn * ppy * 100,
    annualizedVolatility: sd * Math.sqrt(ppy) * 100,
  }
}

export function computeVolatility({ returns, periodsPerYear }) {
  if (!returns || returns.length < 2) return null
  let ppy = periodsPerYear
  if (!ppy || ppy <= 0) ppy = 12
  const sd = stddev(returns)
  if (!isFinite(sd)) return null
  const vol = Math.round(sd * Math.sqrt(ppy) * 100 * 100) / 100
  if (vol > 500) return null
  return vol
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
  const positive = positions.filter((p) => (p.value || 0) > 0)
  const total = positive.reduce((s, p) => s + (p.value || 0), 0)
  if (total <= 0) return { hhi: 0, level: 'low', equivalentPositions: 0 }

  let hhi = 0
  positive.forEach((p) => {
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
    if (val <= 0) return
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

export function generateInsights({ netWorth, benchmarkReturn, portfolioReturn, sharpe, volatility, maxDrawdown, hhi, incomeYield, goals, topContributor, topDrag, maturingSoon, debtRatio, investmentClassPcts, netContributions, depositCount }) {
  const insights = []

  if (benchmarkReturn != null && portfolioReturn != null && Math.abs(portfolioReturn) <= 200) {
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

  if (maturingSoon && maturingSoon > 0) {
    insights.push({
      type: 'warning',
      textEs: `${maturingSoon} instrumento(s) vence(n) en los próximos 90 días`,
      textEn: `${maturingSoon} instrument(s) maturing within 90 days`,
      priority: 2,
    })
  }

  if (debtRatio != null && debtRatio > 50) {
    insights.push({
      type: 'warning',
      textEs: `Ratio deuda/activos alto: ${debtRatio.toFixed(0)}%. Considera reducir deuda.`,
      textEn: `High debt-to-asset ratio: ${debtRatio.toFixed(0)}%. Consider reducing debt.`,
      priority: 3,
    })
  }

  if (investmentClassPcts) {
    const dominant = Object.entries(investmentClassPcts).reduce((a, b) => a[1] > b[1] ? a : b, ['', 0])
    if (dominant[1] > 70) {
      const meta = INVESTMENT_CLASS_META[dominant[0]]
      if (meta) {
        insights.push({
          type: 'info',
          textEs: `${dominant[1].toFixed(0)}% del portafolio está en ${meta.returnType.es}. Considera diversificar por tipo de retorno.`,
          textEn: `${dominant[1].toFixed(0)}% of portfolio is in ${meta.returnType.en}. Consider diversifying by return type.`,
          priority: 5.5,
        })
      }
    }
  }

  if (netContributions != null && netWorth > 10000 && netContributions === 0 && (depositCount ?? 0) === 0) {
    insights.push({
      type: 'warning',
      textEs: 'No hay depósitos registrados. Registra tus aportes para calcular rendimientos con precisión.',
      textEn: 'No deposits recorded. Log your contributions for accurate return calculations.',
      priority: 0.5,
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
  // FASE HT4. Una serie de retornos solo tiene sentido sobre observaciones del
  // MISMO portafolio, una por día. Sin esto, los docs paralelos de NAV
  // solo-broker (FASE FU: ~$10K conviviendo con la observación completa de
  // ~$26K en la misma fecha) fabricaban "retornos" de ±60% día por medio y la
  // volatilidad anualizada salía 116% en un portafolio cuya máxima caída real
  // fue -5.6%: el diente de sierra, vivo dentro de las métricas de riesgo. Las
  // anclas de calibración y los docs por-cuenta tampoco son observaciones del
  // portafolio y quedan fuera. El filtro MAD de abajo no alcanza cuando la
  // MITAD de la serie es basura: la mediana misma se contamina.
  const usable = preferFullPortfolioPerDay(snapshots.filter((s) => s && !s._calibrated && !s._account))
  if (usable.length < 2) return []
  const sorted = [...usable].sort((a, b) => {
    const da = new Date(a.date).getTime()
    const db = new Date(b.date).getTime()
    return da - db
  })
  const returns = []
  for (let i = 1; i < sorted.length; i++) {
    // FASE LV: solo-activos (lib/assetReturns.js), la decisión de FASE LU:
    // volatilidad, Sharpe y drawdown miden las inversiones, no la deuda.
    const prev = snapshotAssetsUSD(sorted[i - 1])
    const curr = snapshotAssetsUSD(sorted[i])
    if (prev > 0) {
      let r
      if (transactions && convert) {
        const prevTs = new Date(sorted[i - 1].date).getTime()
        const currTs = new Date(sorted[i].date).getTime()
        // Snapshot values (prev/curr) are stored in USD, so flows must be
        // converted to USD too — not to the user's baseCurrency
        //
        // ⛔ FASE MW: un flujo fechado EL MISMO DÍA que `prev` ya está dentro de
        // `prev`, así que netearlo lo resta dos veces y ESE período se lee como
        // pérdida. El borde de la DERECHA sí es inclusivo a propósito: un flujo
        // del día de `curr` está dentro de `curr` y tiene que netearse, que es
        // justo lo que `gain = curr − prev − flujos` necesita. De acá salen
        // volatilidad, Sharpe y beta, así que un período torcido los mueve.
        const windowed = flowsAfterAnchor(transactions, prevTs, convert, 'USD').flows
        const { pct } = computeModifiedDietz({
          startValue: prev, endValue: curr,
          startTs: prevTs, endTs: currTs,
          transactions: windowed, convert, baseCurrency: 'USD',
        })
        r = pct / 100
      } else {
        r = (curr - prev) / prev
      }
      if (isFinite(r)) returns.push(r)
    }
  }
  return filterOutlierReturns(returns)
}

// Robust outlier gate for periodic returns. The old fixed |r|<1 cut was
// asymmetric in practice: a corrupt one-day NAV double (+123%) was dropped but
// its mirror legs (−55%) were kept, blowing up volatility/Sharpe. Use median ±
// 6×MAD when the sample allows; fall back to the symmetric |r|<1 cut otherwise.
function filterOutlierReturns(returns) {
  const base = returns.filter((r) => Math.abs(r) < 1)
  if (base.length < 6) return base
  const sorted = [...base].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const absDev = base.map((r) => Math.abs(r - median)).sort((a, b) => a - b)
  const mad = absDev[Math.floor(absDev.length / 2)]
  if (!mad) return base
  // 1.4826 scales MAD to σ-equivalent for normal data; 6σ keeps real fat tails.
  return base.filter((r) => Math.abs(r - median) <= 6 * 1.4826 * mad)
}

// Drop isolated single-point spikes/dips (>1.8× above or <0.55× below BOTH
// neighbors) from a {ts,value} series before drawdown/risk math — the same
// guard the growth chart applies to its merged series. A real crash or deposit
// is a step (the neighbor stays at the new level), which this keeps.
export function filterValueSpikes(series) {
  if (!series || series.length < 3) return series || []
  return series.filter((p, i) => {
    if (i === 0 || i === series.length - 1) return true
    const prev = series[i - 1].value, next = series[i + 1].value
    if (prev <= 0 || next <= 0) return true
    const upSpike = p.value > prev * 1.8 && p.value > next * 1.8
    const downDip = p.value < prev * 0.55 && p.value < next * 0.55
    return !(upSpike || downDip)
  })
}

// FASE HT5. El emparejado portafolio↔benchmark que antes vivía inline en
// RiskMetrics.jsx, extraído porque ahora lo necesita también el hook (el
// reporte imprime beta): dos copias del mismo emparejado es exactamente cómo
// una se queda atrás. Devuelve las DOS series alineadas par a par (misma
// ventana, mismo guard de outliers en ambas) más el beta ya calculado.
export function pairPortfolioWithBenchmark(valueSeries, benchmarkData) {
  const pReturnsB = []
  const bReturns = []
  if (!benchmarkData?.dataPoints?.length || benchmarkData.dataPoints.length <= 2 || !valueSeries || valueSeries.length <= 2) {
    return { pReturnsB, bReturns, beta: null }
  }
  const bPts = benchmarkData.dataPoints.slice().sort((a, b) => a.ts - b.ts)
  const findClosest = (ts) => {
    let lo = 0, hi = bPts.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (bPts[mid].ts < ts) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return bPts[0]
    const prev = bPts[lo - 1]
    const curr = bPts[lo]
    return Math.abs(prev.ts - ts) <= Math.abs(curr.ts - ts) ? prev : curr
  }
  for (let i = 1; i < valueSeries.length; i++) {
    const closestCurr = findClosest(valueSeries[i].ts)
    const closestPrev = findClosest(valueSeries[i - 1].ts)
    const prevVal = valueSeries[i - 1].value
    if (closestCurr && closestPrev && closestPrev.close > 0 && prevVal > 0) {
      const pr = (valueSeries[i].value - prevVal) / prevVal
      if (Math.abs(pr) < 1) {
        pReturnsB.push(pr)
        bReturns.push((closestCurr.close - closestPrev.close) / closestPrev.close)
      }
    }
  }
  return { pReturnsB, bReturns, beta: computeBeta(pReturnsB, bReturns) }
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

  if (bVariance <= 0) return null
  const beta = Math.round((covariance / bVariance) * 100) / 100
  if (Math.abs(beta) > 10) return null
  return beta
}

function clamp(v) {
  return Math.max(-10, Math.min(10, v))
}

export function computeSortino(returns, riskFreeRate = 0.04) {
  if (!returns || returns.length < 3) return 0
  const monthlyRf = riskFreeRate / 12
  const avgReturn = mean(returns)
  const downsideDiffs = returns.map((r) => Math.min(r - monthlyRf, 0))
  const downsideVariance = downsideDiffs.reduce((s, d) => s + d * d, 0) / (returns.length - 1)
  const downsideDev = Math.sqrt(downsideVariance)
  if (downsideDev === 0) return 0
  const sortino = ((avgReturn - monthlyRf) / downsideDev) * Math.sqrt(12)
  if (!isFinite(sortino)) return 0
  return Math.round(clamp(sortino) * 100) / 100
}

export function computeTreynor(returns, benchmarkReturns, riskFreeRate = 0.04) {
  if (!returns || returns.length < 3) return 0
  const beta = computeBeta(returns, benchmarkReturns)
  if (beta == null || beta === 0) return 0
  const monthlyRf = riskFreeRate / 12
  const avgReturn = mean(returns)
  const treynor = ((avgReturn - monthlyRf) * 12) / beta
  if (!isFinite(treynor)) return 0
  return Math.round(clamp(treynor) * 100) / 100
}

export function computeJensensAlpha(returns, benchmarkReturns, riskFreeRate = 0.04) {
  if (!returns || !benchmarkReturns || returns.length < 3 || benchmarkReturns.length < 3) return 0
  const beta = computeBeta(returns, benchmarkReturns)
  if (beta == null) return 0
  const avgReturn = mean(returns) * 12
  const avgBenchmark = mean(benchmarkReturns) * 12
  const alpha = avgReturn - (riskFreeRate + beta * (avgBenchmark - riskFreeRate))
  if (!isFinite(alpha)) return 0
  return Math.round(clamp(alpha) * 10000) / 10000
}

export function computeInformationRatio(returns, benchmarkReturns) {
  if (!returns || !benchmarkReturns || returns.length < 3 || benchmarkReturns.length < 3) return 0
  const len = Math.min(returns.length, benchmarkReturns.length)
  const pSlice = returns.slice(-len)
  const bSlice = benchmarkReturns.slice(-len)
  const activeReturns = pSlice.map((r, i) => r - bSlice[i])
  const avgActive = mean(activeReturns)
  const trackingError = stddev(activeReturns)
  if (trackingError === 0) return 0
  const ir = (avgActive / trackingError) * Math.sqrt(12)
  if (!isFinite(ir)) return 0
  return Math.round(clamp(ir) * 100) / 100
}

// opts.flowFromTs: ignore external flows BEFORE this timestamp. Used when the value
// series has a reconstructed (hold-flat) prefix spliced before the first real broker
// NAV snapshot: that prefix holds the current quantity flat, so deposits/withdrawals
// are already implicitly pre-dated in it. Netting them again double-counts and reads
// each early deposit as a fake gain or loss. Flows inside the real-NAV region still net.
export function computeTWRSeries(chartData, transactions, convert, baseCurrency, opts = {}) {
  if (!chartData || chartData.length < 2) return []

  const flowFromTs = opts.flowFromTs ?? null
  const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
  const flows = (transactions || [])
    .filter((tx) => tx.date && flowTypes[(tx.type || '').toUpperCase()] != null)
    .filter((tx) => flowFromTs == null || new Date(tx.date).getTime() >= flowFromTs)
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

// Cuánto movió cada activo el patrimonio COMPLETO. El denominador es el
// portafolio a propósito (esa es la pregunta de una atribución: qué parte del
// resultado total vino de acá), y por eso NO es el retorno del activo, que se
// mide contra su propio costo y vive en Asignación de Activos.
//
// Lo que sí tenía que cambiar es el NUMERADOR, que se calculaba a mano y por lo
// tanto ignoraba las tres piezas de la convención de la casa
// (lib/assetLogic/corporateBondWithEntryFee.js):
//   · el costo salía de `purchasePrice` crudo, sin la comisión de entrada;
//   · no sumaba el ingreso que el activo GENERÓ, así que un bono que paga en
//     efectivo a otra cuenta (VITALI) salía con ganancia 0 y no aparecía ni
//     entre los que suman ni entre los que restan, justo el caso que
//     getDividendIncomeByItem existe para arreglar;
//   · el total sumaba los pasivos como si fueran activos positivos, así que
//     amortizar una deuda se leía como "mayor perdedor".
// Ahora la ganancia se calcula igual que en las demás superficies y solo el
// denominador es distinto, que es lo único que de verdad distingue a esta
// tarjeta.
export function computeAssetAttribution(items, transactions, convert, baseCurrency) {
  if (!items || items.length === 0) return []
  const eligible = items.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
  const totalValue = eligible.reduce((s, it) => s + getItemValue(it), 0)
  if (totalValue <= 0) return []

  const dividendIncome = getDividendIncomeByItem(transactions, items, convert, baseCurrency)

  return eligible.map((it) => {
    const value = getItemValue(it)
    const principal = getItemPrincipalCost(it)
    const income = dividendIncome.get(it.id) || 0
    // Sin costo conocido no se puede atribuir una ganancia: se reporta 0 en vez
    // de inventar que costó lo que vale hoy.
    const gain = principal > 0 ? (value - principal) + income : 0
    return {
      symbol: it.symbol || it.name || '',
      value,
      weight: (value / totalValue) * 100,
      gain,
      contribution: (gain / totalValue) * 100,
    }
  }).sort((a, b) => b.contribution - a.contribution)
}

// Money-weighted return (Modified Dietz) as a cumulative series: for every point
// on the chart, the return of the money the user actually had working from the
// start of the period up to that point.
//
// Different question from TWR, and the one most people mean by "how am I doing".
// TWR deliberately strips out the effect of WHEN you added money, so it measures
// the manager, not the investor. MWR keeps it: a deposit made right before a
// rally helps your number, exactly as it helped your wallet.
//
//   return = (endValue - startValue - netFlows) / (startValue + Σ flow × weight)
//   weight = time the flow was actually invested / total period
//
// Note this is NOT chained: each point is measured from the period start, so a
// single bad sub-period cannot compound into an absurd figure the way a chained
// TWR does when one denominator is polluted.
export function computeMWRSeries(chartData, transactions, convert, baseCurrency, opts = {}) {
  if (!chartData || chartData.length < 2) return []

  // flowFromTs mirrors computeTWRSeries. When the early part of the chart is a
  // hold-flat RECONSTRUCTION (today's holdings projected backwards), that
  // reconstruction already contains the effect of the deposits that built the
  // position, so netting those same flows again double-counts them. The chart
  // was already passing this option; the function silently ignored it because
  // it had no such parameter, and JavaScript never complains about an extra
  // argument. See the FASE AD/AI note in CLAUDE.md.
  const flowFromTs = opts.flowFromTs ?? null
  // FASE EO. The chained-segment caller (computeAnchoredReturnSeries) needs an
  // upper bound too: a flow landing exactly at a segment's END timestamp is the
  // flow that opens the NEXT segment, not a mid-segment event of this one. Without
  // this, that flow's fee reads as an instant loss in the segment it's about to
  // leave (same fee-in-the-numerator shape the frozen VITALI case documents).
  const flowBeforeTs = opts.flowBeforeTs ?? null

  const flowTypes = { DEPOSIT: 1, WITHDRAWAL: -1 }
  const flows = (transactions || [])
    .filter((tx) => tx.date && flowTypes[(tx.type || '').toUpperCase()] != null)
    .filter((tx) => flowFromTs == null || new Date(tx.date).getTime() >= flowFromTs)
    .filter((tx) => flowBeforeTs == null || new Date(tx.date).getTime() < flowBeforeTs)
    .map((tx) => {
      const sign = flowTypes[(tx.type || '').toUpperCase()]
      const raw = (tx.totalAmount ?? 0) * sign
      const amt = convert ? convert(raw, tx.currency || 'USD', baseCurrency || 'USD') : raw
      return { ts: new Date(tx.date).getTime(), flow: Number.isFinite(amt) ? amt : raw }
    })
    .sort((a, b) => a.ts - b.ts)

  const startTs = chartData[0].ts
  const startValue = chartData[0].value ?? chartData[0].total ?? 0
  const series = [0]

  for (let i = 1; i < chartData.length; i++) {
    const endTs = chartData[i].ts
    const endValue = chartData[i].value ?? chartData[i].total ?? 0
    const totalMs = endTs - startTs

    if (totalMs <= 0 || startValue <= 0) { series.push(series[series.length - 1]); continue }

    let sumFlows = 0
    let weighted = 0
    for (const f of flows) {
      if (f.ts <= startTs || f.ts > endTs) continue
      sumFlows += f.flow
      weighted += f.flow * ((endTs - f.ts) / totalMs)
    }

    const capital = startValue + weighted
    // A denominator at or below zero means the account was fully funded by
    // flows inside the window; there is no invested base to measure against, so
    // carry the previous figure instead of emitting a wild number.
    if (capital <= 0) { series.push(series[series.length - 1]); continue }

    series.push(((endValue - startValue - sumFlows) / capital) * 100)
  }

  return series
}

// ⛔ LÓGICA CONGELADA (D). Antes de tocar el ancla o el re-base de esta serie,
// leer lib/assetLogic/corporateBondWithEntryFee.js y seguir el protocolo de
// su cabecera: hay que PREGUNTAR antes de cambiarla.
//
// FASE EJ/EO. The %-per-point twin of computeWindowGrowth (dashboard/utils.js):
// new capital that arrives mid-window is never counted as return, whether the
// window opens at $0 (a brand-new account) or already holding value (XOCHI,
// bought years earlier, giving the window a nonzero start before VITALI's own
// deposit lands on top of it). The old code (FASE EJ) only excluded the FIRST
// such funding event: with a THIRD bond (CrediCorp) funded at yet another
// date, its own entry fee showed up as an instant loss right when IT landed,
// healing only as Dietz's own time-weighting caught up — the same
// fee-in-the-numerator error CLAUDE.md's VITALI case documents, now repeating
// once per funding event instead of just the first (FASE EO).
//
// The general fix chains N segments, not just two: every point where new
// capital lands — the window's own start-of-value point (zeroIdx > 0) plus
// every later DEPOSIT/WITHDRAWAL landing strictly inside the window — opens a
// FRESH segment that excludes its own funding flow (so that segment's fee
// never reads as a loss), measured with computeMWRSeries exactly like the
// single-anchor case always was. Segments chain multiplicatively
// ((1+r1)*(1+r2)*... - 1), which is what makes new capital arriving later
// contribute NOTHING until it itself earns something — it can never dilute
// what was already earned, the one property an anchor-per-event fix has to
// preserve for three bonds that it already had for two.
//
// The final rescale is unchanged in spirit from FASE EE/EJ: Dietz is linear
// in the base once no flows are left inside a (sub-)window, so the fee is
// still applied as ONE scale of the whole chained shape at the very end
// (principal deployed / cost basis deployed, using the REAL value jump at
// each boundary as the fee-free "principal" side — no need to know any
// item's entryFee directly, the chart's own reconstructed value already
// nets it out). A uniform scale never introduces a NEW dip: it stretches or
// shrinks the whole chained curve, it does not reshape it.
export function computeAnchoredReturnSeries(chartData, transactions, convert, baseCurrency, opts = {}) {
  if (!chartData || chartData.length < 2) return []
  const windowStartTs = chartData[0].ts

  // Hold-flat prefixes pre-date flows implicitly, so flows inside them are
  // ignored (flowFromTs). A TRANSACTIONAL prefix contains real flow effects,
  // so every flow nets, exactly like a broker's full-year TWR. Unrelated to
  // the manual-deposit chaining below — a broker-synced position doesn't
  // carry the kind of per-item entry fee this chains for — so it keeps its
  // own single-anchor path exactly as before.
  const hasHoldFlatPrefix = !opts.apiTransactional && opts.firstRealTs != null
    && chartData[0].ts < opts.firstRealTs - 3600000
  if (hasHoldFlatPrefix) {
    const idx = chartData.findIndex((p) => p.ts >= opts.firstRealTs - 3600000)
    const anchorIdx = idx > 0 ? idx : -1
    const measured = anchorIdx > 0 ? chartData.slice(anchorIdx) : chartData
    if (measured.length < 2) return []
    const series = computeMWRSeries(measured, transactions, convert, baseCurrency, { flowFromTs: opts.firstRealTs })
    return anchorIdx > 0 ? [...Array(anchorIdx).fill(0), ...series] : series
  }

  const zeroIdx = chartData.findIndex((p) => (p.value ?? p.total ?? 0) > 0)
  if (zeroIdx === -1) return chartData.map(() => 0)

  // Every later funding boundary, in order, deduped to one per chart point
  // (two deposits landing on the same reconstructed point only need one
  // fresh segment) and never at/before the window's own start (that money is
  // already folded into chartData[0], not new).
  const laterBoundaries = []
  {
    const seen = new Set()
    const flowTs = (transactions || [])
      .filter((tx) => { const ty = (tx.type || '').toUpperCase(); return ty === 'DEPOSIT' || ty === 'WITHDRAWAL' })
      .map((tx) => (tx.date ? new Date(tx.date).getTime() : NaN))
      .filter((ts) => Number.isFinite(ts) && ts > windowStartTs)
      .sort((a, b) => a - b)
    for (const ts of flowTs) {
      const idx = chartData.findIndex((p) => p.ts >= ts)
      if (idx <= 0 || idx <= zeroIdx || seen.has(idx)) continue
      laterBoundaries.push(idx)
      seen.add(idx)
    }
  }

  // segmentStarts[0] is where Dietz measurement actually begins; everything
  // before it is genuinely 0 — there is no capital yet to measure a return
  // against (FASE ED).
  const firstAnchor = zeroIdx > 0 ? zeroIdx : 0
  const segmentStarts = zeroIdx > 0 ? [zeroIdx, ...laterBoundaries] : [0, ...laterBoundaries]

  const out = new Array(chartData.length).fill(0)
  let carry = 1
  for (let s = 0; s < segmentStarts.length; s++) {
    const start = segmentStarts[s]
    const isLastSegment = s === segmentStarts.length - 1
    const end = isLastSegment ? chartData.length - 1 : segmentStarts[s + 1]
    if (end <= start) continue
    let segmentData = chartData.slice(start, end + 1)
    if (segmentData.length < 2) continue

    // Every segment excludes its OWN opening flow (flowFromTs: the deposit
    // that created this segment's start is already folded into
    // segmentData[0].value, netting it again would double-count). Segment 0
    // with organic value (zeroIdx === 0) has no flow at its own start, so
    // flowFromTs there is a no-op — safe to apply uniformly.
    //
    // A segment that CLOSES on a boundary (not the last segment) needs more
    // than that: its final point IS the instant the next flow lands, so
    // endValue already contains the newly injected value. Subtracting just
    // the flow's CASH amount (sumFlows) is what the single-anchor code did
    // and it is wrong here, for the same reason the frozen VITALI spec
    // exists: cash in (with its fee) never equals value added. A $6,098
    // deposit that buys $6,000 of bond reads as an instant $98 loss for the
    // capital that was already there. The fix is to exclude the injected
    // VALUE itself (the real jump the chart already reconstructed, fee and
    // all) from this closing segment's own Dietz calc — that capital is not
    // this segment's business, it becomes the next segment's base instead
    // (which starts from the true post-flow value, untouched).
    if (!isLastSegment) {
      const jump = (chartData[end].value ?? chartData[end].total ?? 0)
        - (chartData[end - 1].value ?? chartData[end - 1].total ?? 0)
      const last = segmentData[segmentData.length - 1]
      segmentData = [...segmentData.slice(0, -1), { ts: last.ts, value: (last.value ?? last.total ?? 0) - jump }]
    }
    // FASE FZ. El límite superior de flujos de un segmento que CIERRA en una
    // frontera tiene que cubrir el ÚLTIMO intervalo entre puntos completo, no
    // solo el timestamp exacto de la frontera. El salto que se excluye arriba
    // es el delta entre los DOS últimos puntos, así que los flujos fechados
    // dentro de ese mismo intervalo (un depósito del 1 jun cuando el punto
    // más cercano de la serie es el 2 jun) son exactamente el dinero que ese
    // salto representa: dejarlos adentro los resta DOS veces (como flujo y
    // como salto), que es como ClubCashIn marcó -125.74% sobre una cuenta
    // que ganaba (+5.38% en la pestaña MWR, que no segmenta y no lo sufre).
    // Con el flujo fechado EXACTO en la frontera (VITALI, todos los casos del
    // candado) ambos límites excluyen lo mismo: byte-idéntico.
    const mwrOpts = {
      flowFromTs: segmentData[0].ts + 1,
      flowBeforeTs: isLastSegment ? chartData[end].ts : chartData[end - 1].ts + 1,
    }
    const local = computeMWRSeries(segmentData, transactions, convert, baseCurrency, mwrOpts)
    for (let j = 0; j < segmentData.length; j++) {
      out[start + j] = (carry * (1 + (local[j] || 0) / 100) - 1) * 100
    }
    carry *= (1 + (local[local.length - 1] || 0) / 100)
  }

  // Rescale the whole chained shape once, principal → cost basis, exactly
  // like the single-anchor case. "Principal deployed" per boundary is the
  // REAL value jump the chart already reconstructed (fee-free, since the
  // asset's true value never included the fee); "cost basis deployed" is the
  // full cash that left the pocket (every DEPOSIT/WITHDRAWAL inside the
  // window). Neither needs any item's entryFee directly.
  let principalDeployed = chartData[0].value ?? chartData[0].total ?? 0
  if (zeroIdx > 0) {
    principalDeployed += (chartData[zeroIdx].value ?? chartData[zeroIdx].total ?? 0)
      - (chartData[zeroIdx - 1].value ?? chartData[zeroIdx - 1].total ?? 0)
  }
  for (const idx of laterBoundaries) {
    principalDeployed += (chartData[idx].value ?? chartData[idx].total ?? 0)
      - (chartData[idx - 1].value ?? chartData[idx - 1].total ?? 0)
  }
  let costBasisDeployed = chartData[0].value ?? chartData[0].total ?? 0
  for (const tx of transactions || []) {
    const ty = (tx.type || '').toUpperCase()
    if (ty !== 'DEPOSIT' && ty !== 'WITHDRAWAL') continue
    const ts = tx.date ? new Date(tx.date).getTime() : NaN
    if (!Number.isFinite(ts) || ts <= windowStartTs) continue
    const raw = Number(tx.totalAmount ?? 0)
    const amt = convert ? convert(raw, tx.currency || 'USD', baseCurrency || 'USD') : raw
    if (Number.isFinite(amt)) costBasisDeployed += ty === 'DEPOSIT' ? amt : -amt
  }
  if (costBasisDeployed > 0 && principalDeployed > 0 && (zeroIdx > 0 || laterBoundaries.length > 0)) {
    const scale = principalDeployed / costBasisDeployed
    for (let i = firstAnchor; i < out.length; i++) out[i] *= scale
  }

  return out
}

// FASE FP. The money-weighted SIBLING of computeAnchoredReturnSeries — an
// EXTENSION of the frozen logic, never a change to it (the protocol in
// lib/assetLogic/corporateBondWithEntryFee.js permits extending, forbids
// rewriting; the frozen function above stays byte-identical and remains the
// chart's default "Rendimiento TWR" tab).
//
// Same anchor, same window, one difference: NO chained segments. The frozen
// series opens a fresh segment at every funding boundary, which is exactly
// what strips out the timing of the user's own deposits — capital arriving
// late "contributes nothing until it itself earns something". That is the
// time-weighted (strategy) reading. This function instead runs ONE Modified
// Dietz window from the anchor to the end, with every later
// DEPOSIT/WITHDRAWAL netting INSIDE the window at its time weight: capital
// arriving right before a rally helps the number, capital sitting idle drags
// it — the money-weighted ("how did MY money actually do", IBKR's MWR)
// reading. With no flows inside the window the two coincide exactly, which
// is the property that keeps VITALI at 3.94% on BOTH tabs.
//
// Fee convention, per event, still respects the frozen invariant
// (costBasis - principal === fee, fee never charged twice):
//  - The ANCHOR's own funding is folded into the anchor value (excluded as a
//    flow), so its fee re-enters through an anchor-only rescale:
//    principal-at-anchor / cash-that-funded-it — the exact rescale shape the
//    frozen function uses, restricted to the anchor. VITALI-only: 4.00% raw
//    × (6000/6098) = 3.94%, same as the TWR tab.
//  - Every LATER funding nets as CASH (fee included) with its Dietz time
//    weight — that is how IBKR's own MWR treats a purchase + commission
//    (money out of pocket that bought less value than it cost), and it is
//    charged exactly once: later boundaries are deliberately NOT part of the
//    rescale, or their fee would count in both numerator and denominator
//    (the documented 2.33% double-charge shape).
export function computeAnchoredMWRSeries(chartData, transactions, convert, baseCurrency, opts = {}) {
  if (!chartData || chartData.length < 2) return []
  const windowStartTs = chartData[0].ts

  // Hold-flat prefix branch: byte-for-byte the frozen function's own branch.
  // It is already a single Dietz window there, so TWR and MWR coincide — a
  // broker-synced prefix carries no per-item entry fee to differ over.
  const hasHoldFlatPrefix = !opts.apiTransactional && opts.firstRealTs != null
    && chartData[0].ts < opts.firstRealTs - 3600000
  if (hasHoldFlatPrefix) {
    const idx = chartData.findIndex((p) => p.ts >= opts.firstRealTs - 3600000)
    const anchorIdx = idx > 0 ? idx : -1
    const measured = anchorIdx > 0 ? chartData.slice(anchorIdx) : chartData
    if (measured.length < 2) return []
    const series = computeMWRSeries(measured, transactions, convert, baseCurrency, { flowFromTs: opts.firstRealTs })
    return anchorIdx > 0 ? [...Array(anchorIdx).fill(0), ...series] : series
  }

  const zeroIdx = chartData.findIndex((p) => (p.value ?? p.total ?? 0) > 0)
  if (zeroIdx === -1) return chartData.map(() => 0)

  const measured = zeroIdx > 0 ? chartData.slice(zeroIdx) : chartData
  if (measured.length < 2) return chartData.map(() => 0)
  // flowFromTs excludes the anchor's own funding (already folded into
  // measured[0].value — netting it again would double-count, same reasoning
  // as every segment start in the frozen function). Later flows all net.
  const local = computeMWRSeries(measured, transactions, convert, baseCurrency,
    { flowFromTs: measured[0].ts + 1 })
  const out = new Array(chartData.length).fill(0)
  for (let j = 0; j < measured.length; j++) out[zeroIdx + j] = local[j] || 0

  // Anchor-only fee rescale (see header comment): the cash that created the
  // anchor value vs the value it actually bought.
  if (zeroIdx > 0) {
    const anchorTs = chartData[zeroIdx].ts
    const prevVal = chartData[zeroIdx - 1].value ?? chartData[zeroIdx - 1].total ?? 0
    const anchorPrincipal = (chartData[zeroIdx].value ?? chartData[zeroIdx].total ?? 0) - prevVal
    let anchorCost = 0
    for (const tx of transactions || []) {
      const ty = (tx.type || '').toUpperCase()
      if (ty !== 'DEPOSIT' && ty !== 'WITHDRAWAL') continue
      const ts = tx.date ? new Date(tx.date).getTime() : NaN
      if (!Number.isFinite(ts) || ts <= windowStartTs || ts > anchorTs) continue
      const raw = Number(tx.totalAmount ?? 0)
      const amt = convert ? convert(raw, tx.currency || 'USD', baseCurrency || 'USD') : raw
      if (Number.isFinite(amt)) anchorCost += ty === 'DEPOSIT' ? amt : -amt
    }
    if (anchorCost > 0 && anchorPrincipal > 0) {
      const scale = anchorPrincipal / anchorCost
      for (let i = zeroIdx; i < out.length; i++) out[i] *= scale
    }
  }

  return out
}
