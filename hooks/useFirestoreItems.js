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

export function useFirestoreItems() {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState(null)

  useEffect(() => {
    let unsubItems = () => {}
    let unsubSnapshots = () => {}
    let unsubTransactions = () => {}

    async function init() {
      const { db, auth, fs } = await getFirebase()
      if (!auth || !db) { setLoading(false); return }

      const currentUid = auth.currentUser?.uid
      if (!currentUid) { setLoading(false); return }
      setUid(currentUid)

      unsubItems = fs.onSnapshot(
        fs.collection(db, `users/${currentUid}/items`),
        (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      )
      unsubSnapshots = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/snapshots`), fs.orderBy('date')),
        (snap) => setSnapshots(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      )
      unsubTransactions = fs.onSnapshot(
        fs.query(fs.collection(db, `users/${currentUid}/transactions`), fs.orderBy('date')),
        (snap) => {
          setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setLoading(false)
        }
      )
    }

    init()
    return () => { unsubItems(); unsubSnapshots(); unsubTransactions() }
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
    const timeStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const id = `${dateStr}-${timeStr}`
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

  return {
    items, snapshots, transactions, loading,
    addItem, deleteItem, deleteAllItems,
    saveSnapshot, deleteAllSnapshots,
    addTransaction, deleteAllTransactions,
  }
}
