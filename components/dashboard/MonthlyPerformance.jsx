'use client'

import { computeModifiedDietz } from './utils'

export default function MonthlyPerformance({ snapshots, transactions, convert, baseCurrency, lang }) {
  if (!snapshots || snapshots.length < 2) return null

  const months = lang === 'es'
    ? ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const sorted = [...snapshots]
    .map((s) => ({ ...s, ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
    .filter((s) => !isNaN(s.ts) && s.value > 0)
    .sort((a, b) => a.ts - b.ts)

  const byYear = {}
  sorted.forEach((s) => {
    const d = new Date(s.date)
    const year = d.getFullYear()
    const month = d.getMonth()
    if (!byYear[year]) byYear[year] = {}
    if (!byYear[year][month] || s.ts > byYear[year][month].ts) {
      byYear[year][month] = s
    }
  })

  const years = Object.keys(byYear).sort()

  const rows = years.map((year) => {
    const data = byYear[year]
    const monthlyReturns = []

    for (let m = 0; m < 12; m++) {
      if (!data[m]) {
        monthlyReturns.push(null)
        continue
      }
      let prevSnap = null
      if (m > 0 && data[m - 1]) {
        prevSnap = data[m - 1]
      } else if (m === 0) {
        const prevYear = byYear[parseInt(year) - 1]
        if (prevYear && prevYear[11]) prevSnap = prevYear[11]
      }
      if (prevSnap && prevSnap.value > 0) {
        if (transactions && convert) {
          const { pct } = computeModifiedDietz({
            startValue: prevSnap.value, endValue: data[m].value,
            startTs: prevSnap.ts, endTs: data[m].ts,
            transactions, convert, baseCurrency,
          })
          monthlyReturns.push(pct)
        } else {
          monthlyReturns.push(((data[m].value - prevSnap.value) / prevSnap.value) * 100)
        }
      } else {
        monthlyReturns.push(null)
      }
    }

    const monthKeys = Object.keys(data).map(Number).sort((a, b) => a - b)
    let yearTotal = 0
    if (monthKeys.length >= 2) {
      const first = data[monthKeys[0]]
      const last = data[monthKeys[monthKeys.length - 1]]
      if (first.value > 0 && transactions && convert) {
        const { pct } = computeModifiedDietz({
          startValue: first.value, endValue: last.value,
          startTs: first.ts, endTs: last.ts,
          transactions, convert, baseCurrency,
        })
        yearTotal = pct
      } else if (first.value > 0) {
        yearTotal = ((last.value - first.value) / first.value) * 100
      }
    }

    return { year, returns: monthlyReturns, total: yearTotal }
  })

  function cellColor(val) {
    if (val == null) return ''
    if (val > 10) return 'bg-emerald-500/40 text-emerald-300'
    if (val > 0) return 'bg-emerald-500/20 text-emerald-400'
    if (val > -5) return 'bg-red-500/20 text-red-400'
    return 'bg-red-500/40 text-red-300'
  }

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        MONTHLY PERFORMANCE
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1 pr-3 font-medium">Year</th>
              {months.map((m) => (
                <th key={m} className="text-center py-1 px-1 font-medium">{m}</th>
              ))}
              <th className="text-center py-1 px-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year}>
                <td className="text-slate-300 font-medium py-1.5 pr-3">{row.year}</td>
                {row.returns.map((val, i) => (
                  <td key={i} className="text-center py-1.5 px-0.5">
                    {val != null ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cellColor(val)}`}>
                        {val > 0 ? '+' : ''}{val.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                ))}
                <td className="text-center py-1.5 px-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${cellColor(row.total)}`}>
                    {row.total > 0 ? '+' : ''}{row.total.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
