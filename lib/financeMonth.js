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
  incomeGroupOfCategory, INCOME_GROUPS, isTransferCategory,
} from '@/lib/financeCategories'

export const FINANCE_CURRENCY = 'GTQ'

export function monthKeyOf(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// Cómo se MUESTRA una fecha de Flujo: DD/MM/YYYY (decisión del usuario, 20 ago
// 2026). El dato guardado sigue siendo 'YYYY-MM-DD' — todo este módulo compara
// prefijos de mes sobre ese formato y el orden lexicográfico ES el cronológico,
// así que el formato de pantalla vive solo en el render.
//
// Por RECORTE DE TEXTO a propósito, jamás new Date(): JS lee 'YYYY-MM-DD' como
// medianoche UTC, y en Guatemala (UTC-6) getDate() devuelve el día ANTERIOR —
// cada fecha se mostraría corrida un día. Es la misma trampa que la cabecera de
// este archivo ya prohíbe para comparar.
export function formatFinanceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '')
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
  const txs = txsOfMonth(transactions, key).filter((t) => !isTransferCategory(t.category))
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
    // Dinero que se movió entre cuentas propias: no entra por ningún lado, ni
    // en los totales ni en el desglose. Si entrara, las dos caras del mes se
    // inflarían por el mismo monto (ver lib/cardPaymentNetting.js).
    if (isTransferCategory(tx.category)) continue
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
//
// ⛔ FLUJO Y PATRIMONIO SON DOS SEGMENTOS SEPARADOS (decisión del usuario,
// 20 ago 2026: "Flujo es separado a inversión... son dos segmentos por
// aparte"). Este motor mide SOLO las transacciones de Flujo. Nada del
// portafolio entra acá: ni dividendos, ni intereses, ni rendimiento.
//
// Antes había un parámetro `extras` que inyectaba el ingreso por dividendos del
// portafolio en el ingreso y el ahorro de cada mes, con el argumento de que "un
// mes de solo dividendos no debe leerse como que gastaste de más". El costo de
// eso era peor que el problema: la pantalla afirmaba a la vez "Falta un lado"
// (no hay ninguna fila de ingreso registrada, que se calcula sobre las filas
// crudas) y "Entró Q237.39", con un ahorro de +20.2% medido contra dinero que
// el usuario nunca registró en Flujo. Las dos cosas eran ciertas por separado y
// juntas la pantalla se contradecía.
//
// El sentido inverso ya estaba bien y hay que mantenerlo: ningún motor de
// retorno del portafolio lee `financeTransactions`, así que registrar un
// ingreso en Flujo no puede mover un rendimiento.
export function computeMonthlyAnalysis(transactions, { month, year }, convert, extras = {}) {
  const { now } = extras
  const key = monthKeyOf(year, month)
  const prevKey = month === 0 ? monthKeyOf(year - 1, 11) : monthKeyOf(year, month - 1)
  const yoyKey = monthKeyOf(year - 1, month)
  const progress = monthProgress({ month, year }, now)

  const current = summarizeMonth(transactions, key, convert)
  const prevSummary = summarizeMonth(transactions, prevKey, convert)
  const yoySummary = summarizeMonth(transactions, yoyKey, convert)
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
  // vista pueda dibujar los dos. Todo sale de transacciones de Flujo: acá ya no
  // se inyecta ninguna fila sintética del portafolio.
  const incomeGroups = INCOME_GROUPS.map((g) => {
    const cur = current.incomeByGroup[g.key] || 0
    const prev = hasPrev ? (prevSummary.incomeByGroup[g.key] || 0) : null
    const rows = catRowsOf(current.incomeCatByGroup, g.key)
    return {
      key: g.key, label: g.label, labelEn: g.labelEn, icon: g.icon,
      color: g.color || '#06b6d4',
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
  //
  // Y las dos ramas NO se tratan igual en un mes en curso, porque no tienen la
  // misma verdad. El sueldo cae UNA vez y los gastos llegan repartidos, así que
  // a mitad de mes la tasa está inflada por el calendario:
  //
  //   · FELICITAR es lo que no se sostiene. El día 4, con el sueldo adentro y
  //     dos gastos registrados, la tasa da ~97% y salía "Tasa de ahorro del
  //     97%: sólida", o sea la app felicitando por un mes que no ha pasado.
  //     Los gastos que faltan solo pueden BAJAR ese número.
  //   · AVISAR que gastaste más de lo que entró SÍ es cierto hoy, y solo puede
  //     volverse más cierto con lo que falta del mes. Ese se queda, pero
  //     hablando de lo que va del mes, no del mes entero.
  if (analysis.savingsRate != null && !analysis.incomeLooksUnlogged) {
    if (analysis.savingsRate < 0) {
      out.push({
        severity: 'warn',
        textEs: analysis.partialMonth
          ? `Llevas ${fmtQ(-analysis.savings)} gastados de más de lo que ha ingresado este mes.`
          : `Este mes gastaste ${fmtQ(-analysis.savings)} más de lo que ingresó.`,
        textEn: analysis.partialMonth
          ? `So far this month you have spent ${fmtQ(-analysis.savings)} more than has come in.`
          : `This month you spent ${fmtQ(-analysis.savings)} more than you earned.`,
      })
    } else if (analysis.savingsRate >= 25 && !analysis.partialMonth) {
      out.push({
        severity: 'good',
        textEs: `Tasa de ahorro del ${analysis.savingsRate.toFixed(0)}%: sólida.`,
        textEn: `Savings rate of ${analysis.savingsRate.toFixed(0)}%: solid.`,
      })
    }
  }

  // Gastos hormiga. La proporción acá NO la distorsiona el calendario (el
  // numerador y el denominador salen de la MISMA ventana, y los gastos chicos y
  // los grandes se acumulan a la par), así que en un mes en curso el número
  // sigue siendo cierto: lo único que había que corregir es que decía "del mes"
  // sobre un mes a medias.
  const partialSuffixEs = analysis.partialMonth ? 'de lo que va del mes' : 'del gasto del mes'
  const partialSuffixEn = analysis.partialMonth ? 'of the month so far' : 'of the month'
  if (analysis.hormigaCount >= 10 && analysis.expenses > 0 && analysis.hormigaSum / analysis.expenses >= 0.08) {
    out.push({
      severity: 'info',
      textEs: `${analysis.hormigaCount} gastos hormiga (< Q75) suman ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% ${partialSuffixEs}.`,
      textEn: `${analysis.hormigaCount} small spends (< Q75) add up to ${fmtQ(analysis.hormigaSum)}: ${((analysis.hormigaSum / analysis.expenses) * 100).toFixed(0)}% ${partialSuffixEn}.`,
    })
  }

  // Concentración: un grupo dominando. Igual que arriba, la proporción es
  // interna a la ventana y no la mueve el calendario, pero con dos o tres
  // movimientos registrados "Alimentación se lleva el 100%" es aritmética, no
  // una forma: hace falta un mínimo de movimientos para que describa un patrón
  // (mismo criterio de conteo que ya usa el bloque de gastos hormiga).
  const MIN_TX_FOR_SHAPE = 8
  const top = [...analysis.groups].sort((a, b) => b.amount - a.amount)[0]
  if (top && top.pctOfTotal >= 45 && analysis.expenses > 0 && analysis.txCount >= MIN_TX_FOR_SHAPE) {
    out.push({
      severity: 'info',
      textEs: `${top.icon} ${top.label} se lleva el ${top.pctOfTotal.toFixed(0)}% ${analysis.partialMonth ? 'de lo que llevas gastado este mes' : 'de tus gastos del mes'}.`,
      textEn: `${top.icon} ${top.labelEn} takes ${top.pctOfTotal.toFixed(0)}% of ${analysis.partialMonth ? 'what you have spent so far this month' : "this month's spending"}.`,
    })
  }

  return out
}

// `investmentIncomeOfMonth` vivía acá y se eliminó junto con el auto-jalado:
// era su único consumidor. El ingreso por dividendos es de Patrimonio y ya se
// agrega ahí (lib/serverPortfolio.js para los correos, la card DividendIncome
// para el tablero). Dejarlo exportado sin callers es cómo alguien lo vuelve a
// conectar a Flujo por error.
