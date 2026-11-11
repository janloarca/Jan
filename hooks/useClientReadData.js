'use client'

// Vista de lectura del asesor: carga los datos de UN cliente, y nada más que
// leer. ⛔ CRÍTICO: aquí no hay listener, ni snapshot diario, ni backfill, ni
// una sola escritura. No usa useDashboardData (cuyos efectos archivan y
// reparan): solo `getDocs`/`getDoc` sobre lo que las reglas permiten para los
// alcances que el cliente concedió. Las cifras de cabecera (patrimonio, YTD)
// salen de lo que el panel del cliente ya archivó, sin recalcular.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useMarketPrices } from '@/hooks/useMarketPrices'
import { useExchangeRates } from '@/hooks/useExchangeRates'
import { enrichItemsServerSide } from '@/lib/serverPortfolio'
import { sanitizeObservations } from '@/lib/sheetObservations'
import { SNAPSHOT_VERSION } from '@/lib/snapshotVersion'

const PORTFOLIO_SCOPES = ['patrimonio', 'hoja', 'dividendos']
const withId = (d) => ({ ...d.data(), id: d.id })

// Qué se lee con cada alcance. Función pura sobre `fs`/`db` inyectados: el
// test comprueba que SOLO llama lecturas.
export async function loadClientReadData({ fs, db, clientUid, scopes }) {
  const has = (s) => scopes.includes(s)
  const base = `users/${clientUid}`
  const out = { items: [], transactions: [], lots: [], snapshots: [], goals: null, observations: [], financeTransactions: [], summary: null, meta: null }
  const jobs = []
  const safe = (p) => p.catch((e) => { console.error('[lectura]', e?.code || e?.message); return null })
  jobs.push(safe(fs.getDoc(fs.doc(db, `${base}/advisorSummary/meta`))).then((d) => { if (d?.exists()) out.meta = d.data() }))
  if (has('patrimonio') || has('metas')) {
    jobs.push(safe(fs.getDoc(fs.doc(db, `${base}/advisorSummary/latest`))).then((d) => { if (d?.exists()) out.summary = d.data() }))
  }
  if (PORTFOLIO_SCOPES.some(has)) {
    for (const coll of ['items', 'transactions', 'lots', 'snapshots']) {
      jobs.push(safe(fs.getDocs(fs.collection(db, `${base}/${coll}`))).then((s) => { if (s) out[coll] = s.docs.map(withId) }))
    }
  }
  if (has('metas')) jobs.push(safe(fs.getDoc(fs.doc(db, `${base}/settings/goals`))).then((d) => { if (d?.exists()) out.goals = d.data() }))
  if (has('hoja')) jobs.push(safe(fs.getDoc(fs.doc(db, `${base}/settings/sheetObservations`))).then((d) => { if (d?.exists()) out.observations = sanitizeObservations(d.data()) }))
  if (has('flujo')) jobs.push(safe(fs.getDocs(fs.collection(db, `${base}/financeTransactions`))).then((s) => { if (s) out.financeTransactions = s.docs.map(withId) }))
  await Promise.all(jobs)
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''))
  out.transactions.sort(byDate)
  out.snapshots.sort(byDate)
  out.financeTransactions.sort((a, b) => byDate(b, a))
  return out
}

export function useClientReadData({ clientUid, scopes, enabled }) {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const scopeKey = (scopes || []).join(',')

  useEffect(() => {
    if (!enabled || !clientUid) return undefined
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const { db } = await import('@/lib/firebase')
        const fs = await import('firebase/firestore')
        const data = await loadClientReadData({ fs, db, clientUid, scopes: scopeKey ? scopeKey.split(',') : [] })
        if (!cancelled) setRaw(data)
      } catch (e) {
        console.error('[lectura]', e?.message)
        if (!cancelled) setRaw(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientUid, scopeKey, enabled])

  const baseCurrency = raw?.summary?.baseCurrency || raw?.meta?.baseCurrency || 'USD'
  const rawItems = raw?.items
  const { prices, loading: pricesLoading } = useMarketPrices(rawItems || [])
  const { convert, loading: ratesLoading } = useExchangeRates(baseCurrency)
  const items = useMemo(
    () => enrichItemsServerSide(rawItems || [], prices || {}, convert, baseCurrency),
    [rawItems, prices, convert, baseCurrency]
  )

  // La Hoja lee su caché mensual; nunca lo escribe desde aquí.
  const loadItemSnapshots = useCallback(async (monthKeys) => {
    if (!clientUid || !monthKeys || monthKeys.length === 0) return {}
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    const result = {}
    const currencies = {}
    const sigs = {}
    await Promise.all(monthKeys.map(async (key) => {
      try {
        const snap = await fs.getDoc(fs.doc(db, `users/${clientUid}/itemSnapshots`, key))
        if (!snap.exists()) return
        const data = snap.data()
        if ((data._version || 0) < SNAPSHOT_VERSION) return
        result[key] = data.items || {}
        if (data._currency) currencies[key] = data._currency
        if (data._sig) sigs[key] = data._sig
      } catch { /* sin alcance o sin mes: queda en blanco */ }
    }))
    return { ...result, __currencies: currencies, __sigs: sigs }
  }, [clientUid])

  return {
    loading: loading || (!!rawItems?.length && (pricesLoading || ratesLoading)),
    items, transactions: raw?.transactions || [], lots: raw?.lots || [], snapshots: raw?.snapshots || [],
    goals: raw?.goals || null, observations: raw?.observations || [], financeTransactions: raw?.financeTransactions || [],
    summary: raw?.summary || null, meta: raw?.meta || null, baseCurrency, convert, loadItemSnapshots,
  }
}
