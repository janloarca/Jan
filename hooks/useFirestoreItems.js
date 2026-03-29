import { useState, useEffect, useCallback } from 'react'
import { db, auth } from '@/lib/firebase'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore'

export function useFirestoreItems() {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)

  const uid = auth.currentUser?.uid

  useEffect(() => {
    if (!uid) {
      setLoading(false)
      return
    }

    const unsubItems = onSnapshot(
      collection(db, `users/${uid}/items`),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      }
    )

    const unsubSnapshots = onSnapshot(
      query(collection(db, `users/${uid}/snapshots`), orderBy('date')),
      (snap) => {
        setSnapshots(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      }
    )

    const unsubTransactions = onSnapshot(
      query(collection(db, `users/${uid}/transactions`), orderBy('date')),
      (snap) => {
        setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      }
    )

    return () => {
      unsubItems()
      unsubSnapshots()
      unsubTransactions()
    }
  }, [uid])

  const addItem = useCallback(
    async (item) => {
      if (!uid) return
      const id = item.symbol?.replace(/[^a-zA-Z0-9]/g, '_') || Date.now().toString()
      await setDoc(doc(db, `users/${uid}/items`, id), {
        ...item,
        createdAt: new Date().toISOString(),
      })
    },
    [uid]
  )

  const deleteItem = useCallback(
    async (itemId) => {
      if (!uid) return
      await deleteDoc(doc(db, `users/${uid}/items`, itemId))
    },
    [uid]
  )

  const deleteAllItems = useCallback(async () => {
    if (!uid) return
    const snap = await getDocs(collection(db, `users/${uid}/items`))
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  }, [uid])

  const saveSnapshot = useCallback(
    async (snapshot) => {
      if (!uid) return
      const dateStr = snapshot.date || new Date().toISOString().split('T')[0]
      const timeStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const id = `${dateStr}-${timeStr}`
      await setDoc(doc(db, `users/${uid}/snapshots`, id), {
        ...snapshot,
        createdAt: new Date().toISOString(),
      })
    },
    [uid]
  )

  const deleteAllSnapshots = useCallback(async () => {
    if (!uid) return
    const snap = await getDocs(collection(db, `users/${uid}/snapshots`))
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  }, [uid])

  const addTransaction = useCallback(
    async (transaction) => {
      if (!uid) return
      const id = `${transaction.date}-${transaction.symbol}-${Date.now()}`
      await setDoc(doc(db, `users/${uid}/transactions`, id), {
        ...transaction,
        createdAt: new Date().toISOString(),
      })
    },
    [uid]
  )

  const deleteAllTransactions = useCallback(async () => {
    if (!uid) return
    const snap = await getDocs(collection(db, `users/${uid}/transactions`))
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  }, [uid])

  return {
    items,
    snapshots,
    transactions,
    loading,
    addItem,
    deleteItem,
    deleteAllItems,
    saveSnapshot,
    deleteAllSnapshots,
    addTransaction,
    deleteAllTransactions,
  }
}
