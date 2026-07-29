export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return await Notification.requestPermission()
}

export function sendNotification(title, options = {}) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return null
  try {
    return new Notification(title, {
      icon: '/icon',
      badge: '/icon',
      ...options,
    })
  } catch {
    return null
  }
}

export function checkPriceAlerts(alerts, prices, onTrigger) {
  if (!alerts || alerts.length === 0 || !prices) return []
  const triggered = []
  for (const alert of alerts) {
    if (alert.triggered) continue
    const sym = (alert.symbol || '').toUpperCase()
    const priceData = prices[sym]
    if (!priceData?.price) continue
    const current = priceData.price
    const hit = alert.direction === 'above' ? current >= alert.targetPrice : current <= alert.targetPrice
    if (hit) {
      triggered.push({ ...alert, currentPrice: current })
      if (onTrigger) onTrigger(alert.id, current)
      const dir = alert.direction === 'above' ? '>' : '<'
      sendNotification(
        `${sym} ${dir} ${alert.targetPrice}`,
        { body: `${sym} is now at ${current.toFixed(2)}`, tag: `alert-${alert.id}` }
      )
    }
  }
  return triggered
}

export function checkAndNotify(items, lang = 'es', prefs = {}) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return
  const notifDividend = prefs.notifDividend !== false
  const notifMaturity = prefs.notifMaturity !== false
  const t = (es, en) => lang === 'es' ? es : en

  const now = new Date()
  const today = now.getDate()
  const currentMonth = now.getMonth()
  const lastCheck = localStorage.getItem('chispudo-last-notif-check')
  const todayStr = now.toISOString().split('T')[0]

  if (lastCheck === todayStr) return
  localStorage.setItem('chispudo-last-notif-check', todayStr)

  const upcomingPayments = []
  const expiringAssets = []

  ;(items || []).forEach((it) => {
    if (it.incomeMonths?.includes(currentMonth)) {
      const payDay = it.incomePayDay || 1
      const daysUntil = payDay - today
      if (daysUntil >= 0 && daysUntil <= 3) {
        upcomingPayments.push(it.name || it.symbol)
      }
    }

    if (it.maturityDate) {
      const matDate = new Date(it.maturityDate)
      const daysToMat = Math.floor((matDate - now) / 86400000)
      if (daysToMat > 0 && daysToMat <= 30) {
        expiringAssets.push({ name: it.name || it.symbol, days: daysToMat })
      }
    }
  })

  if (upcomingPayments.length > 0 && notifDividend) {
    const names = upcomingPayments.slice(0, 3).join(', ')
    sendNotification(
      t('Pagos próximos', 'Upcoming payments'),
      { body: t(`${names} pagan en los próximos días`, `${names} paying in the next few days`), tag: 'payments' }
    )
  }

  if (expiringAssets.length > 0 && notifMaturity) {
    const first = expiringAssets[0]
    sendNotification(
      t('Vencimiento próximo', 'Upcoming maturity'),
      { body: t(`${first.name} vence en ${first.days} días`, `${first.name} matures in ${first.days} days`), tag: 'maturity' }
    )
  }
}
