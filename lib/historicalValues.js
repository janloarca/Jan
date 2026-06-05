import { authFetch } from './authFetch'

function getMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getMonthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m, 0)
}

function rangeForMonths(months) {
  if (months.length === 0) return '1y'
  const [y] = months[0].split('-').map(Number)
  const yearsBack = new Date().getFullYear() - y + 1
  if (yearsBack <= 1) return '1y'
  if (yearsBack <= 2) return 'max'
  return 'max'
}

export async function getHistoricalItemValues(items, months, convert, baseCurrency) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

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
        if (!res.ok) return
        const data = await res.json()
        const prices = data.prices || []
        if (prices.length === 0) return

        const priceCurrency = data.currency || 'USD'
        const priceByMonth = {}
        prices.forEach(p => {
          if (p.close != null && p.date) {
            const mk = getMonthKey(new Date(p.date))
            priceByMonth[mk] = p.close
          }
        })

        const acqDate = it.acquisitionDate ? new Date(it.acquisitionDate) : null
        const qty = it.quantity || 0

        months.forEach(mk => {
          if (acqDate && getMonthEndDate(mk) < acqDate) return
          const price = priceByMonth[mk]
          if (price == null) return
          let val = qty * price
          if (convert && priceCurrency !== baseCurrency) {
            val = convert(val, priceCurrency, baseCurrency || 'USD')
          }
          result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
        })
      } catch (err) {
        console.error(`[historicalValues] Failed for ${it.symbol}:`, err.message)
      }
    }))
  }

  return result
}
