import { getTypeCategory, getItemValue } from '@/components/dashboard/utils'

export function generateInsights(items, profile, netWorth, estimatedAnnualIncome) {
  const insights = []
  if (!items || items.length === 0) return insights

  const totalAssets = items.filter(it => !it.isDebt).reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
  const totalDebt = items.filter(it => it.isDebt || getTypeCategory(it.type) === 'debts').reduce((s, it) => s + Math.abs(getItemValue(it)), 0)

  const liquidItems = items.filter(it => {
    const cat = getTypeCategory(it.type)
    return cat === 'banks' || /cash|saving|checking|money.?market|efectivo|ahorro|cuenta/i.test(it.type || '')
  })
  const liquidTotal = liquidItems.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
  const liquidPct = totalAssets > 0 ? (liquidTotal / totalAssets) * 100 : 0

  if (totalDebt > 0 && totalAssets > 0) {
    const leverage = (totalDebt / totalAssets) * 100
    insights.push({
      type: leverage > 50 ? 'danger' : leverage > 30 ? 'warning' : 'success',
      titleEs: 'Apalancamiento', titleEn: 'Leverage',
      descEs: `Tu deuda es ${leverage.toFixed(0)}% de tus activos.`,
      descEn: `Your debt is ${leverage.toFixed(0)}% of your assets.`,
      priority: leverage > 50 ? 1 : 5,
    })
  }

  if (liquidPct < 5 && totalAssets > 0) {
    insights.push({
      type: 'warning',
      titleEs: 'Liquidez baja', titleEn: 'Low liquidity',
      descEs: `Solo ${liquidPct.toFixed(1)}% de tu portafolio es líquido.`,
      descEn: `Only ${liquidPct.toFixed(1)}% of your portfolio is liquid.`,
      priority: 2,
    })
  }

  const values = items.map(it => ({ name: it.name || it.symbol, value: Math.abs(getItemValue(it)) }))
  const topItem = values.sort((a, b) => b.value - a.value)[0]
  if (topItem && totalAssets > 0) {
    const pct = (topItem.value / totalAssets) * 100
    if (pct > 30) {
      insights.push({
        type: 'warning',
        titleEs: 'Concentración alta', titleEn: 'High concentration',
        descEs: `${topItem.name} es ${pct.toFixed(0)}% de tu portafolio.`,
        descEn: `${topItem.name} is ${pct.toFixed(0)}% of your portfolio.`,
        priority: 3,
      })
    }
  }

  const maturing = items.filter(it => {
    if (!it.maturityDate) return false
    const days = (new Date(it.maturityDate) - new Date()) / 86400000
    return days > 0 && days < 90
  })
  if (maturing.length > 0) {
    const names = maturing.map(it => it.name || it.symbol).join(', ')
    insights.push({
      type: 'info',
      titleEs: 'Vencimientos próximos', titleEn: 'Upcoming maturities',
      descEs: `${names} vence en los próximos 90 días.`,
      descEn: `${names} matures in the next 90 days.`,
      priority: 2,
    })
  }

  if (profile) {
    if (profile.monthlyExpenses > 0) {
      const months = liquidTotal / profile.monthlyExpenses
      const target = profile.emergencyMonths || 6
      insights.push({
        type: months >= target ? 'success' : months >= 3 ? 'warning' : 'danger',
        titleEs: 'Fondo de emergencia', titleEn: 'Emergency fund',
        descEs: months >= target
          ? `Cubres ${months.toFixed(1)} meses de gastos. Bien.`
          : `Solo cubres ${months.toFixed(1)} meses (meta: ${target}).`,
        descEn: months >= target
          ? `You cover ${months.toFixed(1)} months of expenses. Good.`
          : `Only ${months.toFixed(1)} months covered (target: ${target}).`,
        priority: months < 3 ? 1 : 4,
      })
    }

    if (profile.monthlyIncome > 0 && profile.monthlySavings > 0) {
      const rate = (profile.monthlySavings / profile.monthlyIncome) * 100
      insights.push({
        type: rate >= 20 ? 'success' : rate >= 10 ? 'info' : 'warning',
        titleEs: 'Tasa de ahorro', titleEn: 'Savings rate',
        descEs: `Ahorras ${rate.toFixed(0)}% de tu ingreso.`,
        descEn: `You save ${rate.toFixed(0)}% of your income.`,
        priority: rate < 10 ? 2 : 6,
      })
    }

    if (profile.monthlyExpenses > 0 && netWorth > 0) {
      const fireNumber = profile.monthlyExpenses * 12 * 25
      const firePct = (netWorth / fireNumber) * 100
      insights.push({
        type: firePct >= 100 ? 'success' : 'info',
        titleEs: 'Independencia financiera', titleEn: 'Financial independence',
        descEs: `Estás al ${firePct.toFixed(0)}% de tu número FIRE.`,
        descEn: `You're ${firePct.toFixed(0)}% to your FIRE number.`,
        priority: 5,
      })
    }

    if (profile.monthlyExpenses > 0 && estimatedAnnualIncome > 0) {
      const monthlyPassive = estimatedAnnualIncome / 12
      const coverage = (monthlyPassive / profile.monthlyExpenses) * 100
      insights.push({
        type: coverage >= 100 ? 'success' : coverage >= 50 ? 'info' : 'warning',
        titleEs: 'Ingreso pasivo', titleEn: 'Passive income',
        descEs: `Tus ingresos pasivos cubren ${coverage.toFixed(0)}% de tus gastos.`,
        descEn: `Passive income covers ${coverage.toFixed(0)}% of your expenses.`,
        priority: 4,
      })
    }

    if (profile.incomeGoal > 0 && estimatedAnnualIncome > 0) {
      const pct = (estimatedAnnualIncome / (profile.incomeGoal * 12)) * 100
      insights.push({
        type: pct >= 100 ? 'success' : 'info',
        titleEs: 'Meta de ingreso', titleEn: 'Income goal',
        descEs: `${pct.toFixed(0)}% de tu meta de ingreso pasivo mensual.`,
        descEn: `${pct.toFixed(0)}% of your monthly passive income goal.`,
        priority: 5,
      })
    }
  }

  return insights.sort((a, b) => a.priority - b.priority).slice(0, 6)
}
