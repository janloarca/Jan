export async function generateReport({ items, snapshots, transactions, netWorth, totalAssets, lang, returnYTD, annualDividends }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  const t = (es, en) => lang === 'es' ? es : en
  const now = new Date()
  const dateStr = now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0)
  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${(v || 0).toFixed(2)}%`

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // ═══ BACKGROUND ═══
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageW, pageH, 'F')

  // ═══ HEADER ═══
  doc.setFontSize(20)
  doc.setTextColor(16, 185, 129)
  doc.text('Chispudo', 15, 18)
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(t('Reporte de Portfolio', 'Portfolio Report'), 55, 18)
  doc.text(dateStr, pageW - 15, 18, { align: 'right' })

  // Separator
  doc.setDrawColor(30, 45, 69)
  doc.setLineWidth(0.3)
  doc.line(15, 23, pageW - 15, 23)

  // ═══ KEY METRICS ROW ═══
  const metricsY = 34
  const metrics = [
    { label: t('Patrimonio Neto', 'Net Worth'), value: fmt(netWorth), color: [241, 245, 249] },
    { label: t('Retorno YTD', 'YTD Return'), value: fmtPct(returnYTD || 0), color: (returnYTD || 0) >= 0 ? [16, 185, 129] : [239, 68, 68] },
    { label: t('Posiciones', 'Holdings'), value: String(items.length), color: [241, 245, 249] },
    { label: t('Dividendos/año', 'Annual Dividends'), value: fmt(annualDividends || 0), color: [16, 185, 129] },
  ]

  const metricW = (pageW - 30) / metrics.length
  metrics.forEach((m, i) => {
    const x = 15 + i * metricW
    doc.setFillColor(30, 41, 59)
    doc.roundedRect(x, metricsY - 6, metricW - 4, 20, 2, 2, 'F')

    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(m.label, x + (metricW - 4) / 2, metricsY, { align: 'center' })

    doc.setFontSize(14)
    doc.setTextColor(...m.color)
    doc.text(m.value, x + (metricW - 4) / 2, metricsY + 9, { align: 'center' })
  })

  // ═══ ASSET ALLOCATION DONUT (left side) ═══
  const chartStartY = 62
  doc.setFontSize(10)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Asignación de Activos', 'Asset Allocation'), 15, chartStartY)

  const byType = {}
  let totalVal = 0
  items.forEach((it) => {
    const val = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
    const type = it.type || 'Other'
    byType[type] = (byType[type] || 0) + val
    totalVal += val
  })

  const allocSorted = Object.entries(byType).sort((a, b) => b[1] - a[1])
  const colors = [
    [59, 130, 246], [16, 185, 129], [245, 158, 11], [168, 85, 247],
    [236, 72, 153], [6, 182, 212], [239, 68, 68], [132, 204, 22],
  ]

  // Draw donut
  const cx = 45
  const cy = chartStartY + 30
  const outerR = 18
  const innerR = 10
  let startAngle = -Math.PI / 2

  allocSorted.forEach(([, value], i) => {
    const pct = totalVal > 0 ? value / totalVal : 0
    const endAngle = startAngle + pct * 2 * Math.PI
    const color = colors[i % colors.length]
    doc.setFillColor(...color)

    // Draw arc segment as filled shape
    const steps = Math.max(8, Math.ceil(pct * 40))
    const points = []
    for (let s = 0; s <= steps; s++) {
      const a = startAngle + (endAngle - startAngle) * (s / steps)
      points.push({ x: cx + Math.cos(a) * outerR, y: cy + Math.sin(a) * outerR })
    }
    for (let s = steps; s >= 0; s--) {
      const a = startAngle + (endAngle - startAngle) * (s / steps)
      points.push({ x: cx + Math.cos(a) * innerR, y: cy + Math.sin(a) * innerR })
    }

    doc.setFillColor(...color)
    const xArr = points.map((p) => p.x)
    const yArr = points.map((p) => p.y)
    // Use triangle fan approximation
    for (let j = 1; j < points.length - 1; j++) {
      doc.triangle(
        points[0].x, points[0].y,
        points[j].x, points[j].y,
        points[j + 1].x, points[j + 1].y,
        'F'
      )
    }
    startAngle = endAngle
  })

  // Inner circle (creates donut hole)
  doc.setFillColor(15, 23, 42)
  doc.circle(cx, cy, innerR, 'F')

  // Legend (right of donut)
  let legendY = chartStartY + 14
  allocSorted.slice(0, 7).forEach(([type, value], i) => {
    const pct = totalVal > 0 ? ((value / totalVal) * 100).toFixed(1) : '0.0'
    const color = colors[i % colors.length]
    doc.setFillColor(...color)
    doc.rect(72, legendY - 2.5, 3, 3, 'F')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(type.slice(0, 16), 77, legendY)
    doc.setTextColor(241, 245, 249)
    doc.text(`${pct}%`, 115, legendY, { align: 'right' })
    doc.setTextColor(100, 116, 139)
    doc.text(fmt(value), 140, legendY, { align: 'right' })
    legendY += 5.5
  })

  // ═══ TOP HOLDINGS BAR CHART (right side) ═══
  doc.setFontSize(10)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Top Posiciones', 'Top Holdings'), 148, chartStartY)

  const sorted = [...items]
    .map((it) => ({ ...it, value: (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const maxVal = sorted[0]?.value || 1
  const barStartY = chartStartY + 8
  const barX = 148
  const barMaxW = 45

  sorted.forEach((it, i) => {
    const y = barStartY + i * 8
    const barW = (it.value / maxVal) * barMaxW
    const retPct = it.purchasePrice > 0 && it.currentPrice ? ((it.currentPrice - it.purchasePrice) / it.purchasePrice) * 100 : null

    doc.setFillColor(30, 41, 59)
    doc.roundedRect(barX, y, barMaxW, 5, 1, 1, 'F')
    doc.setFillColor(16, 185, 129)
    if (barW > 1) doc.roundedRect(barX, y, barW, 5, 1, 1, 'F')

    doc.setFontSize(7)
    doc.setTextColor(241, 245, 249)
    doc.text((it.symbol || it.name || '').slice(0, 8), barX + 1, y + 3.5)

    doc.setTextColor(100, 116, 139)
    doc.text(fmt(it.value), barX + barMaxW + 2, y + 3.5)
  })

  // ═══ PORTFOLIO VALUE SPARKLINE ═══
  const sparkY = 115
  doc.setDrawColor(30, 45, 69)
  doc.line(15, sparkY - 3, pageW - 15, sparkY - 3)

  doc.setFontSize(10)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Evolución del Portfolio', 'Portfolio Growth'), 15, sparkY + 5)

  if (snapshots.length >= 2) {
    const sparkData = [...snapshots]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((s) => s.netWorthUSD ?? s.totalActivosUSD ?? 0)
      .filter((v) => v > 0)

    if (sparkData.length >= 2) {
      const sparkX = 15
      const sparkW = pageW - 30
      const sparkH = 35
      const sparkTop = sparkY + 10
      const min = Math.min(...sparkData)
      const max = Math.max(...sparkData)
      const range = max - min || 1

      // Grid lines
      doc.setDrawColor(30, 45, 69)
      doc.setLineWidth(0.1)
      for (let g = 0; g <= 3; g++) {
        const gy = sparkTop + (sparkH * g) / 3
        doc.line(sparkX, gy, sparkX + sparkW, gy)
      }

      // Y-axis labels
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text(fmt(max), sparkX - 1, sparkTop + 2, { align: 'right' })
      doc.text(fmt(min), sparkX - 1, sparkTop + sparkH, { align: 'right' })

      // Draw line
      doc.setDrawColor(59, 130, 246)
      doc.setLineWidth(0.8)
      const points = sparkData.map((v, i) => ({
        x: sparkX + (i / (sparkData.length - 1)) * sparkW,
        y: sparkTop + sparkH - ((v - min) / range) * sparkH,
      }))

      for (let i = 1; i < points.length; i++) {
        doc.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y)
      }

      // Fill under line
      doc.setFillColor(59, 130, 246)
      doc.setGState(new doc.GState({ opacity: 0.08 }))
      const fillPoints = [...points, { x: points[points.length - 1].x, y: sparkTop + sparkH }, { x: points[0].x, y: sparkTop + sparkH }]
      for (let j = 1; j < fillPoints.length - 1; j++) {
        doc.triangle(
          fillPoints[0].x, fillPoints[0].y,
          fillPoints[j].x, fillPoints[j].y,
          fillPoints[j + 1].x, fillPoints[j + 1].y, 'F'
        )
      }
      doc.setGState(new doc.GState({ opacity: 1 }))

      // X-axis dates
      doc.setFontSize(6)
      doc.setTextColor(100, 116, 139)
      const snapDates = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date))
      if (snapDates.length > 0) {
        doc.text(snapDates[0].date?.slice(0, 10) || '', sparkX, sparkTop + sparkH + 5)
        doc.text(snapDates[snapDates.length - 1].date?.slice(0, 10) || '', sparkX + sparkW, sparkTop + sparkH + 5, { align: 'right' })
      }

      // Start/end values
      doc.setFontSize(8)
      doc.setTextColor(59, 130, 246)
      doc.circle(points[points.length - 1].x, points[points.length - 1].y, 1.5, 'F')
    }
  } else {
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(t('Necesitas al menos 2 snapshots para ver la gráfica.', 'Need at least 2 snapshots to show chart.'), 15, sparkY + 15)
  }

  // ═══ PERFORMANCE METRICS ═══
  const perfY = 170
  doc.setDrawColor(30, 45, 69)
  doc.line(15, perfY - 3, pageW - 15, perfY - 3)

  doc.setFontSize(10)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Rendimiento', 'Performance'), 15, perfY + 5)

  // Monthly returns from snapshots
  if (snapshots.length >= 2) {
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date))
    const monthlyReturns = []
    for (let i = 1; i < sorted.length && monthlyReturns.length < 12; i++) {
      const prev = sorted[i - 1].netWorthUSD ?? sorted[i - 1].totalActivosUSD ?? 0
      const curr = sorted[i].netWorthUSD ?? sorted[i].totalActivosUSD ?? 0
      if (prev > 0) {
        const ret = ((curr - prev) / prev) * 100
        const d = new Date(sorted[i].date)
        monthlyReturns.push({ month: d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' }), ret })
      }
    }

    if (monthlyReturns.length > 0) {
      const barChartX = 15
      const barChartY = perfY + 12
      const barChartW = pageW - 30
      const barChartH = 30
      const barCount = monthlyReturns.length
      const barWidth = Math.min(12, (barChartW / barCount) * 0.7)
      const gap = barChartW / barCount
      const maxRet = Math.max(...monthlyReturns.map((r) => Math.abs(r.ret)), 1)
      const zeroY = barChartY + barChartH / 2

      // Zero line
      doc.setDrawColor(100, 116, 139)
      doc.setLineWidth(0.2)
      doc.line(barChartX, zeroY, barChartX + barChartW, zeroY)

      doc.setFontSize(6)
      doc.setTextColor(100, 116, 139)
      doc.text('0%', barChartX - 1, zeroY + 1, { align: 'right' })

      monthlyReturns.forEach((mr, i) => {
        const x = barChartX + i * gap + (gap - barWidth) / 2
        const barH = (Math.abs(mr.ret) / maxRet) * (barChartH / 2 - 4)

        if (mr.ret >= 0) {
          doc.setFillColor(16, 185, 129)
          doc.roundedRect(x, zeroY - barH, barWidth, barH, 1, 1, 'F')
        } else {
          doc.setFillColor(239, 68, 68)
          doc.roundedRect(x, zeroY, barWidth, barH, 1, 1, 'F')
        }

        doc.setFontSize(5.5)
        doc.setTextColor(100, 116, 139)
        doc.text(mr.month, x + barWidth / 2, barChartY + barChartH + 4, { align: 'center' })
      })
    }
  }

  // ═══ TOP 5 HOLDINGS TABLE (compact) ═══
  const tableY = 215
  doc.setDrawColor(30, 45, 69)
  doc.line(15, tableY - 3, pageW - 15, tableY - 3)

  doc.setFontSize(10)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Principales Posiciones', 'Top Positions'), 15, tableY + 5)

  const topItems = [...items]
    .map((it) => ({
      ...it,
      value: (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0),
      ret: it.purchasePrice > 0 && it.currentPrice ? ((it.currentPrice - it.purchasePrice) / it.purchasePrice) * 100 : null,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  // Table header
  let ty = tableY + 12
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.text(t('Instrumento', 'Instrument'), 15, ty)
  doc.text(t('Tipo', 'Type'), 60, ty)
  doc.text(t('Valor', 'Value'), 95, ty, { align: 'right' })
  doc.text('% Port.', 115, ty, { align: 'right' })
  doc.text('P&L %', 135, ty, { align: 'right' })
  doc.text(t('Institución', 'Institution'), 155, ty)
  ty += 1
  doc.setDrawColor(30, 45, 69)
  doc.line(15, ty, pageW - 15, ty)
  ty += 4

  topItems.forEach((it) => {
    const pctPort = totalVal > 0 ? ((it.value / totalVal) * 100).toFixed(1) : '0.0'
    doc.setFontSize(7.5)
    doc.setTextColor(241, 245, 249)
    doc.text((it.name || it.symbol || '').slice(0, 22), 15, ty)
    doc.setTextColor(148, 163, 184)
    doc.text((it.type || '-').slice(0, 12), 60, ty)
    doc.setTextColor(16, 185, 129)
    doc.text(fmt(it.value), 95, ty, { align: 'right' })
    doc.setTextColor(148, 163, 184)
    doc.text(`${pctPort}%`, 115, ty, { align: 'right' })
    if (it.ret != null) {
      doc.setTextColor(it.ret >= 0 ? 16 : 239, it.ret >= 0 ? 185 : 68, it.ret >= 0 ? 129 : 68)
      doc.text(fmtPct(it.ret), 135, ty, { align: 'right' })
    } else {
      doc.setTextColor(100, 116, 139)
      doc.text('—', 135, ty, { align: 'right' })
    }
    doc.setTextColor(100, 116, 139)
    doc.text((it.institution || '-').slice(0, 14), 155, ty)
    ty += 5.5
  })

  // ═══ FOOTER ═══
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.text(`Chispudo · chispu.xyz · ${t('Generado el', 'Generated on')} ${dateStr}`, pageW / 2, pageH - 8, { align: 'center' })

  doc.save(`chispudo-report-${now.toISOString().split('T')[0]}.pdf`)
}
