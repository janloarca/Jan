'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { formatCurrency, getItemPrice, getMaturityInfo } from './utils'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission, checkAndNotify } from '@/lib/notifications'

export default function NotificationCenter({ items, transactions, lang, settings, convert, baseCurrency }) {
  // Absent = on, same default as every other settings.* toggle in the app.
  const notifMaturity = settings?.notifMaturity !== false
  const notifDividend = settings?.notifDividend !== false
  const notifValuation = settings?.notifValuation !== false
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('chispudo-dismissed-notifs') || '[]'))
    } catch { return new Set() }
  })
  const [pushPermission, setPushPermission] = useState('default')
  const notifiedRef = useRef(false)

  const itemCount = (items || []).length
  useEffect(() => {
    if (notifiedRef.current) return
    if (isNotificationSupported() && itemCount > 0) {
      setPushPermission(getNotificationPermission())
      checkAndNotify(items, lang, { notifMaturity, notifDividend })
      notifiedRef.current = true
    }
  }, [itemCount, lang, notifMaturity, notifDividend])

  const t = (es, en) => lang === 'es' ? es : en

  const notifications = useMemo(() => {
    const notifs = []
    const now = new Date()

    ;(items || []).forEach((it) => {
      if (notifMaturity && it.maturityDate) {
        const info = getMaturityInfo(it)
        if (info && !info.expired && info.days <= 90) {
          notifs.push({
            id: `mat-${it.id}`,
            type: info.days <= 30 ? 'urgent' : 'warning',
            icon: '📅',
            textEs: `${it.name || it.symbol} vence en ${info.label}`,
            textEn: `${it.name || it.symbol} matures in ${info.label}`,
            value: (it.quantity || 1) * getItemPrice(it),
            date: it.maturityDate,
          })
        }
      }

      if (notifValuation && it.isIlliquid && it.lastManualValuation > 0 && it.lastValuationDate) {
        const lastVal = new Date(it.lastValuationDate)
        const daysSince = Math.floor((now - lastVal) / 86400000)
        if (daysSince > 180) {
          notifs.push({
            id: `val-${it.id}`,
            type: 'info',
            icon: '📊',
            textEs: `${it.name || it.symbol}: valuación manual tiene ${Math.floor(daysSince / 30)} meses`,
            textEn: `${it.name || it.symbol}: manual valuation is ${Math.floor(daysSince / 30)} months old`,
          })
        }
      }

      if (notifValuation && it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) {
        const spread = it.rateMax - it.rateMin
        if (spread > 3) {
          notifs.push({
            id: `rate-${it.id}`,
            type: 'info',
            icon: '📈',
            textEs: `${it.name || it.symbol}: spread de tasa amplio (${it.rateMin}%-${it.rateMax}%)`,
            textEn: `${it.name || it.symbol}: wide rate spread (${it.rateMin}%-${it.rateMax}%)`,
          })
        }
      }
    })

    const recentDivs = (transactions || []).filter((tx) => {
      if (tx.type !== 'DIVIDEND') return false
      const txDate = new Date(tx.date)
      return (now - txDate) < 7 * 86400000
    })
    if (notifDividend && recentDivs.length > 0) {
      // Un dividendo cobrado en quetzales sumado crudo y formateado con el
      // símbolo de la moneda base se lee como dólares: Q102 aparenta ser $102,
      // casi 8 veces más. Dos casos, y ninguno mezcla monedas:
      //  - Todos los pagos de la semana en UNA sola moneda: se muestra en ESA
      //    moneda, exacto y sin depender de ninguna tasa de cambio (es además
      //    la misma moneda que muestra la fila en el historial).
      //  - Monedas mezcladas: cada pago se convierte a la moneda base antes de
      //    sumar, y el total se etiqueta en base. Sin converter (tasas aún sin
      //    cargar) se cae al monto crudo, el mismo respaldo del resto de la app.
      const base = baseCurrency || 'USD'
      const currencies = new Set(recentDivs.map((tx) => tx.currency || base))
      const single = currencies.size === 1 ? [...currencies][0] : null
      const totalDiv = recentDivs.reduce((s, tx) => {
        let amt = tx.totalAmount || 0
        const cur = tx.currency || base
        if (!single && convert && cur !== base) {
          const c = convert(amt, cur, base)
          if (isFinite(c)) amt = c
        }
        return s + amt
      }, 0)
      const shown = formatCurrency(totalDiv, single || base)
      notifs.push({
        id: `div-recent`,
        type: 'positive',
        icon: '💰',
        textEs: `${recentDivs.length} dividendo(s) recibido(s) esta semana: ${shown}`,
        textEn: `${recentDivs.length} dividend(s) received this week: ${shown}`,
      })
    }

    return notifs.filter((n) => !dismissed.has(n.id)).sort((a, b) => {
      const order = { urgent: 0, warning: 1, positive: 2, info: 3 }
      return (order[a.type] ?? 4) - (order[b.type] ?? 4)
    })
  }, [items, transactions, dismissed, lang, notifMaturity, notifDividend, notifValuation, convert, baseCurrency])

  const dismiss = (id) => {
    const next = new Set([...dismissed, id])
    setDismissed(next)
    localStorage.setItem('chispudo-dismissed-notifs', JSON.stringify([...next]))
  }

  const handleEnablePush = async () => {
    const result = await requestNotificationPermission()
    setPushPermission(result)
    if (result === 'granted') checkAndNotify(items, lang)
  }

  if (notifications.length === 0 && pushPermission !== 'default') return null

  const typeStyles = {
    // Los cuatro reimplementaban a mano los tokens `--alert-*` que ya existen,
    // y el de warning se quedó con el hex del tema oscuro (1.67:1 sobre blanco).
    urgent: { bg: 'var(--alert-error-bg)', border: 'var(--alert-error-border)', color: 'var(--alert-error-icon)' },
    warning: { bg: 'var(--alert-warn-bg)', border: 'var(--alert-warn-border)', color: 'var(--alert-warn-icon)' },
    positive: { bg: 'var(--alert-success-bg)', border: 'var(--alert-success-border)', color: 'var(--alert-success-icon)' },
    info: { bg: 'var(--alert-info-bg)', border: 'var(--alert-info-border)', color: 'var(--alert-info-icon)' },
  }

  return (
    <div className="space-y-1.5">
      {isNotificationSupported() && pushPermission === 'default' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
          style={{ backgroundColor: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.2)', color: 'var(--accent-blue)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <span>🔔</span>
          <span className="flex-1">{t('Activa notificaciones para alertas de pagos y vencimientos', 'Enable notifications for payment and maturity alerts')}</span>
          <button onClick={handleEnablePush} className="px-2 py-1 rounded text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
            {t('Activar', 'Enable')}
          </button>
        </div>
      )}
      {notifications.slice(0, 5).map((n) => {
        const s = typeStyles[n.type] || typeStyles.info
        return (
          <div key={n.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
            style={{ backgroundColor: s.bg, borderColor: s.border, color: s.color, backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
            <span>{n.icon}</span>
            <span className="flex-1">{lang === 'es' ? n.textEs : n.textEn}</span>
            {n.value && <span className="font-medium shrink-0">{formatCurrency(n.value)}</span>}
            <button onClick={() => dismiss(n.id)} className="opacity-40 hover:opacity-100 ml-1">×</button>
          </div>
        )
      })}
    </div>
  )
}
