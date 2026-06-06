'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { formatCurrency, getItemPrice, getMaturityInfo } from './utils'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission, checkAndNotify } from '@/lib/notifications'

export default function NotificationCenter({ items, transactions, lang }) {
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
      checkAndNotify(items, lang)
      notifiedRef.current = true
    }
  }, [itemCount, lang])

  const t = (es, en) => lang === 'es' ? es : en

  const notifications = useMemo(() => {
    const notifs = []
    const now = new Date()

    ;(items || []).forEach((it) => {
      if (it.maturityDate) {
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

      if (it.isIlliquid && it.lastManualValuation > 0 && it.lastValuationDate) {
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

      if (it.rateType === 'variable' && it.rateMin > 0 && it.rateMax > 0) {
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
    if (recentDivs.length > 0) {
      const totalDiv = recentDivs.reduce((s, tx) => s + (tx.totalAmount || 0), 0)
      notifs.push({
        id: `div-recent`,
        type: 'positive',
        icon: '💰',
        textEs: `${recentDivs.length} dividendo(s) recibido(s) esta semana: ${formatCurrency(totalDiv)}`,
        textEn: `${recentDivs.length} dividend(s) received this week: ${formatCurrency(totalDiv)}`,
      })
    }

    return notifs.filter((n) => !dismissed.has(n.id)).sort((a, b) => {
      const order = { urgent: 0, warning: 1, positive: 2, info: 3 }
      return (order[a.type] ?? 4) - (order[b.type] ?? 4)
    })
  }, [items, transactions, dismissed, lang])

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
    urgent: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', color: '#f87171' },
    warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', color: '#fbbf24' },
    positive: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', color: '#34d399' },
    info: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', color: '#60a5fa' },
  }

  return (
    <div className="space-y-1.5">
      {isNotificationSupported() && pushPermission === 'default' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
          style={{ backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>
          <span>🔔</span>
          <span className="flex-1">{t('Activa notificaciones para alertas de pagos y vencimientos', 'Enable notifications for payment and maturity alerts')}</span>
          <button onClick={handleEnablePush} className="px-2 py-1 rounded text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb', color: '#fff' }}>
            {t('Activar', 'Enable')}
          </button>
        </div>
      )}
      {notifications.slice(0, 5).map((n) => {
        const s = typeStyles[n.type] || typeStyles.info
        return (
          <div key={n.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
            style={{ backgroundColor: s.bg, borderColor: s.border, color: s.color }}>
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
