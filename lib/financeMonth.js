// Monthly income/expense engine for the finances tab: month completeness,
// group-level totals with month-over-month and year-over-year deltas, and
// actionable textual insights. Pure module (no React/Firestore) — callers pass
// financeTransactions and a convert(amount, from, to) helper.
//
// Date handling: transactions carry 'YYYY-MM-DD' strings; we compare string
// prefixes (never new Date()) so UTC-6 users don't see transactions shift
// months — same convention as app/finances/page.jsx.

import {
  groupOfCategory, EXPENSE_GROUPS, OTHER_GROUP,
  incomeGroupOfCategory, INCOME_GROUPS,
} from '@/lib/financeCategories'
import { isReinvestedDividend, reinvestIndex } from '@/lib/dividendCash'

export const FINANCE_CURRENCY = 'GTQ'

export function monthKeyOf(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function txAmount(tx, convert, to = FINANCE_CURRENCY) {
  const amt = Number(tx.amount) || 0
  const cur = tx.currency || FINANCE_CURRENCY
  if (cur === to || typeof convert !== 'function') return amt
  const out = convert(amt, cur, to)
  return isFinite(out) ? out : amt
}

function txsOfMonth(transactions, key) {
  return (transactions || []).filter((tx) => typeof tx.date === 'string' && tx.date.startsWith(key))
}

// 'empty' | 'partial' | 'complete' — a month is unfilled when nothing was
// recorded; partial when income OR expenses are missing entirely.
export function getMonthStatus(transactions, key) {
  const txs = txsOfMonth(transactions, key)
  if (txs.length === 0) return 'empty'
  const hasIncome = txs.some((t) => t.type === 'INCOME')
  const hasExpense = txs.some((t) => t.type === 'EXPENSE')
  return hasIncome && hasExpense ? 'complete' : 'partial'
}

function summarizeMonth(transactions, key, convert) {
  const txs = txsOfMonth(transactions, key)
  let income = 0
  let expenses = 0
  const byGroup = {}
  const incomeByGroup = {}
  // Categoría dentro de su grupo. Se acumula en el MISMO recorrido que el
  // grupo, así el desglose de una fila siempre suma exactamente esa fila: no
  // hay forma de que las dos cifras discrepen.
  const catByGroup = {}
  const incomeCatByGroup = {}
  let hormigaCount = 0
  let hormigaSum = 0
  const bump = (outer, gk, cat, amt) => {
    if (!outer[gk]) outer[gk] = {}
    outer[gk][cat] = (outer[gk][cat] || 0) + amt
  }
  for (const tx of txs) {
    const amt = txAmount(tx, convert)
    if (tx.type === 'INCOME') {
      income += amt
      const g = incomeGroupOfCategory(tx.category)
      incomeByGroup[g.key] = (incomeByGroup[g.key] || 0) + amt
      bump(incomeCatByGroup, g.key, tx.category || 'Otros Ingresos', amt)
    } else if (tx.type === 'EXPENSE') {
      expenses += amt
      const g = groupOfCategory(tx.category)
      byGroup[g.key] = (byGroup[g.key] || 0) + amt
      bump(catByGroup, g.key, tx.category || 'Otros Gastos', amt)
      // "Gastos hormiga": small unplanned spends that add up silently.
      if (amt > 0 && amt < 75) { hormigaCount += 1; hormigaSum += amt }
    }
  }
  return {
    income, expenses, savings: income - expenses,
    byGroup, incomeByGroup, catByGroup, incomeCatByGroup,
    txCount: txs.length, hormigaCount, hormigaSum,
  }
}

function pctDelta(current, previous) {
  if (previous == null || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

// ¿Se puede COMPARAR esta cifra contra la del mes pasado?
//
// El porcentaje siempre se puede calcular; que signifique algo es otra cosa, y
// hasta ahora nadie hacía esa pregunta. En la captura del usuario TODAS las
// filas bajaban (↓92, ↓99, ↓89, ↓100…) y la aritmética estaba perfecta: son 18
// días de agosto contra 31 de julio, con una prima anual de seguro adentro. Una
// pared de flechas rojas que solo describe el calendario entierra el único
// movimiento que sí era real.
//
// Las tres razones para callar, cada una con su causa distinta:
//   · el mes está EN CURSO: se compara media ventana contra una completa;
//   · la fila está en cero HOY: eso es "todavía no hay datos", no "gasté menos";
//   · el mes pasado está en cero: no hay base contra la cual medir (ya era así).
function isComparable(amount, prevAmount, partialMonth) {
  if (partialMonth) return false
  if (!(amount > 0)) return false
  return prevAmount != null && prevAmount > 0
}

// Cuánto del mes lleva transcurrido. Todo en hora LOCAL a propósito: "¿sigue
// siendo agosto para quien mira?" es una pregunta local, y el resto del módulo
// evita `new Date()` sobre las fechas de las transacciones justamente para no
// mezclar las dos cosas.
export function monthProgress({ month, year }, now) {
  const ref = now ? new Date(now) : new Date()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isCurrentMonth = ref.getFullYear() === year && ref.getMonth() === month
  const daysElapsed = isCurrentMonth ? Math.min(ref.getDate(), daysInMonth) : daysInMonth
  return {
    isCurrentMonth,
    daysInMonth,
    daysElapsed,
    daysLeft: isCurrentMonth ? daysInMonth - ref.getDate() : 0,
    // El último día del mes ya es una ventana completa: ahí la comparación
    // vuelve a ser legítima.
    partialMonth: isCurrentMonth && daysElapsed < daysInMonth,
  }
}

// The full month view: totals + per-group breakdown with deltas vs previous
// month and vs the same month last year (null when there's no data to compare).
// `extras` folds read-only investment income (portfolio dividends) into each
// month's income/savings so the analysis and the summary cards tell the same
// story — a dividends-only month must not read as "you overspent".
export function computeMonthlyAnalysis(transactions, { month, year }, convert, extras = {}) {
  const { extraIncome = 0, prevExtraIncome = 0, yoyExtraIncome = 0, now } = extras
  const key = monthKeyOf(year, month)
  const prevKey = month === 0 ? monthKeyOf(year - 1, 11) : monthKeyOf(year, month - 1)
  const yoyKey = monthKeyOf(year - 1, month)
  const progress = monthProgress({ month, year }, now)

  const withExtra = (s, x) => (x > 0 ? { ...s, income: s.income + x, savings: s.income + x - s.expenses } : s)
  const current = withExtra(summarizeMonth(transactions, key, convert), extraIncome)
  const prevSummary = withExtra(summarizeMonth(transactions, prevKey, convert), prevExtraIncome)
  const yoySummary = withExtra(summarizeMonth(transactions, yoyKey, convert), yoyExtraIncome)
  const hasPrev = prevSummary.txCount > 0
  const hasYoY = yoySummary.txCount > 0

  // Las categorías de un grupo, ordenadas de mayor a menor. Suman exactamente
  // el monto del grupo porque salen del mismo recorrido que lo produjo.
  // Se conserva todo lo que se movió, en cualquier dirección: una categoría
  // puede quedar NEGATIVA cuando los reembolsos del mes superan lo gastado en
  // ella (una devolución que cae en un mes distinto al de la compra). Filtrarla
  // la haría desaparecer del desglose mientras sigue contando en el total del
  // grupo, o sea las partes dejarían de sumar el todo.
  const catRowsOf = (map, gk) => Object.entries(map[gk] || {})
    .map(([category, amount]) => ({ category, amount }))
    .filter((c) => c.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))

  const groups = [...EXPENSE_GROUPS, OTHER_GROUP].map((g) => {
    const cur = current.byGroup[g.key] || 0
    const prev = hasPrev ? (prevSummary.byGroup[g.key] || 0) : null
    const yoy = hasYoY ? (yoySummary.byGroup[g.key] || 0) : null
    return {
      key: g.key, label: g.label, labelEn: g.labelEn, icon: g.icon, color: g.color,
      amount: cur,
      prevAmount: prev,
      yoyAmount: yoy,
      momPct: hasPrev ? pctDelta(cur, prev) : null,
      yoyPct: hasYoY ? pctDelta(cur, yoy) : null,
      pctOfTotal: current.expenses > 0 ? (cur / current.expenses) * 100 : 0,
      comparable: isComparable(cur, prev, progress.partialMonth),
      categories: catRowsOf(current.catByGroup, g.key),
    }
  // Un grupo se muestra si hubo movimiento en cualquiera de las tres ventanas,
  // en cualquier DIRECCIÓN: `> 0` escondía un grupo cuyo neto quedó negativo
  // porque los reembolsos del mes superaron lo gastado, y ese grupo sí cuenta
  // en el total de arriba. La fila desaparecía mientras su dinero seguía
  // adentro, así que las partes dejaban de sumar el todo.
  }).filter((g) => g.amount !== 0 || (g.prevAmount || 0) !== 0 || (g.yoyAmount || 0) !== 0)

  // El lado del ingreso, con la MISMA forma que el del gasto para que una sola
  // vista pueda dibujar los dos. Antes se armaba a mano en la página, saltando
  // el grupo `autoOnly`, y por eso un depósito importado como 'Inversiones' no
  // aparecía en ningún lado aunque sí contara en el total.
  const incomeGroups = INCOME_GROUPS.map((g) => {
    const fromTx = current.incomeByGroup[g.key] || 0
    // El ingreso de inversión no es una transacción de Flujo: viene de los
    // dividendos del portafolio. Se le da su propia fila DENTRO de su grupo
    // para que las filas sigan sumando el grupo, y el grupo el total.
    const auto = g.autoOnly ? (extraIncome || 0) : 0
    const prev = hasPrev
      ? (prevSummary.incomeByGroup[g.key] || 0) + (g.autoOnly ? (prevExtraIncome || 0) : 0)
      : null
    const cur = fromTx + auto
    const rows = catRowsOf(current.incomeCatByGroup, g.key)
    if (auto > 0) rows.unshift({ category: 'Inversiones', amount: auto, auto: true })
    return {
      key: g.key, label: g.label, labelEn: g.labelEn, icon: g.icon,
      color: g.color || '#06b6d4',
      autoOnly: !!g.autoOnly,
      amount: cur,
      prevAmount: prev,
      momPct: hasPrev ? pctDelta(cur, prev) : null,
      pctOfTotal: current.income > 0 ? (cur / current.income) * 100 : 0,
      comparable: isComparable(cur, prev, progress.partialMonth),
      categories: rows,
    }
  }).filter((g) => g.amount > 0 || (g.prevAmount || 0) > 0)

  // El ingreso del mes se ve SIN CARGAR: hay gastos, no hay nada de ingreso
  // recurrente, y lo gastado dobla a lo que entró. Es lo que de verdad pasa
  // cuando un ahorro sale en -245%: no es que se gastara tres veces el sueldo,
  // es que el sueldo todavía no está registrado.
  const recurringIncome = (current.incomeByGroup.fijos || 0) + (current.incomeByGroup.side || 0)
  const incomeLooksUnlogged = current.expenses > 0 && recurringIncome === 0
    && current.expenses > current.income * 2

  return {
    key,
    status: getMonthStatus(transactions, key),
    income: current.income,
    expenses: current.expenses,
    savings: current.savings,
    savingsRate: current.income > 0 ? (current.savings / current.income) * 100 : null,
    txCount: current.txCount,
    hormigaCount: current.hormigaCount,
    hormigaSum: current.hormigaSum,
    groups,
    incomeGroups,
    incomeLooksUnlogged,
    ...progress,
    // Los totales del encabezado se callan por la misma razón que las filas:
    // media ventana contra una completa.
    momComparable: hasPrev && !progress.partialMonth,
    prev: hasPrev ? { key: prevKey, income: prevSummary.income, expenses: prevSummary.expenses, savings: prevSummary.savings } : null,
    yoy: hasYoY ? { key: yoyKey, income: yoySummary.income, expenses: yoySummary.expenses, savings: yoySummary.savings } : null,
    momExpensesPct: hasPrev ? pctDelta(current.expenses, prevSummary.expenses) : null,
    momIncomePct: hasPrev ? pctDelta(current.income, prevSummary.income) : null,
    yoyExpensesPct: hasYoY ? pctDelta(current.expenses, yoySummary.expenses) : null,
  }
}

// The sign goes OUTSIDE the currency mark: `Q${-1234}` reads "Q-1,234".
const fmtQ = (n) => {
  const v = Math.round(n) || 0
  return `${v < 0 ? '-' : ''}Q${Math.abs(v).toLocaleString()}`
}

// Actionable, plain-language insights out of the analysis. Ordered by impact;
// callers slice to taste.
export function buildFinanceInsights(analysis, lang = 'es') {
  const t = (es, en) => (lang === 'es' ? es : en)
  const out = []
  if (!analysis || analysis.txCount === 0) return out

  // El movimiento más grande contra el mes pasado.
  //
  // Antes esto ordenaba por `Math.abs(momPct)` sobre TODA fila con un mes
  // anterior, y así un −100% resultaba matemáticamente imbatible: un grupo que
  // simplemente no tiene datos todavía ganaba siempre, y los dos cupos
  // quedaban estructuralmente reservados para grupos vacíos. El piso de Q200
  // tampoco ayudaba: se cumplía con el mes ANTERIOR solo, así que un grupo en
  // Q0 hoy con Q5,683 el mes pasado pasaba el filtro.
  //
  // Ahora `comparable` exige que las dos ventanas midan lo mismo y que la fila
  // tenga monto hoy, y el piso pasa a ser el DINERO que se movió (no el saldo
  // de un mes suelto): Q5,000 → Q100 sigue siendo noticia, Q10 → Q30 no.
  const movers = analysis.groups
    .filter((g) => g.comparable && Math.abs(g.momPct) >= 15 && Math.abs(g.amount - g.prevAmount) >= 200)
    // Desempate por dinero movido: con el orden viejo, los empates se rompían
    // por posición en el arreglo, y por eso Vivienda (Q5,683) salía antes que
    // Financiero (Q46,330).
    .sort((a, b) => (Math.abs(b.momPct) - Math.abs(a.momPct))
      || (Math.abs(b.amount - b.prevAmount) - Math.abs(a.amount - a.prevAmount)))
  for (const g of movers.slice(0, 2)) {
    const dir = g.momPct >= 0 ? t('subió', 'went up') : t('bajó', 'went down')
    out.push({
      severity: g.momPct >= 0 ? 'warn' : 'good',
      textEs: `${g.icon} ${g.label} ${dir} ${Math.abs(g.momPct).toFixed(0)}% vs el mes pasado (${fmtQ(g.prevAmount)} → ${fmtQ(g.amount)}).`,
      textEn: `${g.icon} ${g.labelEn} ${dir} ${Math.abs(g.momPct).toFixed(0)}% vs last month (${fmtQ(g.prevAmount)} → ${fmtQ(g.amount)}).`,
    })
  }

  // Contra el mismo mes del año pasado. Mismo cuidado que arriba: con el mes en
  // curso son 18 días contra 31, y el porcentaje habla del calendario.
  if (!analysis.partialMonth && analysis.yoyExpensesPct != null && Math.abs(analysis.yoyExpensesPct) >= 10) {
    const dir = analysis.yoyExpensesPct >= 0 ? t('más', 'more') : t('menos', 'less')
    out.push({
      severity: analysis.yoyExpensesPct >= 0 ? 'warn' : 'good',
      textEs: `Gastas ${Math.abs(analysis.yoyExpensesPct).toFixed(0)}% ${dir} que en ${analysis.yoy.key} (${fmtQ(analysis.yoy.expenses)} → ${fmtQ(analysis.expenses)}).`,
      textEn: `You spend ${Math.abs(analysis.yoyExpensesPct).toFixed(0)}% ${dir} than in ${analysis.yoy.key} (${fmtQ(analysis.yoy.expenses)} → ${fmtQ(analysis.expenses)}).`,
    })
  }

  // Tasa de ahorro. Cuando el ingreso se ve sin cargar, el aviso de la tarjeta
  // ya lo explica mejor: repetirlo acá como "gastaste de más" afirmaría algo
  // sobre el gasto cuando el problema está en el ingreso que falta.
  if (analysis.savingsRate != null && !analysis.incomeLooksUnlogged) {
    if (analysis.savingsRate < 0) {
      out.push({
        severity: 'warn',
        textEs: `Este mes gastaste ${fmtQ(-analysis.savings)} más de lo que ingresó.`,
        textEn: `This month you spent ${fmtQ(-analysis.savings)} more than you earned.`,
      })
    } else if (analysis.savingsRate >= 25) {
      out.push({
        severity: 'good',
        textEs: `Tasa de ahorro del ${analysis.savingsRate.toFixed(0)}%: sólida.`,
        textEn: `Savings rate of ${analysis.savingsRate.toFixed(0)}%: solid.`,
      })
    }
  }

  // Ant expenses
  if (analysis.hormigaCount >= 10 && analysis.expenses > 0 && analysis.hormigaSum / analysis.expenses >= 0.08) {
    out.push({
      severity: 'info',
      textEs: `${analysis.hormigaCount} gastos hormiga (< Q75) suman ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% del gasto del mes.`,
      textEn: `${analysis.hormigaCount} small spends (< Q75) add up to ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% of the month.`,
    })
  }

  // Concentration: one group dominating
  const top = [...analysis.groups].sort((a, b) => b.amount - a.amount)[0]
  if (top && top.pctOfTotal >= 45 && analysis.expenses > 0) {
    out.push({
      severity: 'info',
      textEs: `${top.icon} ${top.label} se lleva el ${top.pctOfTotal.toFixed(0)}% de tus gastos del mes.`,
      textEn: `${top.icon} ${top.labelEn} takes ${top.pctOfTotal.toFixed(0)}% of this month's spending.`,
    })
  }

  return out
}

// Investment income of the month, READ-ONLY from portfolio DIVIDEND
// transactions (cash only — reinvested payments never hit the user's pocket).
// Same aggregation as the dashboard's DividendIncome card, converted to GTQ.
export function investmentIncomeOfMonth(portfolioTransactions, { month, year }, convert, portfolioItems = null) {
  const key = monthKeyOf(year, month)
  // FASE JW: la regla compartida. El comentario de arriba ya decía "cash only,
  // los reinvertidos nunca llegan al bolsillo", pero el filtro miraba solo la
  // bandera, que se estampa al escribir: un pago anterior a que la cuenta
  // pasara a reinvertir entraba como ingreso de Flujo sin haber tocado ninguna
  // cuenta bancaria. Sin items pasa lo de siempre (solo la bandera).
  const byId = reinvestIndex(portfolioItems)
  let total = 0
  let count = 0
  for (const tx of portfolioTransactions || []) {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND') continue
    if (isReinvestedDividend(tx, byId)) continue
    if (typeof tx.date !== 'string' || !tx.date.startsWith(key)) continue
    const amt = Number(tx.totalAmount ?? tx.amount) || 0
    if (!(amt > 0)) continue
    total += txAmount({ amount: amt, currency: tx.currency || 'USD' }, convert)
    count += 1
  }
  return { total, count }
}
