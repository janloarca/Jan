'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getItemPrice, getMaturityInfo } from './utils'

export default function NotificationCenter({ items, transactions, lang }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('chispudo-dismissed-notifs') || '[]'))
    } catch { return new Set() }
  })

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
  }, [items, transactions, dismissed])

  const dismiss = (id) => {
    const next = new Set([...dismissed, id])
    setDismissed(next)
    localStorage.setItem('chispudo-dismissed-notifs', JSON.stringify([...next]))
  }

  if (notifications.length === 0) return null

  const styles = {
    urgent: 'bg-red-500/8 border-red-500/20 text-red-400',
    warning: 'bg-amber-500/8 border-amber-500/20 text-amber-400',
    positive: 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400',
    info: 'bg-blue-500/8 border-blue-500/20 text-blue-400',
  }

  return (
    <div className="space-y-1.5">
      {notifications.slice(0, 5).map((n) => (
        <div key={n.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${styles[n.type] || styles.info}`}>
          <span>{n.icon}</span>
          <span className="flex-1">{lang === 'es' ? n.textEs : n.textEn}</span>
          {n.value && <span className="font-medium shrink-0">{formatCurrency(n.value)}</span>}
          <button onClick={() => dismiss(n.id)} className="opacity-40 hover:opacity-100 ml-1">×</button>
        </div>
      ))}
    </div>
  )
}
