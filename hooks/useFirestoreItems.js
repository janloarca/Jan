import { useState, useEffect, useCallback } from 'react'
import { sanitizeImportItem } from '@/lib/validation'

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

export function useFirestoreItems() {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [alerts, setAlerts] = useState([])
  const [lots, setLots] = useState([])
  const [portfolios, setPortfolios] = useState([])
  const [financeTransactions, setFinanceTransactions] = useState([])
  const [goals, setGoals] = useState(null)
  const [settings, setSettings] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState(null)

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
      if (!user) { setLoading(false); return }

      const currentUid = user.uid
      setUid(currentUid)

      const onErr = (label) => (err) => { console.error(`[Firestore] ${label} listener error:`, err.code, err.message) }

      unsubItems = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/items`),
        (snap) => {
          if (!cancelled) {
            setItems(snap.docs.map((d) => sanitizeItem({ id: d.id, ...d.data() })))
          }
        },
        onErr('items')
      )
      unsubSnapshots = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/snapshots`), fs.orderBy('date')),
        (snap) => { if (!cancelled) setSnapshots(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() }))) },
        onErr('snapshots')
      )
      unsubTransactions = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/transactions`), fs.orderBy('date')),
        (snap) => {
          if (!cancelled) {
            setTransactions(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() })))
            setLoading(false)
          }
        },
        onErr('transactions')
      )

      try {
        const goalsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'goals'))
        if (!cancelled && goalsDoc.exists()) setGoals(sanitizeDoc(goalsDoc.data()))
        const prefsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'preferences'))
        if (!cancelled && prefsDoc.exists()) setSettings(sanitizeDoc(prefsDoc.data()))
        const profileDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'profile'))
        if (!cancelled && profileDoc.exists()) setProfile(sanitizeDoc(profileDoc.data()))
      } catch {}

      if (!cancelled) setLoading(false)

      unsubAlerts = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/alerts`),
        (snap) => { if (!cancelled) setAlerts(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() }))) },
        onErr('alerts')
      )
      unsubLots = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/lots`),
        (snap) => { if (!cancelled) setLots(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() }))) },
        onErr('lots')
      )
      unsubPortfolios = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/portfolios`),
        (snap) => { if (!cancelled) setPortfolios(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() }))) },
        onErr('portfolios')
      )
      unsubFinanceTx = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/financeTransactions`), fs.orderBy('date', 'desc')),
        (snap) => { if (!cancelled) setFinanceTransactions(snap.docs.map((d) => sanitizeDoc({ id: d.id, ...d.data() }))) },
        onErr('financeTransactions')
      )
    }

    init()
    return () => { cancelled = true; unsubItems(); unsubSnapshots(); unsubTransactions(); unsubAlerts(); unsubLots(); unsubPortfolios(); unsubFinanceTx() }
  }, [])

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
      if (skipRefCleanup) {
        await fs.deleteDoc(fs.doc(db, `users/${uid}/items`, itemId))
      } else {
        const snap = await fs.getDocs(fs.collection(db, `users/${uid}/items`))
        const batch = fs.writeBatch(db)
        snap.docs.forEach((d) => {
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
      const txSnap = await fs.getDocs(fs.collection(db, `users/${uid}/transactions`))
      const txBatch = fs.writeBatch(db)
      let txCount = 0
      txSnap.docs.forEach(d => {
        if (d.data()._linkedItemId === itemId) { txBatch.delete(d.ref); txCount++ }
      })
      if (txCount > 0) await txBatch.commit()

      if (deletedItem?.symbol) {
        const sym = (deletedItem.symbol || '').toUpperCase()
        const hasOtherItemWithSymbol = items.some(it => it.id !== itemId && (it.symbol || '').toUpperCase() === sym)
        if (!hasOtherItemWithSymbol) {
          const lotSnap = await fs.getDocs(fs.collection(db, `users/${uid}/lots`))
          const lotBatch = fs.writeBatch(db)
          let lotCount = 0
          lotSnap.docs.forEach(d => {
            if ((d.data().symbol || '').toUpperCase() === sym) { lotBatch.delete(d.ref); lotCount++ }
          })
          if (lotCount > 0) await lotBatch.commit()
        }
      }

      const isSnap = await fs.getDocs(fs.collection(db, `users/${uid}/itemSnapshots`))
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

  const deleteAllItems = useCallback(async ({ cascade } = {}) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const collections = [`users/${uid}/items`]
    if (cascade) {
      collections.push(`users/${uid}/lots`, `users/${uid}/transactions`, `users/${uid}/snapshots`, `users/${uid}/itemSnapshots`)
    }
    await Promise.all(collections.map(async (path) => {
      const snap = await fs.getDocs(fs.collection(db, path))
      await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)))
    }))
  }, [uid])

  const saveSnapshot = useCallback(async (snapshot) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const dateStr = snapshot.date || new Date().toISOString().split('T')[0]
    const id = dateStr
    const clean = Object.fromEntries(Object.entries({ ...snapshot, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/snapshots`, id), clean, { merge: true })
  }, [uid])

  const deleteAllSnapshots = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/snapshots`))
    await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)))
  }, [uid])

  const addTransaction = useCallback(async (transaction) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const amt = Math.round((transaction.totalAmount || transaction.amount || 0) * 100)
    // Deterministic IDs dedupe auto-generated transactions (daily dividend processing).
    // Manual entries need a nonce so two identical same-day entries don't overwrite each other.
    const isManual = (transaction._source || '').startsWith('manual')
    const nonce = isManual ? `-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : ''
    const id = `${transaction.date || 'nodate'}-${(transaction.symbol || 'nosym').toUpperCase()}-${transaction.type || 'tx'}-${amt}${nonce}`
    const txData = Object.fromEntries(Object.entries({ ...transaction, createdAt: new Date().toISOString() }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/transactions`, id), txData)
  }, [uid])

  const deleteTransaction = useCallback(async (txId) => {
    if (!uid || !txId) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/transactions`, txId))
  }, [uid])

  const deleteAllTransactions = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/transactions`))
    await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)))
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
        .map(d => ({ id: d.id, ...d.data() }))
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
  const strip = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined))
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
          .map((d) => ({ id: d.id, ...d.data() }))
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
          .map((d) => ({ id: d.id, ...d.data() }))
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

  const deleteFinanceTransaction = useCallback(async (txId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/financeTransactions`, txId))
  }, [uid])

  const deleteAllFinanceTransactions = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/financeTransactions`))
    await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)))
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
  const SNAPSHOT_VERSION = 16

  const saveItemSnapshots = useCallback(async (monthKey, itemsData, currency) => {
    if (!uid || !monthKey || !itemsData) return
    const { db, fs } = await getFirebase()
    const ref = fs.doc(db, `users/${uid}/itemSnapshots`, monthKey)
    const existing = await fs.getDoc(ref)
    const existingItems = existing.exists() ? (existing.data().items || {}) : {}
    const snapData = Object.fromEntries(Object.entries({
      monthKey,
      items: { ...existingItems, ...itemsData },
      savedAt: new Date().toISOString(),
      _version: SNAPSHOT_VERSION,
      ...(currency ? { _currency: currency } : {}),
    }).filter(([, v]) => v !== undefined))
    await fs.setDoc(ref, snapData, { merge: true })
  }, [uid])

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

  const bulkImport = useCallback(async ({ items: newItems, lots: newLots, transactions: newTxs, snapshots: newSnaps, updateItems, deleteIds }, onProgress) => {
    if (!uid) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const now = new Date().toISOString()
    const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

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
      const id = `${tx.date || 'nodate'}-${(tx.symbol || 'nosym').toUpperCase()}-${tx.type || 'tx'}-${amt}`
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/transactions`, id), data: strip({ ...tx, createdAt: now }) })
    }

    for (const snap of (newSnaps || [])) {
      const id = snap.date || now.split('T')[0]
      ops.push({ type: 'set', ref: fs.doc(db, `users/${uid}/snapshots`, id), data: strip({ ...snap, createdAt: now }) })
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
  }, [uid])

  return {
    items, snapshots, transactions, alerts, lots, portfolios, financeTransactions, goals, settings, profile, loading,
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteTransaction, deleteAllTransactions,
    addFinanceTransaction, deleteFinanceTransaction, deleteAllFinanceTransactions,
    addAlert, deleteAlert, updateAlert,
    addLot, updateLot, closeLotsFIFO,
    transferFunds, executeSaleAtomic, executeContribution,
    bulkImport,
    addPortfolio, deletePortfolio,
    saveGoals, saveSettings, saveProfile,
    saveItemSnapshots, loadItemSnapshots,
  }
}
