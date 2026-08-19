import { useState, useEffect, useCallback, useRef } from 'react'
import { sanitizeImportItem } from '@/lib/validation'
import { SNAPSHOT_SRC_PRIORITY } from '@/components/dashboard/utils'
import { detectMisstampedMonthlyNavSnapshots } from '@/lib/badDataCleanup'
import { orphanedAccountSnapshotIds } from '@/lib/accountCleanup'
import { SNAPSHOT_VERSION } from '@/lib/snapshotVersion'

let _db = null
let _auth = null
let _firestoreMod = null

async function getFirebase() {
  if (_db && _auth) return { db: _db, auth: _auth, fs: _firestoreMod }
  const { db, auth } = await import('@/lib/firebase')
  const fs = await import('firebase/firestore')
  _db = db
  _auth = auth
  _firestoreMod = fs
  return { db, auth, fs }
}

async function waitForAuth(auth) {
  if (auth.currentUser) return auth.currentUser
  const { onAuthStateChanged } = await import('firebase/auth')
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub()
      resolve(user)
    })
  })
}

// Caché en memoria a nivel de módulo, keyed por uid: al cambiar de sección el
// hook arranca con el último estado conocido y los onSnapshot lo pisan con el
// estado vivo del servidor. La clave es el uid, así un cambio de cuenta nunca
// ve datos del usuario anterior, y currentUser null (sign-out) la invalida.
let _cacheByUid = {}

function readInitCache() {
  const uid = _auth?.currentUser?.uid
  return (uid && _cacheByUid[uid]) || null
}

const QTY_EPSILON = 0.0001
function roundQty(v) { return Math.round(v * 10000) / 10000 }

function toStr(v) {
  if (v == null) return v
  if (typeof v === 'string') return v
  if (v.toDate) return v.toDate().toISOString()
  if (v.seconds) return new Date(v.seconds * 1000).toISOString()
  return String(v)
}

function safeNum(v) { const n = Number(v) || 0; return isFinite(n) ? n : 0 }

function sanitizeItem(raw) {
  return {
    ...raw,
    quantity: safeNum(raw.quantity),
    purchasePrice: safeNum(raw.purchasePrice),
    currentPrice: raw.currentPrice != null ? safeNum(raw.currentPrice) : undefined,
    incomeAmount: raw.incomeAmount != null ? safeNum(raw.incomeAmount) : 0,
    incomeRate: raw.incomeRate != null ? safeNum(raw.incomeRate) : 0,
    rateMin: raw.rateMin != null ? safeNum(raw.rateMin) : 0,
    rateMax: raw.rateMax != null ? safeNum(raw.rateMax) : 0,
    incomeMonths: Array.isArray(raw.incomeMonths) ? raw.incomeMonths.filter((m) => typeof m === 'number' && m >= 0 && m < 12) : undefined,
    maturityDate: toStr(raw.maturityDate),
    acquisitionDate: toStr(raw.acquisitionDate),
    createdAt: toStr(raw.createdAt),
  }
}

function sanitizeDoc(raw) {
  const out = { ...raw }
  for (const key of Object.keys(out)) {
    const v = out[key]
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.toDate === 'function') {
        out[key] = v.toDate().toISOString()
      } else if (v.seconds != null && v.nanoseconds != null) {
        out[key] = new Date(v.seconds * 1000).toISOString()
      }
    }
  }
  return out
}

// Deletes every doc in a collection in chunked batches instead of one
// deleteDoc() per document fired all at once via Promise.all: an account with
// a real year of history easily has 500-1000+ docs across items/lots/
// transactions/snapshots, and an unbounded burst of individual writes against
// Firestore stalls badly (real symptom: "delete all" spinning forever and
// never reaching the steps after it, like clearing the IBKR connection).
const DELETE_CHUNK = 400
async function deleteAllDocsIn(db, fs, path) {
  const snap = await fs.getDocs(fs.collection(db, path))
  const refs = snap.docs.map((d) => d.ref)
  for (let i = 0; i < refs.length; i += DELETE_CHUNK) {
    const batch = fs.writeBatch(db)
    for (const ref of refs.slice(i, i + DELETE_CHUNK)) batch.delete(ref)
    await batch.commit()
  }
}

