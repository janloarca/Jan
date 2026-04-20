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

export function useFirestoreItems() {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [goals, setGoals] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState(null)

  useEffect(() => {
    let unsubItems = () => {}
    let unsubSnapshots = () => {}
    let unsubTransactions = () => {}
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
        (snap) => { if (!cancelled) setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))) }
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

      try {
        const goalsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'goals'))
        if (!cancelled && goalsDoc.exists()) setGoals(goalsDoc.data())
        const prefsDoc = await fs.getDoc(fs.doc(db, `users/${currentUid}/settings`, 'preferences'))
        if (!cancelled && prefsDoc.exists()) setSettings(prefsDoc.data())
      } catch {}

      if (!cancelled) setLoading(false)
    }

    init()
    return () => { cancelled = true; unsubItems(); unsubSnapshots(); unsubTransactions() }
  }, [])

  const addItem = useCallback(async (item) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
    const sym = (item.symbol || '').replace(/[^a-zA-Z0-9]/g, '_')
    const inst = (item.institution || '').replace(/[^a-zA-Z0-9]/g, '_')
    const id = sym ? `${sym}${inst ? '_' + inst : ''}` : Date.now().toString()
    await fs.setDoc(fs.doc(db, `users/${uid}/items`, id), { ...item, createdAt: new Date().toISOString() }, { merge: true })
  }, [uid])

  const deleteItem = useCallback(async (itemId) => {
    if (!uid) return
    const { db, fs } = await getFirebase()
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

  return {
    items, snapshots, transactions, goals, settings, loading,
    addItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
    saveGoals, saveSettings,
  }
}
