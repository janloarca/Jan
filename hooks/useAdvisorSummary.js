'use client'

// Publica, una vez al día, las cifras de cabecera que el panel del cliente YA
// calculó (patrimonio, invertible, YTD) en users/{uid}/advisorSummary. Es lo
// que el book del asesor muestra como "último snapshot": el asesor nunca
// recalcula nada. Solo corre si el usuario tiene un asesor con acceso activo;
// un usuario personal no escribe nada.
//
// ⛔ Vive FUERA de useDashboardData a propósito: no toca el snapshot diario,
// el backfill ni ningún cálculo. Solo copia números ya mostrados en pantalla.
import { useEffect, useRef } from 'react'

function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function buildAdvisorSummary({ netWorth, investable, ytdPct, ytdChange, baseCurrency, convert, now = new Date() }) {
  if (!Number.isFinite(netWorth)) return null
  const base = baseCurrency || 'USD'
  const toUSD = (v) => {
    if (!Number.isFinite(v)) return null
    const out = convert ? convert(v, base, 'USD') : v
    return Number.isFinite(out) ? out : null
  }
  const num = (v) => (Number.isFinite(v) ? v : null)
  return {
    netWorth, investable: num(investable), ytdPct: num(ytdPct), ytdChange: num(ytdChange),
    baseCurrency: base, netWorthUSD: toUSD(netWorth), investableUSD: toUSD(investable),
    at: now.toISOString(), day: dayKey(now),
  }
}

export function useAdvisorSummaryPublisher({ uid, enabled, ready, netWorth, investable, ytdPct, ytdChange, baseCurrency, convert, clientName }) {
  const doneRef = useRef(null)
  useEffect(() => {
    if (!uid || !enabled || !ready) return
    const key = `${uid}:${dayKey()}`
    if (doneRef.current === key) return
    try { if (localStorage.getItem('chispu-advisor-summary') === key) { doneRef.current = key; return } } catch { /* sin storage */ }
    const summary = buildAdvisorSummary({ netWorth, investable, ytdPct, ytdChange, baseCurrency, convert })
    if (!summary) return
    doneRef.current = key
    ;(async () => {
      try {
        const { db } = await import('@/lib/firebase')
        const fs = await import('firebase/firestore')
        await Promise.all([
          fs.setDoc(fs.doc(db, `users/${uid}/advisorSummary/latest`), summary),
          fs.setDoc(fs.doc(db, `users/${uid}/advisorSummary/meta`), { baseCurrency: summary.baseCurrency, name: clientName || '', at: summary.at }),
        ])
        try { localStorage.setItem('chispu-advisor-summary', key) } catch { /* sin storage */ }
      } catch (e) {
        doneRef.current = null
        console.error('[advisorSummary]', e?.message)
      }
    })()
  }, [uid, enabled, ready, netWorth, investable, ytdPct, ytdChange, baseCurrency, convert, clientName])
}
