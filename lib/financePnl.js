// El mes como un ESTADO DE RESULTADOS, que es como se lee un P&L de verdad.
//
// Lo que un P&L institucional tiene y esta pantalla no tenía:
//
//  1. ORDEN DE DERIVACIÓN. Se lee de arriba abajo y cada bloque explica al
//     siguiente: ingresos, menos los compromisos, menos lo discrecional, igual
//     al resultado. No es una pila de tarjetas independientes.
//  2. COLUMNA COMÚN (common-size): cada línea como % del INGRESO. Es la columna
//     que convierte un número en un juicio sin una sola palabra de prosa
//     ("Vivienda se lleva el 26% de lo que entra"), y es el estándar de
//     cualquier income statement.
//  3. FIJO vs VARIABLE. La partición de un P&L de hogar: un compromiso llega
//     igual quieras o no, lo variable es lo que de verdad se puede mover este
//     mes. De ahí sale la única razón por la que un mes malo es accionable.
//  4. SUBTOTAL POR SECCIÓN con su variación, no solo el total del mes.
//
// ⛔ ESTE MÓDULO NO SUMA NADA POR SU CUENTA. Consume las categorías que
// `computeMonthlyAnalysis` ya produjo (que por construcción suman exactamente
// sus grupos y su total) y solo las RE-SECCIONA. Por eso las dos secciones
// siempre suman el gasto del mes: no hay un segundo motor que pueda discrepar.
// Es la lección de FASE HT: dos generadores del mismo número divergen.

// El denominador de la columna común es el INGRESO, y si no hay ingreso no hay
// columna. Un porcentaje sobre cero no es 0%, es una división que no se puede
// hacer, y un mes sin el sueldo registrado es justo el caso común.
function pctOf(amount, base) {
  if (!(base > 0)) return null
  return (amount / base) * 100
}

function pctDelta(current, previous) {
  if (previous == null || !(previous > 0)) return null
  return ((current - previous) / previous) * 100
}

function rowsFrom(groups, prevMap, model, { income, momComparable }) {
  const out = []
  for (const g of groups || []) {
    for (const c of g.categories || []) {
      const entry = model?.entry ? model.entry(c.category) : null
      const prevAmount = prevMap ? (prevMap[c.category] ?? 0) : null
      out.push({
        key: c.category,
        label: entry ? entry.label : c.category,
        labelEn: entry ? entry.labelEn : c.category,
        amount: c.amount,
        // El color viene del GRUPO, no de la categoría: la dona agrupa y el
        // estado lista, y las dos superficies tienen que hablar el mismo
        // idioma de color sobre el mismo dinero.
        color: entry?.color || g.color,
        groupKey: entry?.groupKey || g.key,
        groupLabel: entry?.groupLabel || g.label,
        groupLabelEn: entry?.groupLabelEn || g.labelEn || g.label,
        fixed: entry ? entry.fixed : false,
        pctOfIncome: pctOf(c.amount, income),
        prevAmount,
        momPct: prevAmount != null ? pctDelta(c.amount, prevAmount) : null,
        // La misma regla que el resto de la pantalla: las dos ventanas tienen
        // que medir lo mismo, la fila tiene que tener monto hoy, y el mes
        // anterior tiene que tener base. Ver isComparable en financeMonth.js.
        comparable: !!momComparable && c.amount > 0 && (prevAmount || 0) > 0,
      })
    }
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

function sectionOf(rows, { income, momComparable, hasPrev }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const prevTotal = hasPrev ? rows.reduce((s, r) => s + (r.prevAmount || 0), 0) : null
  return {
    rows,
    total,
    prevTotal,
    pctOfIncome: pctOf(total, income),
    momPct: prevTotal != null ? pctDelta(total, prevTotal) : null,
    comparable: !!momComparable && total > 0 && (prevTotal || 0) > 0,
  }
}

/**
 * El estado de resultados del mes que `analysis` describe.
 *
 * @param analysis salida de computeMonthlyAnalysis
 * @param model    salida de resolveCategoryModel (decide fijo/variable y rótulo)
 */
export function buildPnlStatement(analysis, model) {
  if (!analysis) return null
  const income = analysis.income || 0
  const momComparable = analysis.momComparable
  const hasPrev = !!analysis.prev

  const incomeRows = rowsFrom(analysis.incomeGroups, analysis.prevIncomeCategories, model, { income, momComparable })
  const expenseRows = rowsFrom(analysis.groups, analysis.prevCategories, model, { income, momComparable })

  // La sección la decide la CATEGORÍA (model.isFixed), no el grupo: un grupo
  // puede tener adentro un compromiso y un gasto discrecional, y meterlos en la
  // misma sección sería exactamente perder la distinción que hace útil el
  // estado.
  const fixed = sectionOf(expenseRows.filter((r) => r.fixed), { income, momComparable, hasPrev })
  const variable = sectionOf(expenseRows.filter((r) => !r.fixed), { income, momComparable, hasPrev })
  const incomeSection = sectionOf(incomeRows, { income, momComparable, hasPrev })

  const expenses = fixed.total + variable.total
  const bottom = income - expenses

  return {
    income: incomeSection,
    fixed,
    variable,
    expensesTotal: expenses,
    expensesPctOfIncome: pctOf(expenses, income),
    bottom: {
      amount: bottom,
      pctOfIncome: pctOf(bottom, income),
      surplus: bottom >= 0,
    },
    // Cuánto del ingreso ya está comprometido antes de decidir nada. Es la
    // cifra más accionable de un P&L de hogar y se lee de una: arriba del 50%
    // un mes flojo no se puede corregir recortando lo discrecional.
    committedPct: pctOf(fixed.total, income),
    // Los dos números que el encabezado ya mostraba, para que el estado no
    // tenga que re-derivarlos por su cuenta.
    hasIncome: income > 0,
  }
}
