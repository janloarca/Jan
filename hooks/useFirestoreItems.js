import { useState, useEffect, useCallback } from 'react'

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

function sanitizeItem(raw) {
  return {
    ...raw,
    quantity: Number(raw.quantity) || 0,
    purchasePrice: Number(raw.purchasePrice) || 0,
    currentPrice: raw.currentPrice != null ? Number(raw.currentPrice) || 0 : undefined,
    incomeAmount: raw.incomeAmount != null ? Number(raw.incomeAmount) || 0 : 0,
    incomeRate: raw.incomeRate != null ? Number(raw.incomeRate) || 0 : 0,
    rateMin: raw.rateMin != null ? Number(raw.rateMin) || 0 : 0,
    rateMax: raw.rateMax != null ? Number(raw.rateMax) || 0 : 0,
    incomeMonths: Array.isArray(raw.incomeMonths) ? raw.incomeMonths.filter((m) => typeof m === 'number' && m >= 0 && m < 12) : undefined,
  }
}

export function useFirestoreItems() {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [alerts, setAlerts] = useState([])
  const [lots, setLots] = useState([])
  const [portfolios, setPortfolios] = useState([])
  const [goals, setGoals] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState(null)

  useEffect(() => {
    let unsubItems = () => {}
    let unsubSnapshots = () => {}
    let unsubTransactions = () => {}
    let unsubAlerts = () => {}
    let unsubLots = () => {}
    let unsubPortfolios = () => {}
    let cancelled = false

    async function init() {
      const { db, auth, fs } = await getFirebase()
      if (!auth || !db) { setLoading(false); return }

      const user = await waitForAuth(auth)
      if (cancelled) return
      if (!user) { setLoading(false); return }

      const currentUid = user.uid
      setUid(currentUid)

      unsubItems = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/items`),
        (snap) => { if (!cancelled) setItems(snap.docs.map((d) => sanitizeItem({ id: d.id, ...d.data() }))) }
      )
      unsubSnapshots = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/snapshots`), fs.orderBy('date')),
        (snap) => { if (!cancelled) setSnapshots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) }
      )
      unsubTransactions = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/transactions`), fs.orderBy('date')),
        (snap) => {
          if (!cancelled) {
            setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
            setLoading(false)
          }
        }
      )
      unsubAlerts = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/alerts`),
        (snap) => { if (!cancelled) setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) }
      )
      unsubLots = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/lots`),
        (snap) => { if (!cancelled) setLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) }
      )
      unsubPortfolios = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/portfolios`),
        (snap) => { if (!cancelled) setPortfolios(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) }
      )

      try {
        const goalsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'goals'))
        if (!cancelled && goalsDoc.exists()) setGoals(goalsDoc.data())
        const prefsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'preferences'))
        if (!cancelled && prefsDoc.exists()) setSettings(prefsDoc.data())
      } catch {}

      if (!cancelled) setLoading(false)
    }

    init()
    return () => { cancelled = true; unsubItems(); unsubSnapshots(); unsubTransactions(); unsubAlerts(); unsubLots(); unsubPortfolios() }
  }, [])

  const addItem = useCallback(async (item) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const id = item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { id: _removed, ...data } = item
    await fs.setDoc(fs.doc(db, `users/${uid}/items`, id), { ...data, createdAt: new Date().toISOString() }, { merge: true })
  }, [uid])

  const updateItem = useCallback(async (itemId, fields) => {
    if (!uid || !itemId) return
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/items`, itemId), fields)
  }, [uid])

  const deleteItem = useCallback(async (itemId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/items`))
    const orphans = snap.docs.filter(d => {
      const data = d.data()
      return d.id !== itemId && (data.incomeDestination === itemId || data.capitalDestination === itemId)
    })
    for (const orphan of orphans) {
      const updates = {}
      const data = orphan.data()
      if (data.incomeDestination === itemId) updates.incomeDestination = ''
      if (data.capitalDestination === itemId) updates.capitalDestination = ''
      await fs.updateDoc(orphan.ref, updates)
    }
    await fs.deleteDoc(fs.doc(db, `users/${uid}/items`, itemId))
  }, [uid])

  const deleteAllItems = useCallback(async () => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/items`))
    await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)))
  }, [uid])

  const saveSnapshot = useCallback(async (snapshot) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const dateStr = snapshot.date || new Date().toISOString().split('T')[0]
    const id = dateStr
    await fs.setDoc(fs.doc(db, `users/${uid}/snapshots`, id), { ...snapshot, createdAt: new Date().toISOString() })
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
    const id = `${transaction.date}-${transaction.symbol}-${Date.now()}`
    await fs.setDoc(fs.doc(db, `users/${uid}/transactions`, id), { ...transaction, createdAt: new Date().toISOString() })
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
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'goals'), { ...goalsData, updatedAt: new Date().toISOString() })
    setGoals(goalsData)
  }, [uid])

  const saveSettings = useCallback(async (prefsData) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'preferences'), { ...prefsData, updatedAt: new Date().toISOString() }, { merge: true })
    setSettings((prev) => ({ ...prev, ...prefsData }))
  }, [uid])

  const addAlert = useCallback(async (alert) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const id = `${alert.symbol}-${Date.now()}`
    await fs.setDoc(fs.doc(db, `users/${uid}/alerts`, id), { ...alert, createdAt: new Date().toISOString(), triggered: false, triggeredAt: null })
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
    const id = `${lot.symbol || 'lot'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await fs.setDoc(fs.doc(db, `users/${uid}/lots`, id), { ...lot, status: 'open', createdAt: new Date().toISOString() })
  }, [uid])

  const updateLot = useCallback(async (lotId, data) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/lots`, lotId), data)
  }, [uid])

  const closeLotsFIFO = useCallback(async (symbol, qtyToClose, closePrice, closeDate) => {
    if (!uid) return []
    const openLots = lots
      .filter((l) => l.symbol === symbol && l.status === 'open' && l.quantity > 0)
      .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))

    let remaining = qtyToClose
    const closedResults = []
    const { db, fs } = await getFirebase()

    for (const lot of openLots) {
      if (remaining <= 0) break
      const closable = Math.min(remaining, lot.quantity)
      const realizedGain = (closePrice - lot.costBasis) * closable

      if (closable >= lot.quantity - QTY_EPSILON) {
        await fs.updateDoc(fs.doc(db, `users/${uid}/lots`, lot.id), {
          status: 'closed', quantity: 0, closedDate: closeDate, closedPrice: closePrice, realizedGain,
        })
      } else {
        await fs.updateDoc(fs.doc(db, `users/${uid}/lots`, lot.id), {
          quantity: roundQty(lot.quantity - closable),
        })
        const closedId = `${lot.id}-closed-${Date.now()}`
        await fs.setDoc(fs.doc(db, `users/${uid}/lots`, closedId), {
          ...lot, id: undefined, quantity: closable, status: 'closed',
          closedDate: closeDate, closedPrice: closePrice, realizedGain,
          createdAt: lot.createdAt,
        })
      }

      closedResults.push({ lotId: lot.id, quantity: closable, costBasis: lot.costBasis, realizedGain })
      remaining -= closable
    }
    return closedResults
  }, [uid, lots])

  const addPortfolio = useCallback(async (portfolio) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const id = `portfolio-${Date.now()}`
    await fs.setDoc(fs.doc(db, `users/${uid}/portfolios`, id), { ...portfolio, createdAt: new Date().toISOString() })
    return id
  }, [uid])

  const deletePortfolio = useCallback(async (portfolioId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/portfolios`, portfolioId))
  }, [uid])

  return {
    items, snapshots, transactions, alerts, lots, portfolios, goals, settings, loading,
    addItem, updateItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    addAlert, deleteAlert, updateAlert,
    addLot, updateLot, closeLotsFIFO,
    addPortfolio, deletePortfolio,
    saveGoals, saveSettings,
  }
}
