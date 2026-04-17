'use client'

export default function MonthlyPerformance({ snapshots, lang }) {
  if (!snapshots || snapshots.length < 2) return null

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Group snapshots by year, compute monthly returns
  const byYear = {}
  snapshots.forEach((s) => {
    const d = new Date(s.date)
    const year = d.getFullYear()
    const month = d.getMonth()
    if (!byYear[year]) byYear[year] = {}
    byYear[year][month] = s.netWorthUSD ?? s.totalActivosUSD ?? 0
  })

  const years = Object.keys(byYear).sort()
  const allValues = snapshots.map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0)

  // Compute monthly % changes
  const rows = years.map((year) => {
    const data = byYear[year]
    const monthlyReturns = []
    let yearTotal = 0

    for (let m = 0; m < 12; m++) {
      if (data[m] == null) {
        monthlyReturns.push(null)
        continue
      }
      // Find previous month value
      let prev = null
      if (m > 0 && data[m - 1] != null) {
        prev = data[m - 1]
      } else if (m === 0) {
        const prevYear = byYear[parseInt(year) - 1]
        if (prevYear && prevYear[11] != null) prev = prevYear[11]
      }
      if (prev && prev > 0) {
        const ret = ((data[m] - prev) / prev) * 100
        monthlyReturns.push(ret)
        yearTotal = ((data[m] - (data[0] ?? prev)) / (data[0] ?? prev)) * 100
      } else {
        monthlyReturns.push(null)
      }
    }

    // Year total: first month of year vs last available
    const monthValues = Object.values(data).filter(Boolean)
    if (monthValues.length >= 2) {
      yearTotal = ((monthValues[monthValues.length - 1] - monthValues[0]) / monthValues[0]) * 100
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
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        MONTHLY PERFORMANCE
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
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
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cellColor(val)}`}>
                        {val > 0 ? '+' : ''}{val.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                ))}
                <td className="text-center py-1.5 px-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${cellColor(row.total)}`}>
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
