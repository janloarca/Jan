export async function generateReport({ items, snapshots, transactions, netWorth, totalAssets, lang }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  const t = (es, en) => lang === 'es' ? es : en
  const now = new Date()
  const dateStr = now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const pageW = doc.internal.pageSize.getWidth()
  let y = 20

  const addLine = () => { doc.setDrawColor(30, 45, 69); doc.line(15, y, pageW - 15, y); y += 6 }
  const checkPage = () => { if (y > 270) { doc.addPage(); y = 20 } }

  // Header
  doc.setFontSize(22)
  doc.setTextColor(16, 185, 129)
  doc.text('Chispudo', 15, y)
  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  doc.text(t('Reporte de Portfolio', 'Portfolio Report'), 60, y)
  y += 6
  doc.setFontSize(9)
  doc.text(dateStr, 15, y)
  y += 10
  addLine()

  // Summary
  doc.setFontSize(14)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Resumen', 'Summary'), 15, y)
  y += 8

  doc.setFontSize(10)
  doc.setTextColor(148, 163, 184)
  const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0)

  const summaryLines = [
    [t('Patrimonio neto', 'Net Worth'), fmt(netWorth)],
    [t('Activos totales', 'Total Assets'), fmt(totalAssets)],
    [t('Posiciones', 'Holdings'), items.length.toString()],
    ['Snapshots', snapshots.length.toString()],
    [t('Transacciones', 'Transactions'), transactions.length.toString()],
  ]

  summaryLines.forEach(([label, value]) => {
    doc.setTextColor(148, 163, 184)
    doc.text(label, 20, y)
    doc.setTextColor(241, 245, 249)
    doc.text(value, 100, y)
    y += 6
  })
  y += 4
  addLine()

  // Allocation
  const byType = {}
  let total = 0
  items.forEach((it) => {
    const val = (it.quantity || 0) * (it.purchasePrice || 0)
    const type = it.type || 'Other'
    byType[type] = (byType[type] || 0) + val
    total += val
  })

  doc.setFontSize(14)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Asignación de activos', 'Asset Allocation'), 15, y)
  y += 8

  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, value]) => {
    checkPage()
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
    doc.setFontSize(9)
    doc.setTextColor(148, 163, 184)
    doc.text(type, 20, y)
    doc.setTextColor(241, 245, 249)
    doc.text(`${pct}%`, 80, y)
    doc.text(fmt(value), 100, y)
    y += 5.5
  })
  y += 4
  addLine()

  // Holdings table
  doc.setFontSize(14)
  doc.setTextColor(241, 245, 249)
  doc.text(t('Posiciones', 'Holdings'), 15, y)
  y += 8

  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(t('Instrumento', 'Instrument'), 15, y)
  doc.text(t('Tipo', 'Type'), 65, y)
  doc.text(t('Cantidad', 'Qty'), 95, y)
  doc.text(t('Precio', 'Price'), 120, y)
  doc.text(t('Valor', 'Value'), 150, y)
  doc.text(t('Institución', 'Institution'), 175, y)
  y += 5

  const sorted = [...items].sort((a, b) => {
    const va = (a.quantity || 0) * (a.purchasePrice || 0)
    const vb = (b.quantity || 0) * (b.purchasePrice || 0)
    return vb - va
  })

  sorted.forEach((item) => {
    checkPage()
    const val = (item.quantity || 0) * (item.purchasePrice || 0)
    doc.setFontSize(8)
    doc.setTextColor(241, 245, 249)
    doc.text((item.name || item.symbol || '').slice(0, 20), 15, y)
    doc.setTextColor(148, 163, 184)
    doc.text((item.type || '-').slice(0, 12), 65, y)
    doc.text(String(item.quantity || 0), 95, y)
    doc.text(fmt(item.purchasePrice), 120, y)
    doc.setTextColor(16, 185, 129)
    doc.text(fmt(val), 150, y)
    doc.setTextColor(148, 163, 184)
    doc.text((item.institution || '-').slice(0, 12), 175, y)
    y += 5
  })
  y += 4

  // Recent transactions
  if (transactions.length > 0) {
    checkPage()
    addLine()
    doc.setFontSize(14)
    doc.setTextColor(241, 245, 249)
    doc.text(t('Transacciones recientes', 'Recent Transactions'), 15, y)
    y += 8

    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(t('Fecha', 'Date'), 15, y)
    doc.text(t('Tipo', 'Type'), 45, y)
    doc.text(t('Símbolo', 'Symbol'), 70, y)
    doc.text('Total', 120, y)
    y += 5

    const recentTx = [...transactions].reverse().slice(0, 20)
    recentTx.forEach((tx) => {
      checkPage()
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text(tx.date || '-', 15, y)
      doc.text((tx.type || '-').toUpperCase(), 45, y)
      doc.setTextColor(241, 245, 249)
      doc.text(tx.symbol || tx.description || '-', 70, y)
      doc.text(fmt(tx.totalAmount ?? 0), 120, y)
      y += 5
    })
  }

  // Footer
  y = doc.internal.pageSize.getHeight() - 10
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.text(`Chispudo · ${t('Generado el', 'Generated on')} ${dateStr}`, 15, y)

  doc.save(`chispudo-report-${now.toISOString().split('T')[0]}.pdf`)
}
