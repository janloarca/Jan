import { authFetch } from './authFetch'

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}

function rangeForMonths(months) {
  if (months.length === 0) return '1y'
  const [y] = months[0].split('-').map(Number)
  const yearsBack = new Date().getFullYear() - y + 1
  if (yearsBack <= 1) return '1y'
  return 'max'
}

function qtyAtMonth(lots, symbol, monthEnd) {
  let qty = 0
  for (const lot of lots) {
    if ((lot.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
    const acqDate = lot.acquisitionDate ? new Date(lot.acquisitionDate) : null
    if (acqDate && acqDate > monthEnd) continue
    if (lot.status === 'closed') {
      const closedDate = lot.closedDate ? new Date(lot.closedDate) : null
      if (closedDate && closedDate <= monthEnd) continue
      qty += lot.quantity || 0
    } else {
      qty += lot.quantity || 0
    }
  }
  return qty
}

function fillFallback(result, it, months) {
  const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
  const val = (it.quantity || 0) * (it.purchasePrice || 0)
  if (val <= 0) return
  months.forEach(mk => {
    if (acqDate && getMonthEndDate(mk) < acqDate) return
    if (!result[mk][it.id]) {
      result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
    }
  })
}

export async function getHistoricalItemValues(items, months, convert, baseCurrency, lots) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

  const hasLots = lots && lots.length > 0
  const lotSymbols = hasLots ? new Set(lots.map(l => (l.symbol || '').toUpperCase())) : new Set()

  const marketItems = items.filter(it =>
    it.symbol && /stock|crypto|fund|etf/i.test(it.type || '') && !/realestate|inmueble/i.test(it.type || '')
  )
  const staticItems = items.filter(it =>
    !it.symbol || !/stock|crypto|fund|etf/i.test(it.type || '') || /realestate|inmueble/i.test(it.type || '')
  )

  staticItems.forEach(it => {
    if (!it.id) return
    const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
    const val = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || it.price || it.cost || 0)
    months.forEach(mk => {
      if (acqDate && getMonthEndDate(mk) < acqDate) return
      result[mk][it.id] = { value: val, symbol: it.name || it.symbol || '', category: it._category || '', institution: it.institution || '' }
    })
  })

  const range = rangeForMonths(months)
  const BATCH_SIZE = 8
  for (let i = 0; i < marketItems.length; i += BATCH_SIZE) {
    const batch = marketItems.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (it) => {
      try {
        const res = await authFetch(`/api/prices/chart?symbol=${encodeURIComponent(it.symbol)}&range=${range}&interval=1mo`)
        if (!res.ok) { fillFallback(result, it, months); return }
        const data = await res.json()
        const prices = data.prices || []
        if (prices.length === 0) { fillFallback(result, it, months); return }

        const priceCurrency = data.currency || 'USD'
        const priceByMonth = {}
        prices.forEach(p => {
          if (p.close != null && p.date) {
            const mk = getMonthKey(new Date(p.date))
            priceByMonth[mk] = p.close
          }
        })

        const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
        const currentQty = it.quantity || 0
        const sym = (it.symbol || '').toUpperCase()
        const useLots = hasLots && lotSymbols.has(sym)

        months.forEach(mk => {
          const monthEnd = getMonthEndDate(mk)
          if (acqDate && monthEnd < acqDate && !useLots) return
          const price = priceByMonth[mk]

          let qty = useLots ? qtyAtMonth(lots, sym, monthEnd) : currentQty
          if (!useLots && qty <= 0 && currentQty > 0 && (!acqDate || monthEnd >= acqDate)) qty = currentQty
          if (qty <= 0) return

          if (price != null) {
            let val = qty * price
            if (convert && priceCurrency !== baseCurrency) {
              val = convert(val, priceCurrency, baseCurrency || 'USD')
            }
            result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
          } else if (!result[mk][it.id]) {
            let val = qty * (it.purchasePrice || 0)
            if (val > 0) {
              result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
            }
          }
        })
        fillFallback(result, it, months)
      } catch (err) {
        console.error(`[historicalValues] Failed for ${it.symbol}:`, err.message)
        fillFallback(result, it, months)
      }
    }))
  }

  return result
}