export function useFirestoreItems() {
  const initCache = readInitCache()
  const [items, setItems] = useState(initCache?.items || [])
  const [snapshots, setSnapshots] = useState(initCache?.snapshots || [])
  const [transactions, setTransactions] = useState(initCache?.transactions || [])
  const [alerts, setAlerts] = useState(initCache?.alerts || [])
  const [lots, setLots] = useState(initCache?.lots || [])
  const [portfolios, setPortfolios] = useState(initCache?.portfolios || [])
  const [financeTransactions, setFinanceTransactions] = useState(initCache?.financeTransactions || [])
  const [goals, setGoals] = useState(initCache?.goals || null)
  const [settings, setSettings] = useState(initCache?.settings || null)
  const [profile, setProfile] = useState(initCache?.profile || null)
  const [incomePlan, setIncomePlan] = useState(initCache?.incomePlan || null)
  const [loading, setLoading] = useState(!initCache)
  const [uid, setUid] = useState(_auth?.currentUser?.uid || null)

  useEffect(() => {
    let unsubItems = () => {}
    let unsubSnapshots = () => {}
    let unsubTransactions = () => {}
    let unsubAlerts = () => {}
    let unsubLots = () => {}
    let unsubPortfolios = () => {}
    let unsubFinanceTx = () => {}
    let cancelled = false

    async function init() {
      const { db, auth, fs } = await getFirebase()
      if (!auth || !db) { setLoading(false); return }

      const user = await waitForAuth(auth)
      if (cancelled) return
      // Sign-out: currentUser null invalida la caché para que ningún montaje
      // posterior arranque con datos de una sesión ya cerrada.
      if (!user) { _cacheByUid = {}; setLoading(false); return }

      const currentUid = user.uid
      setUid(currentUid)

      const onErr = (label) => (err) => { console.error(`[Firestore] ${label} listener error:`, err.code, err.message) }

      unsubItems = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/items`),
        (snap) => {
          if (!cancelled) {
            setItems(snap.docs.map((d) => sanitizeItem({ ...d.data(), id: d.id })))
          }
        },
        onErr('items')
      )
      unsubSnapshots = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/snapshots`), fs.orderBy('date')),
        (snap) => { if (!cancelled) setSnapshots(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id }))) },
        onErr('snapshots')
      )
      unsubTransactions = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/transactions`), fs.orderBy('date')),
        (snap) => {
          if (!cancelled) {
            setTransactions(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id })))
            setLoading(false)
          }
        },
        onErr('transactions')
      )

      try {
        // Independent docs — fetch in parallel instead of three round-trips in series.
        const [goalsDoc, prefsDoc, profileDoc, planDoc] = await Promise.all([
          fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'goals')),
          fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'preferences')),
          fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'profile')),
          fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'incomePlan')),
        ])
        if (!cancelled && goalsDoc.exists()) setGoals(sanitizeDoc(goalsDoc.data()))
        if (!cancelled && prefsDoc.exists()) setSettings(sanitizeDoc(prefsDoc.data()))
        if (!cancelled && profileDoc.exists()) setProfile(sanitizeDoc(profileDoc.data()))
        if (!cancelled && planDoc.exists()) setIncomePlan(sanitizeDoc(planDoc.data()))
      } catch (e) { console.error('[firestore] settings load failed:', e?.message) }

      if (!cancelled) setLoading(false)

      unsubAlerts = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/alerts`),
        (snap) => { if (!cancelled) setAlerts(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id }))) },
        onErr('alerts')
      )
      unsubLots = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/lots`),
        (snap) => { if (!cancelled) setLots(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id }))) },
        onErr('lots')
      )
      unsubPortfolios = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/portfolios`),
        (snap) => { if (!cancelled) setPortfolios(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id }))) },
        onErr('portfolios')
      )
      unsubFinanceTx = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/financeTransactions`), fs.orderBy('date', 'desc')),
        (snap) => { if (!cancelled) setFinanceTransactions(snap.docs.map((d) => sanitizeDoc({ ...d.data(), id: d.id }))) },
        onErr('financeTransactions')
      )
    }

    init()
    return () => { cancelled = true; unsubItems(); unsubSnapshots(); unsubTransactions(); unsubAlerts(); unsubLots(); unsubPortfolios(); unsubFinanceTx() }
  }, [])

  // Mantiene la caché de módulo al día con el estado vivo: los onSnapshot ya
  // actualizan el state; aquí solo lo persistimos para el próximo montaje.
  // Gateada por !loading: mientras la primera carga no entrega datos reales,
  // no se escribe nada, así una navegación rápida nunca cachea arrays vacíos.
  useEffect(() => {
    if (uid && !loading) {
      _cacheByUid[uid] = { items, snapshots, transactions, alerts, lots, portfolios, financeTransactions, goals, settings, profile, incomePlan }
    }
  }, [uid, loading, items, snapshots, transactions, alerts, lots, portfolios, financeTransactions, goals, settings, profile, incomePlan])

  const addItem = useCallback(async (item) => {
    if (!uid) { console.error('[addItem] No uid — write skipped'); return }
    try {
      const { db, fs } = await getFirebase()
      const id = item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const { id: _removed, ...raw } = item
      const data = sanitizeImportItem(raw)
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      await fs.setDoc(fs.doc(db, `users/${uid}/items`, id), { ...clean, createdAt: new Date().toISOString() }, { merge: true })
      return id
    } catch (e) {
      console.error('[addItem] Write failed:', e)
    }
  }, [uid])

  const updateItem = useCallback(async (itemId, fields) => {
    if (!uid || !itemId) return
    let prev
    setItems(cur => { prev = cur; return cur.map(it => it.id === itemId ? { ...it, ...fields } : it) })
    try {
      const { db, fs } = await getFirebase()
      const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
      await fs.updateDoc(fs.doc(db, `users/${uid}/items`, itemId), clean)
    } catch (err) {
      if (prev) setItems(prev)
      throw err
    }
  }, [uid])

  const deleteItem = useCallback(async (itemId, { skipRefCleanup = false } = {}) => {
    if (!uid) return
    const prev = items
    const deletedItem = items.find(it => it.id === itemId)
    setItems((cur) => cur.filter((it) => it.id !== itemId))
    try {
      const { db, fs } = await getFirebase()
      const sym = (deletedItem?.symbol || '').toUpperCase()
      const needLotCleanup = !!sym && !items.some(it => it.id !== itemId && (it.symbol || '').toUpperCase() === sym)

      // The four cleanup reads are independent — fetch them in one round-trip
      // instead of four in series (deleting an item used to take 4× the latency).
      // Writes below keep their original order (item first, then references).
      const [itemsSnap, txSnap, lotSnap, isSnap] = await Promise.all([
        skipRefCleanup ? null : fs.getDocs(fs.collection(db, `users/${uid}/items`)),
        fs.getDocs(fs.collection(db, `users/${uid}/transactions`)),
        needLotCleanup ? fs.getDocs(fs.collection(db, `users/${uid}/lots`)) : null,
        fs.getDocs(fs.collection(db, `users/${uid}/itemSnapshots`)),
      ])

      if (skipRefCleanup) {
        await fs.deleteDoc(fs.doc(db, `users/${uid}/items`, itemId))
      } else {
        const batch = fs.writeBatch(db)
        itemsSnap.docs.forEach((d) => {
          if (d.id === itemId) return
          const data = d.data()
          const updates = {}
          if (data.incomeDestination === itemId) updates.incomeDestination = ''
          if (data.capitalDestination === itemId) updates.capitalDestination = ''
          if (Object.keys(updates).length > 0) batch.update(d.ref, updates)
        })
        batch.delete(fs.doc(db, `users/${uid}/items`, itemId))
        await batch.commit()
      }

      const txBatch = fs.writeBatch(db)
      let txCount = 0
      txSnap.docs.forEach(d => {
        if (d.data()._linkedItemId === itemId) { txBatch.delete(d.ref); txCount++ }
      })
      if (txCount > 0) await txBatch.commit()

      if (lotSnap) {
        const lotBatch = fs.writeBatch(db)
        let lotCount = 0
        lotSnap.docs.forEach(d => {
          if ((d.data().symbol || '').toUpperCase() === sym) { lotBatch.delete(d.ref); lotCount++ }
        })
        if (lotCount > 0) await lotBatch.commit()
      }

      const isBatch = fs.writeBatch(db)
      let isCount = 0
      isSnap.docs.forEach(d => {
        const data = d.data()
        if (data.items && data.items[itemId]) {
          const { [itemId]: _, ...rest } = data.items
          isBatch.update(d.ref, { items: rest })
          isCount++
        }
      })
      if (isCount > 0) await isBatch.commit()
    } catch (err) {
      setItems(prev)
      throw err
    }
  }, [uid, items])

  // FASE GM2. Sube con cada borrado de cuentas. Los efectos una-vez-por-sesión
  // de useDashboardData (el backfill de 366 días que re-deriva el historial de
  // portafolio completo) ya corrieron ANTES de un borrado hecho a mitad de
  // sesión, así que sin esta señal el auto-reparado no ocurre hasta la próxima
  // recarga: el usuario se queda mirando el snapshot de ayer (que aún contiene
  // la cuenta borrada) como un pico gigante y una serie punteada, creyendo que
  // el borrado dejó registro para siempre.
  const [deletionEpoch, setDeletionEpoch] = useState(0)

  const deleteAllItems = useCallback(async ({ cascade } = {}) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const collections = [`users/${uid}/items`]
    if (cascade) {
      collections.push(`users/${uid}/lots`, `users/${uid}/transactions`, `users/${uid}/snapshots`, `users/${uid}/itemSnapshots`)
    }
    for (const path of collections) await deleteAllDocsIn(db, fs, path)
    setDeletionEpoch((e) => e + 1)
  }, [uid])

  const saveSnapshot = useCallback(async (snapshot) => {
    if (!uid) return
    // Demo mode (onboarding sample data) must not leave real history behind —
    // snapshots written while demo items exist would pollute the NAV chart
    // after the demo is deleted.
    if (items.some((i) => i._source === 'demo')) return
    const { db, fs } = await getFirebase()
    const dateStr = snapshot.date || new Date().toISOString().split('T')[0]
    // Per-account calibration anchors share their date with real NAV snapshots
    // (a YTD calibration sits on Jan 1, where a daily snapshot may also live):
    // a compound id keeps them from overwriting each other. Portfolio-wide
    // snapshots keep the plain date id so dedup/precedence logic is untouched.
    const id = snapshot._account
      ? `${dateStr}~${snapshot._calibrationKind || 'cal'}~${String(snapshot._account).replace(/[^a-z0-9]+/gi, '-')}`
      : dateStr
    const clean = Object.fromEntries(Object.entries({ ...snapshot, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/snapshots`, id), clean, { merge: true })
  }, [uid, items])

  // Single-doc delete: the snapshot doc id IS its date string, so re-stamping
  // a mis-dated snapshot (badDataCleanup class 6) means writing the corrected
  // doc and removing the old day-01 one.
  const deleteSnapshot = useCallback(async (id) => {
    if (!uid || !id) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/snapshots`, id))
  }, [uid])

  // Self-heal class 6 (lib/badDataCleanup): monthly PortfolioAnalyst NAV rows
  // were date-stamped month-START before the parser fix, so their snapshots sit
  // on day 01 holding the month-END value and poison the YTD anchor
  // (findYearStartAnchor) plus the growth chart's year-start point. Snapshot
  // doc ids ARE the date string, so a re-stamp writes the corrected doc first
  // and deletes the day-01 doc second (never the reverse: a failed create must
  // not orphan the data).
  const snapHealRef = useRef(false)
  useEffect(() => {
    if (loading || snapHealRef.current || !uid) return
    const fixes = detectMisstampedMonthlyNavSnapshots(snapshots)
    if (fixes.length === 0) return
    snapHealRef.current = true
    let cancelled = false
    ;(async () => {
      let restamped = 0
      for (const f of fixes) {
        if (cancelled) return
        const original = snapshots.find((x) => x && x.id === f.id)
        if (!original) continue
        try {
          const { id: _oldId, ...rest } = original
          await saveSnapshot({ ...rest, date: f.newDate })
          await deleteSnapshot(f.id)
          restamped++
        } catch { /* leave it; next load retries */ }
      }
      if (restamped > 0) console.info(`[badDataCleanup] re-stamped ${restamped} monthly IBKR snapshot(s) to month-end`)
    })()
    return () => { cancelled = true }
  }, [loading, uid, snapshots, saveSnapshot, deleteSnapshot])

  const deleteAllSnapshots = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await deleteAllDocsIn(db, fs, `users/${uid}/snapshots`)
  }, [uid])

  // Selective cleanup for the onboarding demo: removes every doc flagged
  // _source:'demo' (items + lots + transactions) and nothing else. Snapshots
  // never carry demo data (saveSnapshot/saveItemSnapshots are vetoed while
  // demo items exist), so they need no sweep here.
  const deleteDemoData = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const refs = [
      ...items.filter((i) => i._source === 'demo').map((i) => fs.doc(db, `users/${uid}/items`, i.id)),
      ...lots.filter((l) => l._source === 'demo').map((l) => fs.doc(db, `users/${uid}/lots`, l.id)),
      ...transactions.filter((t) => t._source === 'demo').map((t) => fs.doc(db, `users/${uid}/transactions`, t.id)),
    ]
    const CHUNK = 30
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = fs.writeBatch(db)
      for (const ref of refs.slice(i, i + CHUNK)) batch.delete(ref)
      await batch.commit()
    }
  }, [uid, items, lots, transactions])

  // Delete a specific set of items (by id) plus their lots and transactions — the
  // engine behind the per-account "selective delete" in Settings. The caller (the UI)
  // owns the grouping (by source/institution); this stays generic. Lots/transactions
  // are only removed for symbols NO surviving item still holds, so deleting one account
  // never strips history a sibling account shares.
  const deleteItemGroup = useCallback(async (itemIds) => {
    if (!uid || !itemIds?.length) return 0
    const idSet = new Set(itemIds)
    const groupItems = items.filter((i) => idSet.has(i.id))
    if (groupItems.length === 0) return 0
    const { db, fs } = await getFirebase()
    const groupSyms = new Set(groupItems.map((i) => (i.symbol || '').toUpperCase()).filter(Boolean))
    const survivingSyms = new Set(items.filter((i) => !idSet.has(i.id)).map((i) => (i.symbol || '').toUpperCase()))
    const symDeletable = (s) => !!s && groupSyms.has(s) && !survivingSyms.has(s)
    // Snapshots that describe the ACCOUNT rather than the portfolio (a broker's
    // NAV history, a per-account calibration anchor) have to go with it. Without
    // this the group delete removed the positions and left their NAV behind, so
    // the chart kept plotting an account the portfolio no longer held — a
    // leftover IBKR NAV of 5,760 topped up with a manual 6,240 bond drew a flat
    // 12,000 line over a portfolio worth 6,240 (FASE DX). Portfolio-wide
    // snapshots ('daily' and friends) are never touched: they also measure what
    // survives.
    const survivingItems = items.filter((i) => !idSet.has(i.id))
    const orphanSnapIds = orphanedAccountSnapshotIds(snapshots, groupItems, survivingItems)
    // FASE GL. Account-LEVEL transactions (a broker's deposits/withdrawals,
    // fees and taxes carry symbol 'CASH' and no _linkedItemId, and accepted
    // inferred flows share that shape) never matched the per-item filters
    // below, so deleting the account left them orphaned — and an orphan
    // deposit is poison, not residue: every return engine keeps netting money
    // into an account that no longer exists, and the spreadsheet's monthly
    // recompute rebuilds history through flows no surviving item explains
    // (real report: deleting IBKR from Settings left YTD at -29.62% and a
    // -47.8% "drawdown" that was just the deletion itself). Deleting an
    // account means it never appears in history again — a WITHDRAWAL is how
    // you record money that actually left. Same last-item rule as
    // orphanedAccountSnapshotIds: IBKR split across groups (API + file) must
    // not lose its ledger while one group survives.
    const ibkrGone = groupItems.some((i) => i._source === 'ibkr')
      && !survivingItems.some((i) => i._source === 'ibkr')
    const refs = [
      ...groupItems.map((i) => fs.doc(db, `users/${uid}/items`, i.id)),
      ...lots.filter((l) => symDeletable((l.symbol || '').toUpperCase())).map((l) => fs.doc(db, `users/${uid}/lots`, l.id)),
      ...transactions.filter((t) =>
        idSet.has(t._linkedItemId) || idSet.has(t._destinationItemId) || idSet.has(t._originItemId)
        || symDeletable((t.symbol || '').toUpperCase())
        || (ibkrGone && (t._source === 'ibkr' || t._source === 'inferred_flow'))
      ).map((t) => fs.doc(db, `users/${uid}/transactions`, t.id)),
      ...orphanSnapIds.map((id) => fs.doc(db, `users/${uid}/snapshots`, id)),
    ]
    const CHUNK = 30
    for (let i = 0; i < refs.length; i += CHUNK) {
      const batch = fs.writeBatch(db)
      for (const ref of refs.slice(i, i + CHUNK)) batch.delete(ref)
      await batch.commit()
    }
    setItems((cur) => cur.filter((it) => !idSet.has(it.id)))
    if (orphanSnapIds.length > 0) {
      const goneSnaps = new Set(orphanSnapIds)
      setSnapshots((cur) => cur.filter((s) => !goneSnaps.has(s.id)))
    }
    setDeletionEpoch((e) => e + 1)
    return groupItems.length
  }, [uid, items, lots, transactions, snapshots])

  const addTransaction = useCallback(async (transaction) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const amt = Math.round((transaction.totalAmount || transaction.amount || 0) * 100)
    // Deterministic IDs dedupe auto-generated transactions (daily dividend processing).
    // Manual entries need a nonce so two identical same-day entries don't overwrite each other.
    const isManual = (transaction._source || '').startsWith('manual')
    const nonce = isManual ? `-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : ''
    const id = `${transaction.date || 'nodate'}-${(transaction.symbol || 'nosym').toUpperCase()}-${transaction.type || 'tx'}-${amt}${nonce}`
    // Strip a caller-supplied id (e.g. a state object round-tripped from the
    // transactions list) — the doc id is authoritative and the read path
    // trusts d.id, but a stray `id` field in the stored data would win if
    // that read order ever regresses. Mirrors addItem's _removed pattern.
    const { id: _removed, ...rawTx } = transaction
    const txData = Object.fromEntries(Object.entries({ ...rawTx, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/transactions`, id), txData)
  }, [uid])

  const deleteTransaction = useCallback(async (txId) => {
    if (!uid || !txId) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/transactions`, txId))
  }, [uid])

  // Patch an existing movement in place (fix a wrong date/amount, or attach a
  // stray one to the account it belongs to via _linkedItemId). The doc id
  // encodes date/symbol/type/amount purely as a dedupe key for AUTO-generated
  // rows — the read path trusts the doc id and never re-derives it from the
  // fields, so editing content without renaming the doc is safe and keeps the
  // row's identity (and anything already pointing at it) intact.
  const updateTransaction = useCallback(async (txId, fields) => {
    if (!uid || !txId || !fields) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (Object.keys(clean).length === 0) return
    await fs.updateDoc(fs.doc(db, `users/${uid}/transactions`, txId), clean)
  }, [uid])

  const deleteAllTransactions = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await deleteAllDocsIn(db, fs, `users/${uid}/transactions`)
  }, [uid])

  const saveGoals = useCallback(async (goalsData) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(Object.entries({ ...goalsData, updatedAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'goals'), clean, { merge: true })
    setGoals((prev) => ({ ...prev, ...goalsData }))
  }, [uid])

  const saveSettings = useCallback(async (prefsData) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(Object.entries({ ...prefsData, updatedAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'preferences'), clean, { merge: true })
    setSettings((prev) => ({ ...prev, ...prefsData }))
  }, [uid])

  const saveProfile = useCallback(async (profileData) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(Object.entries({ ...profileData, updatedAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'profile'), clean, { merge: true })
    setProfile((prev) => ({ ...prev, ...profileData }))
  }, [uid])

  // El plan de ingresos (el tablero de salarios de Flujo). A diferencia de los
  // otros docs de settings se escribe SIN merge, a propósito: siempre se manda
  // el plan completo ya serializado, y así borrar un cuadrito lo borra de
  // verdad. Con merge, un mapa anidado se fusiona campo a campo y lo eliminado
  // sobrevive a la escritura (lección FASE FT).
  const saveIncomePlan = useCallback(async (planDoc) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(
      Object.entries({ ...planDoc, updatedAt: new Date().toISOString() }).filter(([, v]) => v !== undefined)
    )
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'incomePlan'), clean)
    setIncomePlan(clean)
  }, [uid])

  const addAlert = useCallback(async (alert) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const id = `${alert.symbol}-${Date.now()}`
    const alertData = Object.fromEntries(Object.entries({ ...alert, createdAt: new Date().toISOString(), triggered: false, triggeredAt: null }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/alerts`, id), alertData)
  }, [uid])

  const deleteAlert = useCallback(async (alertId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/alerts`, alertId))
  }, [uid])

  const updateAlert = useCallback(async (alertId, data) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/alerts`, alertId), data)
  }, [uid])

  const addLot = useCallback(async (lot) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const qty = Math.round((lot.quantity || 0) * 1e8)
    const cost = Math.round((lot.costBasis || 0) * 100)
    const inst = (lot.institution || '').replace(/[/\\]/g, '-').slice(0, 20)
    const id = `${(lot.symbol || 'lot').toUpperCase()}-${lot.acquisitionDate || 'nodate'}-${qty}-${cost}${inst ? `-${inst}` : ''}`
    const lotData = Object.fromEntries(Object.entries({ ...lot, status: 'open', createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/lots`, id), lotData)
  }, [uid])

  const updateLot = useCallback(async (lotId, data) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    await fs.updateDoc(fs.doc(db, `users/${uid}/lots`, lotId), clean)
  }, [uid])

  const closeLotsFIFO = useCallback(async (symbol, qtyToClose, closePrice, closeDate, institution) => {
    if (!uid) return []
    const { db, fs } = await getFirebase()

    return fs.runTransaction(db, async (tx) => {
      const lotsSnap = await tx.get(fs.query(
        fs.collection(db, `users/${uid}/lots`),
        fs.where('symbol', '==', symbol),
        fs.where('status', '==', 'open')
      ))
      let openLots = lotsSnap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(l => l.quantity > 0)
        .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))
      if (institution) {
        const instLots = openLots.filter(l => l.institution === institution)
        if (instLots.length > 0) openLots = instLots
      }

      let remaining = qtyToClose
      const closedResults = []
      for (const lot of openLots) {
        if (remaining <= 0) break
        const closable = Math.min(remaining, lot.quantity)
        const realizedGain = (closePrice - lot.costBasis) * closable

        if (closable >= lot.quantity - QTY_EPSILON) {
          tx.update(fs.doc(db, `users/${uid}/lots`, lot.id), {
            status: 'closed', quantity: closable, closedDate: closeDate, closedPrice: closePrice, realizedGain,
          })
        } else {
          tx.update(fs.doc(db, `users/${uid}/lots`, lot.id), {
            quantity: roundQty(lot.quantity - closable),
          })
          const closedId = `${lot.id}-closed-${Date.now()}`
          const { id: _lotId, ...lotData } = lot
          tx.set(fs.doc(db, `users/${uid}/lots`, closedId), {
            ...lotData, quantity: closable, status: 'closed',
            closedDate: closeDate, closedPrice: closePrice, realizedGain,
            createdAt: lot.createdAt,
          })
        }

        closedResults.push({ lotId: lot.id, quantity: closable, costBasis: lot.costBasis, realizedGain })
        remaining -= closable
      }
      return closedResults
    })
  }, [uid])

  // Atomic money-movement helpers — all writes in a single writeBatch so a
  // partial failure cannot leave money debited from one account but never
  // credited to the other (or duplicated).
  // Drops undefined (Firestore rejects it) AND a caller-supplied `id` — every
  // write site here builds its own deterministic doc id and the doc body must
  // never carry one, or a read path that ever spreads data before d.id (see
  // useFirestoreItems' listeners) would silently resurrect the wrong id.
  const strip = (o) => { const { id: _id, ...rest } = o || {}; return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) }
  // Deterministic id (no nonce) so retrying a failed atomic write overwrites the
  // same transaction doc instead of creating a duplicate.
  const txDocId = (tx) => {
    const amt = Math.round((tx.totalAmount || 0) * 100)
    return `${tx.date || 'nodate'}-${(tx.symbol || 'nosym').toUpperCase()}-${tx.type || 'tx'}-${amt}`
  }

  const transferFunds = useCallback(async ({ fromId, fromFields, toId, toFields, transaction }) => {
    if (!uid) throw new Error('No uid')
    const { db, fs } = await getFirebase()
    const batch = fs.writeBatch(db)
    batch.update(fs.doc(db, `users/${uid}/items`, fromId), strip(fromFields))
    batch.update(fs.doc(db, `users/${uid}/items`, toId), strip(toFields))
    if (transaction) {
      batch.set(fs.doc(db, `users/${uid}/transactions`, txDocId(transaction)), strip({ ...transaction, createdAt: new Date().toISOString() }))
    }
    await batch.commit()
  }, [uid])

  // Fully atomic sale: source item update + SELL/WITHDRAWAL txs + destination
  // credit + destination lot + source-lot FIFO close all in ONE Firestore
  // transaction. Either everything commits or nothing does — no money vanishes
  // and lots can never desync from the item. Idempotent on retry (deterministic
  // ids), and runTransaction auto-retries on contention.
  const executeSaleAtomic = useCallback(async ({ itemId, itemFields, transactions = [], destId, destFields, destLot, lotClose }) => {
    if (!uid) throw new Error('No uid')
    const { db, fs } = await getFirebase()
    return fs.runTransaction(db, async (tx) => {
      // --- READS FIRST (Firestore requires all reads before any writes) ---
      let closes = []
      if (lotClose && lotClose.symbol && lotClose.qty > 0) {
        const lotsSnap = await tx.get(fs.query(
          fs.collection(db, `users/${uid}/lots`),
          fs.where('symbol', '==', lotClose.symbol),
          fs.where('status', '==', 'open'),
        ))
        let openLots = lotsSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((l) => l.quantity > 0)
          .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))
        if (lotClose.institution) {
          const instLots = openLots.filter((l) => l.institution === lotClose.institution)
          if (instLots.length > 0) openLots = instLots
        }
        let remaining = lotClose.qty
        for (const lot of openLots) {
          if (remaining <= 0) break
          const closable = Math.min(remaining, lot.quantity)
          closes.push({ lot, closable, realizedGain: (lotClose.price - lot.costBasis) * closable })
          remaining -= closable
        }
      }

      // --- WRITES ---
      tx.update(fs.doc(db, `users/${uid}/items`, itemId), strip(itemFields))

      for (const c of closes) {
        if (c.closable >= c.lot.quantity - QTY_EPSILON) {
          tx.update(fs.doc(db, `users/${uid}/lots`, c.lot.id), {
            status: 'closed', quantity: c.closable, closedDate: lotClose.date, closedPrice: lotClose.price, realizedGain: c.realizedGain,
          })
        } else {
          tx.update(fs.doc(db, `users/${uid}/lots`, c.lot.id), { quantity: roundQty(c.lot.quantity - c.closable) })
          // Deterministic closed-lot id (date, not Date.now()) so a transaction
          // retry overwrites the same doc instead of duplicating it.
          const closedId = `${c.lot.id}-closed-${lotClose.date}`
          const { id: _lotId, ...lotData } = c.lot
          tx.set(fs.doc(db, `users/${uid}/lots`, closedId), {
            ...lotData, quantity: c.closable, status: 'closed',
            closedDate: lotClose.date, closedPrice: lotClose.price, realizedGain: c.realizedGain,
            createdAt: c.lot.createdAt,
          })
        }
      }

      transactions.forEach((t) => {
        tx.set(fs.doc(db, `users/${uid}/transactions`, txDocId(t)), strip({ ...t, createdAt: new Date().toISOString() }))
      })

      if (destId && destFields) {
        tx.update(fs.doc(db, `users/${uid}/items`, destId), strip(destFields))
      }
      if (destLot) {
        const qty = Math.round((destLot.quantity || 0) * 1e8)
        const cost = Math.round((destLot.costBasis || 0) * 100)
        const inst = (destLot.institution || '').replace(/[/\\]/g, '-').slice(0, 20)
        const lid = `${(destLot.symbol || 'lot').toUpperCase()}-${destLot.acquisitionDate || 'nodate'}-${qty}-${cost}${inst ? `-${inst}` : ''}`
        tx.set(fs.doc(db, `users/${uid}/lots`, lid), strip({ ...destLot, status: 'open', createdAt: new Date().toISOString() }))
      }
    })
  }, [uid])

  const executeContribution = useCallback(async ({ itemId, itemFields, transaction, newLot, lotClose, prefFields }) => {
    if (!uid) throw new Error('No uid')
    const { db, fs } = await getFirebase()
    return fs.runTransaction(db, async (tx) => {
      // --- READS (only needed for withdraw / FIFO close) ---
      let closes = []
      if (lotClose && lotClose.symbol && lotClose.qty > 0) {
        const lotsSnap = await tx.get(fs.query(
          fs.collection(db, `users/${uid}/lots`),
          fs.where('symbol', '==', lotClose.symbol),
          fs.where('status', '==', 'open'),
        ))
        let openLots = lotsSnap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((l) => l.quantity > 0)
          .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))
        if (lotClose.institution) {
          const instLots = openLots.filter((l) => l.institution === lotClose.institution)
          if (instLots.length > 0) openLots = instLots
        }
        let remaining = lotClose.qty
        for (const lot of openLots) {
          if (remaining <= 0) break
          const closable = Math.min(remaining, lot.quantity)
          closes.push({ lot, closable, realizedGain: (lotClose.price - lot.costBasis) * closable })
          remaining -= closable
        }
      }

      // --- WRITES ---
      const itemRef = fs.doc(db, `users/${uid}/items`, itemId)
      tx.update(itemRef, strip(itemFields))

      for (const c of closes) {
        if (c.closable >= c.lot.quantity - QTY_EPSILON) {
          tx.update(fs.doc(db, `users/${uid}/lots`, c.lot.id), {
            status: 'closed', quantity: c.closable, closedDate: lotClose.date, closedPrice: lotClose.price, realizedGain: c.realizedGain,
          })
        } else {
          tx.update(fs.doc(db, `users/${uid}/lots`, c.lot.id), { quantity: roundQty(c.lot.quantity - c.closable) })
          const closedId = `${c.lot.id}-closed-${lotClose.date}`
          const { id: _lotId, ...lotData } = c.lot
          tx.set(fs.doc(db, `users/${uid}/lots`, closedId), {
            ...lotData, quantity: c.closable, status: 'closed',
            closedDate: lotClose.date, closedPrice: lotClose.price, realizedGain: c.realizedGain,
            createdAt: c.lot.createdAt,
          })
        }
      }

      if (newLot) {
        const qty = Math.round((newLot.quantity || 0) * 1e8)
        const cost = Math.round((newLot.costBasis || 0) * 100)
        const inst = (newLot.institution || '').replace(/[/\\]/g, '-').slice(0, 20)
        const lid = `${(newLot.symbol || 'lot').toUpperCase()}-${newLot.acquisitionDate || 'nodate'}-${qty}-${cost}${inst ? `-${inst}` : ''}`
        tx.set(fs.doc(db, `users/${uid}/lots`, lid), strip({ ...newLot, status: 'open', createdAt: new Date().toISOString() }))
      }

      if (transaction) {
        tx.set(fs.doc(db, `users/${uid}/transactions`, txDocId(transaction)), strip({ ...transaction, createdAt: new Date().toISOString() }))
      }

      if (prefFields) {
        tx.update(itemRef, strip(prefFields))
      }
    })
  }, [uid])

  const addFinanceTransaction = useCallback(async (tx) => {
    if (!uid) return false
    try {
      const { db, fs } = await getFirebase()
      const amt = Math.round((tx.amount || 0) * 100)
      const desc = (tx.description || '').slice(0, 30).replace(/[/\\]/g, '-')
      const nonce = `-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const id = `ftx-${tx.date || 'nodate'}-${desc}-${amt}${nonce}`
      const txData = Object.fromEntries(Object.entries({ ...tx, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
      await fs.setDoc(fs.doc(db, `users/${uid}/financeTransactions`, id), txData)
      return true
    } catch (err) {
      console.error('[finance] add failed', err)
      return false
    }
  }, [uid])

  const updateFinanceTransaction = useCallback(async (txId, fields) => {
    if (!uid || !txId) return false
    try {
      const { db, fs } = await getFirebase()
      const clean = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined))
      if (!Object.keys(clean).length) return false
      await fs.setDoc(fs.doc(db, `users/${uid}/financeTransactions`, txId), clean, { merge: true })
      return true
    } catch (err) {
      console.error('[finance] update failed', err)
      return false
    }
  }, [uid])

  const deleteFinanceTransaction = useCallback(async (txId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/financeTransactions`, txId))
  }, [uid])

  const deleteAllFinanceTransactions = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await deleteAllDocsIn(db, fs, `users/${uid}/financeTransactions`)
  }, [uid])

  const addPortfolio = useCallback(async (portfolio) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const id = `portfolio-${Date.now()}`
    const portfolioData = Object.fromEntries(Object.entries({ ...portfolio, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/portfolios`, id), portfolioData)
    return id
  }, [uid])

  const deletePortfolio = useCallback(async (portfolioId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/portfolios`, portfolioId))
  }, [uid])

  // v3: static-item historical values are now currency-converted to base.
  // v4: market-asset past-month share counts are reconstructed from real trade
  // history (transactions), not import-stamped lots — invalidates docs that
  // cached zeroed/understated stock values before the import date.
  // v16: crypto historical prices now come from CoinGecko (not Yahoo, which
  // collided crypto tickers with unrelated equities) — invalidates docs that
  // cached garbage crypto values.
  // v18: transcribed quarterly NAV ('ibkr_quarterly') now feeds the per-item IBKR
  // scaling, and destination accounts created from a source item now default their
  // acquisition date to the source's, instead of "today" — invalidates docs that
  // cached values computed before either was true (e.g. VITALI reading ~5,760
  // instead of a flat 6,000 for months before its first backfilled coupon, or a
  // destination account showing no history because it looked created "today").
  // A merge-on-save cache never self-heals a stale entry short of this version
  // bump: `saveItemSnapshots` merges new values OVER old ones, so a wrong number
  // computed once just sits there until the whole month is forced to recompute.
  // v19: inferred deposits/withdrawals (lib/inferredFlows.js) can now fill the
  // quarterly-transcribed gap — invalidates docs cached before an accepted
  // inferred flow existed to explain that stretch.
  // v20 (FASE DS): two spreadsheet-correctness fixes land together — (1) a true
  // static asset (bond, bank balance) held-flat with tracked events is now
  // marked `estimated:false` instead of always `true`, so an exact figure
  // (e.g. a bond worth precisely 6,000) stops showing the "~" uncertain marker
  // it never deserved; (2) the missing-months detector in
  // PortfolioSpreadsheet.jsx no longer skips a month just because MOST of the
  // portfolio already has data there — a single item added later than the
  // rest (VITALI + its destination account) could get permanently stuck
  // uncovered for any month that crossed that blanket bar. Invalidates docs
  // cached under either old behavior.
  // v21 (FASE DV): a backfilled coupon whose destination sat at zero now gets
  // credited after the fact (creditableBackfills), so that account's balance
  // changes and every month reconstructed by rewinding from it changes with it
  // — the cached months were all computed from a balance of 0.
  // v22 (FASE DW): el loop de "Calculando historial..." dejaba meses guardados a
  // medias (o vacíos) mientras se cancelaba a sí mismo, así que lo cacheado bajo
  // v21 no es confiable y tiene que recalcularse entero.
  // v23 (FASE FT): FASE FH cambió los meses históricos de IBKR al bucket
  // sintético (IBKR_UNKNOWN_KEY_PREFIX) pero NO subió la versión: el merge de
  // saveItemSnapshots escribió el bucket AL LADO de las acciones por-item
  // cacheadas bajo la lógica vieja, y la fila de categoría sumaba ambos
  // ("Bolsa de Valores" al doble en cada mes pasado, reporte real del
  // usuario). Los docs v22 con esa mezcla no se pueden reparar por merge:
  // recálculo completo.
  // v24 (FASE GL): borrar una cuenta desde Settings dejaba huérfanas sus
  // transacciones de nivel de cuenta (símbolo CASH, sin _linkedItemId) y el
  // recompute mensual posterior al borrado horneó meses con esos flujos sin
  // dueño adentro (Caja & Bancos histórico inflado a ~$7-10K sobre cuentas de
  // ~$600, reporte real). El caché nunca se autocorrige por merge: recálculo
  // completo con el archivo ya limpio.
  // 25 (FASE GU): indexBalanceEvents ahora mueve los DOS saldos de un TRANSFER
  // entre cuentas del usuario. Todo mes ya cacheado se calculó sin esos eventos
  // (la cuenta que recibe, plana hacia atrás en su saldo alto de hoy; la que
  // envía, en su saldo bajo) y el caché nunca se autocorrige por merge.
  // 26 (FASE IX4): /api/prices/chart pedía `days=max` a CoinGecko para cualquier
  // tabla que abarcara más de un año, y la API pública lo RECHAZA (solo sirve
  // 365 días), así que devolvía vacío y toda la cripto caía a "~ estimado"
  // plano en su valor de HOY. Los meses ya cacheados guardaron ese plano (el
  // caso real: LEGDER en ~$1,008 durante oct/nov/dic 2025, cuando la gráfica de
  // esa misma cuenta dice ~$2,000), y el caché no se autocorrige por merge.
  // 27 (FASE IX6): el rendimiento reinvertido se indexaba por SÍMBOLO, así que
  // dos cuentas homónimas sin ticker propio (DOS "ClubCashIn") se acreditaban
  // el rendimiento de ambas. Todo mes cacheado tiene esa mezcla horneada.
  //
  // El NÚMERO vive en lib/snapshotVersion.js (FASE IE): el spreadsheet adjunto
  // del correo mensual lee estos mismos docs del lado del servidor y tiene que
  // rechazar versiones viejas con la misma vara. Bumpear allá, documentar acá.

  const saveItemSnapshots = useCallback(async (monthKey, itemsData, currency) => {
    if (!uid || !monthKey || !itemsData) return
    // Same demo-mode veto as saveSnapshot: no persistent history from sample data.
    if (items.some((i) => i._source === 'demo')) return
    const { db, fs } = await getFirebase()
    const ref = fs.doc(db, `users/${uid}/itemSnapshots`, monthKey)
    const existing = await fs.getDoc(ref)
    // FASE FT: un doc de versión vieja es INVÁLIDO (loadItemSnapshots ya se
    // niega a leerlo); fusionar datos nuevos sobre él lo resucita, con la
    // versión nueva estampada encima del contenido viejo. Así fue como el
    // bucket sintético de FH terminó sumándose al lado de las acciones
    // por-item cacheadas bajo la lógica anterior. Versión vieja => reemplazo
    // completo del doc, nunca merge.
    const existingData = existing.exists() ? existing.data() : null
    const staleVersion = existingData != null && (existingData._version || 0) < SNAPSHOT_VERSION
    const existingItems = existingData && !staleVersion ? (existingData.items || {}) : {}
    const snapData = Object.fromEntries(Object.entries({
      monthKey,
      items: { ...existingItems, ...itemsData },
      savedAt: new Date().toISOString(),
      _version: SNAPSHOT_VERSION,
      ...(currency ? { _currency: currency } : {}),
    }).filter(([, v]) => v !== undefined))
    await fs.setDoc(ref, snapData, staleVersion ? undefined : { merge: true })
  }, [uid, items])

  const loadItemSnapshots = useCallback(async (monthKeys) => {
    if (!uid || !monthKeys || monthKeys.length === 0) return {}
    const result = {}
    const currencies = {}
    const { db, fs } = await getFirebase()
    await Promise.all(monthKeys.map(async (key) => {
      try {
        const docSnap = await fs.getDoc(fs.doc(db, `users/${uid}/itemSnapshots`, key))
        if (docSnap.exists()) {
          const data = docSnap.data()
          if ((data._version || 0) >= SNAPSHOT_VERSION) {
            result[key] = data.items || {}
            if (data._currency) currencies[key] = data._currency
          }
        }
      } catch {}
    }))
    return { ...result, __currencies: currencies }
  }, [uid])

  // FASE GB. Mientras un bulkImport está escribiendo, la colección de items
  // pasa por estados INTERMEDIOS (los lotes van de a 30 operaciones: altas,
  // updates y borrados aterrizan en commits distintos y el listener entrega
  // cada estado a medio camino). Cualquier efecto que SUME el portafolio en
  // esa ventana puede ver items duplicados y grabar un total inflado en un
  // snapshot permanente: así se regeneraba la meseta de ~$35K cada vez que la
  // limpieza la borraba y un sync estaba en vuelo (el gate de pricesFetching
  // de FASE FE solo cubría refrescos de PRECIOS, no imports). Los escritores
  // de useDashboardData (snapshot diario, backfill, dividendos, limpieza)
  // consultan esta bandera igual que pricesFetching.
  const [bulkWriting, setBulkWriting] = useState(false)

  const bulkImport = useCallback(async ({ items: newItems, lots: newLots, transactions: newTxs, snapshots: newSnaps, updateItems, deleteIds }, onProgress) => {
    if (!uid) throw new Error('Not authenticated')
    setBulkWriting(true)
    try {
    const { db, fs } = await getFirebase()
    const now = new Date().toISOString()
    // Drops undefined AND a caller-supplied `id` — see the hook-scope strip()
    // for why a stray id in the doc body is a landmine, not a no-op.
    const strip = (obj) => { const { id: _id, ...rest } = obj || {}; return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) }

    const ops = []

    for (const id of (deleteIds || [])) {
      ops.push({ type: 'delete', ref: fs.doc(db, `users/${uid}/items`, id) })
    }

    for (const item of (newItems || [])) {
      const id = item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const { id: _removed, ...raw } = item
      const data = sanitizeImportItem(raw)
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/items`, id), data: strip({ ...data, createdAt: now }), merge: true })
    }

    for (const { id, fields } of (updateItems || [])) {
      const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
      ops.push({ type: 'update', ref: fs.doc(db, `users/${uid}/items`, id), data: clean })
    }

    for (const lot of (newLots || [])) {
      const qty = Math.round((lot.quantity || 0) * 1e8)
      const cost = Math.round((lot.costBasis || 0) * 100)
      const inst = (lot.institution || '').replace(/[/\\]/g, '-').slice(0, 20)
      const id = `${(lot.symbol || 'lot').toUpperCase()}-${lot.acquisitionDate || 'nodate'}-${qty}-${cost}${inst ? `-${inst}` : ''}`
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/lots`, id), data: strip({ ...lot, status: 'open', createdAt: now }) })
    }

    for (const tx of (newTxs || [])) {
      const amt = Math.round((tx.totalAmount || tx.amount || 0) * 100)
      // Append a broker-provided transaction id when present (IBKR cash flows) so
      // two same-day/same-amount deposits don't collapse into one doc.
      const base = `${tx.date || 'nodate'}-${(tx.symbol || 'nosym').toUpperCase()}-${tx.type || 'tx'}-${amt}`
      const id = tx._ibkrTxnId ? `${base}-${tx._ibkrTxnId}` : base
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/transactions`, id), data: strip({ ...tx, createdAt: now }) })
    }

    // Precedence: a lower-authority import must never overwrite a higher-
    // authority observation already on file for that date — it can only fill
    // a gap or refresh same-or-higher-tier data. Without this, re-importing an
    // older/narrower file (or one that estimates where an earlier one
    // observed) silently downgrades a real NAV to a worse one.
    // Per-account calibration anchors (_account) are NOT portfolio NAV: they
    // must not participate in same-date precedence or their 'manual' priority
    // would block a real daily/ibkr import landing on the anchor date.
    const existingSnapByDate = new Map((snapshots || []).filter((s) => s && !s._account).map((s) => [s.date || s.id, s]))
    for (const snap of (newSnaps || [])) {
      // FASE FU: `_docId` es una decisión explícita del caller (el planificador
      // de NAV de IBKR) de escribir un doc PARALELO (`fecha~nav~ibkr`) en vez
      // de pelear por el doc plano de la fecha: la precedencia por fecha no
      // aplica, el caller ya resolvió la colisión apartándose de ella.
      const { _docId, ...body } = snap
      const id = _docId || snap.date || now.split('T')[0]
      if (!_docId) {
        const existing = existingSnapByDate.get(id)
        if (existing) {
          const incoming = SNAPSHOT_SRC_PRIORITY[snap._source] || 0
          const current = SNAPSHOT_SRC_PRIORITY[existing._source] || 0
          if (incoming < current) continue
        }
      }
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/snapshots`, id), data: strip({ ...body, createdAt: now }) })
    }

    const CHUNK = 30
    let done = 0
    const total = ops.length
    if (onProgress) onProgress(0, total)

    let failures = 0
    let consecutiveTimeouts = 0
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK)
      const batch = fs.writeBatch(db)
      for (const op of chunk) {
        if (op.type === 'delete') batch.delete(op.ref)
        else if (op.type === 'update') batch.update(op.ref, op.data)
        else if (op.merge) batch.set(op.ref, op.data, { merge: true })
        else batch.set(op.ref, op.data)
      }
      try {
        await Promise.race([
          batch.commit(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('commit-timeout')), 60000)),
        ])
        consecutiveTimeouts = 0
      } catch (err) {
        console.error(`[bulkImport] Batch ${Math.floor(i / CHUNK) + 1} failed:`, err?.code || err?.message)
        failures += chunk.length
        if (err?.message === 'commit-timeout') {
          consecutiveTimeouts++
          if (consecutiveTimeouts >= 5) {
            if (onProgress) onProgress(done, total)
            throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.')
          }
          try { await fs.disableNetwork(db); await fs.enableNetwork(db) } catch {}
        }
      }
      done += chunk.length
      if (onProgress) onProgress(done, total)
    }
    if (failures > 0) throw new Error(`${failures} of ${total} operations failed`)
    } finally {
      // Un pequeño colchón tras el último commit: el listener de Firestore
      // entrega el estado final un instante después; soltar la bandera en el
      // mismo tick reabriría la ventana con el penúltimo estado aún en memoria.
      setTimeout(() => setBulkWriting(false), 1500)
    }
  }, [uid, snapshots])

  return {
    items, snapshots, transactions, alerts, lots, portfolios, financeTransactions, goals, settings, profile, incomePlan, loading,
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
    addFinanceTransaction, updateFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    addAlert, deleteAlert, updateAlert,
    addLot, updateLot, closeLotsFIFO,
    transferFunds, executeSaleAtomic, executeContribution,
    bulkImport, bulkWriting, deletionEpoch,
    addPortfolio, deletePortfolio,
    saveGoals, saveSettings, saveProfile, saveIncomePlan,
    saveItemSnapshots, loadItemSnapshots,
  }
}
