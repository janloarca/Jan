'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getFirebase } from '@/lib/firebase'
import { detectMisstampedMonthlyNavSnapshots } from '@/lib/badDataCleanup'
import { migrateTransaction } from '@/lib/transactionTypes'
import { sanitizeItem } from '@/lib/sanitize'
import { sanitizeImportItem } from '@/lib/bulkImport'
import { isDemoItem, isDemoTransaction } from '@/lib/demoItems'
import { stripEmojis } from '@/lib/utils'
import { shouldHoldFlat, SNAPSHOT_SRC_PRIORITY } from '@/components/dashboard/utils'

// Profile is stored in Firestore but also mirrored to localStorage (keyed by
// uid) so the UI has something to render while Firestore loads — and so demo
// users can "Edit" their profile locally without ever touching Firebase.
const lsKey = (uid) => `chispu_profile_${uid}`

export function useFirestoreItems(uid) {
  const [items, setItems] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [transactions, setTransactions] = useState([])
  const [alerts, setAlerts] = useState([])
  const [lots, setLots] = useState([])
  const [portfolios, setPortfolios] = useState([])
  const [financeTransactions, setFinanceTransactions] = useState([])
  const [goals, setGoals] = useState(null)
  const [settings, setSettings] = useState(null)
  const [profile, setProfile] = useState(() => {
    if (typeof window === 'undefined' || !uid) return null
    try {
      const raw = localStorage.getItem(lsKey(uid))
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  // Demo mode (uid === 'demo') deliberately skips ALL Firestore listeners and
  // mutations: the dashboard then renders from seed items and local state only.
  const isDemo = uid === 'demo'

  useEffect(() => {
    if (!uid || isDemo) {
      setLoading(false)
      return
    }

    let cancelled = false
    const unsubs = []

    async function setup() {
      const { db, fs } = await getFirebase()
      if (cancelled) return

      const u = (fn) => unsubs.push(fn)

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/items`), (snap) => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] items listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/snapshots`), (snap) => {
        setSnapshots(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] snapshots listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/transactions`), (snap) => {
        setTransactions(snap.docs.map(d => migrateTransaction({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] transactions listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/alerts`), (snap) => {
        setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] alerts listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/lots`), (snap) => {
        setLots(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] lots listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/portfolios`), (snap) => {
        setPortfolios(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] portfolios listener:', err)))

      u(fs.onSnapshot(fs.collection(db, `users/${uid}/financeTransactions`), (snap) => {
        setFinanceTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }, (err) => console.error('[Firestore] financeTransactions listener:', err)))

      u(fs.onSnapshot(fs.doc(db, `users/${uid}/config`, 'goals'), (snap) => {
        setGoals(snap.exists() ? snap.data() : null)
      }, (err) => console.error('[Firestore] goals listener:', err)))

      u(fs.onSnapshot(fs.doc(db, `users/${uid}/config`, 'settings'), (snap) => {
        setSettings(snap.exists() ? snap.data() : null)
      }, (err) => console.error('[Firestore] settings listener:', err)))

      u(fs.onSnapshot(fs.doc(db, `users/${uid}/config`, 'profile'), (snap) => {
        if (snap.exists()) {
          const p = snap.data()
          setProfile(p)
          try { localStorage.setItem(lsKey(uid), JSON.stringify(p)) } catch {}
        }
      }, (err) => console.error('[Firestore] profile listener:', err)))

      setLoading(false)
    }

    setup()
    return () => {
      cancelled = true
      unsubs.forEach(u => u())
    }
  }, [uid, isDemo])

  // One-shot healer: early IBKR syncs saved monthly NAV rows with each doc's
  // date stamped at SYNC time (the day the sync ran) instead of the row's own
  // month, so the chart drew a vertical stack of dots on that day. Rewrite the
  // ids to the intended YYYY-MM-01 and drop any that would shadow a real doc.
  // Effects re-run when `snapshots` changes, so gate on a ref, not state.
  const snapHealRef = useRef('idle')
  useEffect(() => {
    if (!uid || isDemo || snapHealRef.current !== 'idle') return
    if (!snapshots.some(s => s._source === 'ibkr')) return
    const bad = detectMisstampedMonthlyNavSnapshots(snapshots)
    if (bad.length === 0) { snapHealRef.current = 'done'; return }
    snapHealRef.current = 'running'
    ;(async () => {
      const { db, fs } = await getFirebase()
      for (const m of bad) {
        try {
          if (m.action === 'delete') {
            await fs.deleteDoc(fs.doc(db, `users/${uid}/snapshots`, m.id))
          } else {
            const { id: _id, ...rest } = m.snap
            await saveSnapshot({ ...rest, date: m.monthKey })
            await fs.deleteDoc(fs.doc(db, `users/${uid}/snapshots`, m.id))
          }
        } catch (err) {
          console.error('[snap-heal]', m.id, err)
        }
      }
      snapHealRef.current = 'done'
    })()
  }, [uid, isDemo, snapshots])

  // Firestore rejects undefined field values (and NaN). Strip undefined
  // recursively before every write; sanitize inputs at the boundary instead.
  // Also strip `id`: callers spread Firestore docs ({ id, ...data }) and a stray
  // `id` inside the doc body is a landmine — e.g. updateLot(newId, oldLot) would
  // write oldLot.id INTO newId's document, breaking every future update.
  const strip = (obj) => {
    if (Array.isArray(obj)) return obj.map(strip)
    if (obj && typeof obj === 'object') {
      const { id: _id, ...rest } = obj
      return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, strip(v)]))
    }
    return obj
  }

  const saveProfile = useCallback(async (data) => {
    if (!uid) throw new Error('Not authenticated')
    // Always mirror locally (instant UI + demo persistence).
    try { localStorage.setItem(lsKey(uid), JSON.stringify(data)) } catch {}
    setProfile(data)
    if (isDemo) return
    const { db, fs } = await getFirebase()
    await fs.setDoc(fs.doc(db, `users/${uid}/config`, 'profile'), strip(data), { merge: true })
  }, [uid, isDemo])

  const addItem = useCallback(async (item) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const data = sanitizeItem(item)
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/items`), strip({ ...data, createdAt: new Date().toISOString() }))
    return ref.id
  }, [uid, isDemo])

  const updateItem = useCallback(async (id, fields) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/items`, id), strip(fields))
  }, [uid, isDemo])

  const deleteItem = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/items`, id))
  }, [uid, isDemo])

  const deleteAllItems = useCallback(async () => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/items`))
    const batch = fs.writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }, [uid, isDemo])

  // Delete an item AND its dependent records (transactions, lots) atomically.
  // Linked records are matched by symbol AND optionally account/institution to
  // avoid nuking e.g. AAPL@IBKR transactions when deleting AAPL@Manual.
  const deleteItemGroup = useCallback(async ({ itemId, symbol, institution, source, deleteTransactions = true }) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const batch = fs.writeBatch(db)
    const isIBKR = source === 'ibkr'

    // 1. Delete the item itself
    batch.delete(fs.doc(db, `users/${uid}/items`, itemId))

    if (deleteTransactions && symbol) {
      // 2. Delete matching transactions
      const txSnap = await fs.getDocs(fs.collection(db, `users/${uid}/transactions`))
      for (const d of txSnap.docs) {
        const t = d.data()
        if ((t.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
        if (isIBKR && t._source !== 'ibkr') continue
        if (!isIBKR && institution && t._source === 'ibkr') continue
        batch.delete(d.ref)
      }

      // 3. Close/delete matching open lots
      const lotSnap = await fs.getDocs(fs.collection(db, `users/${uid}/lots`))
      for (const d of lotSnap.docs) {
        const l = d.data()
        if ((l.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
        if (l.status === 'closed') continue
        if (institution && l.institution && l.institution.toLowerCase() !== institution.toLowerCase()) continue
        if (institution && !l.institution) continue
        batch.delete(d.ref)
      }
    }

    await batch.commit()
  }, [uid, isDemo])

  // For per-institution DailyNAV snapshots (IBKR), the itemId is the account key.
  // For manual items, it's the item's Firestore doc id.
  const saveSnapshot = useCallback(async (snapshot, options = {}) => {
    if (!uid || isDemo) return
    const { db, fs } = await getFirebase()
    // Accept { date } or { month } ({ month:'YYYY-MM' } → first of that month).
    let dateStr = snapshot.date || (snapshot.month ? `${snapshot.month}-01` : null) || new Date().toISOString().split('T')[0]

    // Per-item daily snapshot: stored in its own collection so it never
    // collides with portfolio NAV documents (id = itemId~date).
    if (snapshot._itemId) {
      const itemSnapId = `${String(snapshot._itemId).replace(/[^a-z0-9_-]+/gi, '-')}~${dateStr}`
      await fs.setDoc(fs.doc(db, `users/${uid}/itemSnapshots`, itemSnapId), strip({
        ...snapshot,
        date: dateStr,
        createdAt: new Date().toISOString(),
      }), { merge: true })
      return
    }

    // Calibration anchors share their date with real NAV snapshots (a YTD
    // calibration sits on Jan 1, where a daily snapshot may also live): a
    // compound id keeps them from overwriting each other. This now applies to
    // GLOBAL calibrations too (suffix 'global'), which used to collide with
    // the NAV doc of the anchor date and poison the real series. Non-calibrated
    // portfolio-wide snapshots keep the plain date id so dedup/precedence
    // logic is untouched.
    const id = snapshot._calibrated
      ? `${dateStr}~${snapshot._calibrationKind || 'cal'}~${snapshot._account ? String(snapshot._account).replace(/[^a-z0-9]+/gi, '-') : 'global'}`
      : snapshot._account
        ? `${dateStr}~${snapshot._calibrationKind || 'cal'}~${String(snapshot._account).replace(/[^a-z0-9]+/gi, '-')}`
        : dateStr
    await fs.setDoc(fs.doc(db, `users/${uid}/snapshots`, id), strip({
      ...snapshot,
      date: dateStr,
      createdAt: new Date().toISOString(),
    }), { merge: true })
  }, [uid, isDemo])

  const deleteSnapshot = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/snapshots`, id))
  }, [uid, isDemo])

  const deleteAllSnapshots = useCallback(async () => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/snapshots`))
    const CHUNK = 400
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = fs.writeBatch(db)
      snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
  }, [uid, isDemo])

  // Nuclear option for accounts that connected IBKR before the integration
  // worked end-to-end: delete every document whose origin is the demo seed or
  // an IBKR auto-import (items, transactions, lots, snapshots, finance
  // transactions). Manual entries stay. Runs in chunks so big accounts don't
  // hit the 500-write batch limit.
  const deleteDemoData = useCallback(async (onProgress) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const collections = ['items', 'transactions', 'lots', 'snapshots', 'financeTransactions']
    let done = 0
    for (const col of collections) {
      const snap = await fs.getDocs(fs.collection(db, `users/${uid}/${col}`))
      const victims = snap.docs.filter(d => {
        const data = d.data()
        if (col === 'items') return isDemoItem(data)
        if (col === 'transactions') return isDemoTransaction(data)
        return data._source === 'ibkr'
      })
      for (let i = 0; i < victims.length; i += 400) {
        const batch = fs.writeBatch(db)
        victims.slice(i, i + 400).forEach(d => batch.delete(d.ref))
        await batch.commit()
        done += Math.min(400, victims.length - i)
        if (onProgress) onProgress(done)
      }
    }
    return done
  }, [uid, isDemo])

  const addTransaction = useCallback(async (tx) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/transactions`), strip({
      ...tx,
      createdAt: new Date().toISOString(),
    }))
    return ref.id
  }, [uid, isDemo])

  const updateTransaction = useCallback(async (id, fields) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/transactions`, id), strip(fields))
  }, [uid, isDemo])

  const deleteTransaction = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/transactions`, id))
  }, [uid, isDemo])

  const deleteAllTransactions = useCallback(async () => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/transactions`))
    const batch = fs.writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }, [uid, isDemo])

  const addFinanceTransaction = useCallback(async (tx) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/financeTransactions`), strip({
      ...tx,
      createdAt: new Date().toISOString(),
    }))
    return ref.id
  }, [uid, isDemo])

  const deleteFinanceTransaction = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/financeTransactions`, id))
  }, [uid, isDemo])

  const deleteAllFinanceTransactions = useCallback(async () => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/financeTransactions`))
    const batch = fs.writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }, [uid, isDemo])

  const addAlert = useCallback(async (alert) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/alerts`), strip({
      ...alert,
      createdAt: new Date().toISOString(),
    }))
    return ref.id
  }, [uid, isDemo])

  const deleteAlert = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/alerts`, id))
  }, [uid, isDemo])

  const updateAlert = useCallback(async (id, fields) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/alerts`, id), strip(fields))
  }, [uid, isDemo])

  const addLot = useCallback(async (lot) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/lots`), strip({
      ...lot,
      status: 'open',
      createdAt: new Date().toISOString(),
    }))
    return ref.id
  }, [uid, isDemo])

  const updateLot = useCallback(async (id, fields) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.updateDoc(fs.doc(db, `users/${uid}/lots`, id), strip(fields))
  }, [uid, isDemo])

  // Sell shares by closing oldest lots first (FIFO). Creates closed lot records
  // or reduces quantities. Returns realized gain.
  const closeLotsFIFO = useCallback(async (symbol, quantityToSell, salePrice, saleDate, institution = null) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()

    // Get open lots for this symbol, oldest first (optionally per institution)
    const lotsSnap = await fs.getDocs(fs.collection(db, `users/${uid}/lots`))
    const openLots = lotsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => (l.symbol || '').toUpperCase() === symbol.toUpperCase() && l.status === 'open'
        && (!institution || (l.institution || '').toLowerCase() === institution.toLowerCase()))
      .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))

    let remaining = quantityToSell
    let totalRealizedGain = 0
    const batch = fs.writeBatch(db)

    for (const lot of openLots) {
      if (remaining <= 0) break

      const lotQty = lot.quantity || 0
      const costBasis = lot.costBasis || 0

      if (lotQty <= remaining) {
        // Close entire lot
        const gain = (salePrice - costBasis) * lotQty
        totalRealizedGain += gain
        batch.update(fs.doc(db, `users/${uid}/lots`, lot.id), strip({
          status: 'closed',
          saleDate,
          salePrice,
          realizedGain: Math.round(gain * 100) / 100,
        }))
        remaining -= lotQty
      } else {
        // Partial close: reduce lot quantity and create a closed lot for the sold portion
        const gain = (salePrice - costBasis) * remaining
        totalRealizedGain += gain
        batch.update(fs.doc(db, `users/${uid}/lots`, lot.id), strip({
          quantity: Math.round((lotQty - remaining) * 1e8) / 1e8,
        }))
        const closedLotRef = fs.doc(fs.collection(db, `users/${uid}/lots`))
        batch.set(closedLotRef, strip({
          ...lot,
          quantity: Math.round(remaining * 1e8) / 1e8,
          status: 'closed',
          saleDate,
          salePrice,
          realizedGain: Math.round(gain * 100) / 100,
          createdAt: new Date().toISOString(),
        }))
        remaining = 0
      }
    }

    await batch.commit()
    return { realizedGain: Math.round(totalRealizedGain * 100) / 100 }
  }, [uid, isDemo])

  // Move cash between two accounts as two linked TRANSFER_IN / TRANSFER_OUT
  // transactions. Cash accounts hold money (they're not investments), so the
  // amounts adjust the two items' values directly; non-cash items are
  // untouched. Writes go in one batch so the pair lands atomically.
  const transferFunds = useCallback(async ({ fromItemId, toItemId, amount, currency, date, note }) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    if (!fromItemId || !toItemId || !amount || amount <= 0) throw new Error('Invalid transfer')
    const { db, fs } = await getFirebase()
    const fromItem = items.find(i => i.id === fromItemId)
    const toItem = items.find(i => i.id === toItemId)
    if (!fromItem || !toItem) throw new Error('Account not found')
    const txDate = date || new Date().toISOString().split('T')[0]
    const batch = fs.writeBatch(db)
    // _linkedItemId lets returns/Dietz flows attribute the leg to an account.
    const outRef = fs.doc(fs.collection(db, `users/${uid}/transactions`))
    batch.set(outRef, strip({
      type: 'TRANSFER_OUT', symbol: fromItem.symbol, institution: fromItem.institution || '',
      quantity: 0, price: 0, amount, totalAmount: amount, currency: currency || fromItem.currency || 'USD',
      date: txDate, note: note || '', _linkedItemId: fromItemId, _transferPair: toItemId,
      createdAt: new Date().toISOString(),
    }))
    const inRef = fs.doc(fs.collection(db, `users/${uid}/transactions`))
    batch.set(inRef, strip({
      type: 'TRANSFER_IN', symbol: toItem.symbol, institution: toItem.institution || '',
      quantity: 0, price: 0, amount, totalAmount: amount, currency: currency || toItem.currency || 'USD',
      date: txDate, note: note || '', _linkedItemId: toItemId, _transferPair: fromItemId,
      createdAt: new Date().toISOString(),
    }))
    if (fromItem.isCash) batch.update(fs.doc(db, `users/${uid}/items`, fromItemId), strip({ quantity: Math.round(((fromItem.quantity || 0) - amount) * 100) / 100 }))
    if (toItem.isCash) batch.update(fs.doc(db, `users/${uid}/items`, toItemId), strip({ quantity: Math.round(((toItem.quantity || 0) + amount) * 100) / 100 }))
    await batch.commit()
    return { outId: outRef.id, inId: inRef.id }
  }, [uid, isDemo, items])

  // Sell part/all of a position atomically: closes lots FIFO, records the SALE
  // transaction and reduces the item quantity, all in one Firestore batch so a
  // half-applied sale can't desync lots from holdings.
  const executeSaleAtomic = useCallback(async ({ item, quantity, salePrice, saleDate }) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    if (!item?.id || !quantity || quantity <= 0) throw new Error('Invalid sale')
    const { db, fs } = await getFirebase()
    const batch = fs.writeBatch(db)
    const qty = quantity

    const lotsSnap = await fs.getDocs(fs.collection(db, `users/${uid}/lots`))
    const openLots = lotsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => (l.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() && l.status === 'open'
        && (!(item.institution || '') || (l.institution || '').toLowerCase() === (item.institution || '').toLowerCase()))
      .sort((a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || ''))

    let remaining = qty
    let totalRealizedGain = 0
    for (const lot of openLots) {
      if (remaining <= 0) break
      const lotQty = lot.quantity || 0
      const costBasis = lot.costBasis || 0
      if (lotQty <= remaining) {
        const gain = (salePrice - costBasis) * lotQty
        totalRealizedGain += gain
        batch.update(fs.doc(db, `users/${uid}/lots`, lot.id), strip({ status: 'closed', saleDate, salePrice, realizedGain: Math.round(gain * 100) / 100 }))
        remaining -= lotQty
      } else {
        const gain = (salePrice - costBasis) * remaining
        totalRealizedGain += gain
        batch.update(fs.doc(db, `users/${uid}/lots`, lot.id), strip({ quantity: Math.round((lotQty - remaining) * 1e8) / 1e8 }))
        const closedLotRef = fs.doc(fs.collection(db, `users/${uid}/lots`))
        batch.set(closedLotRef, strip({ ...lot, quantity: Math.round(remaining * 1e8) / 1e8, status: 'closed', saleDate, salePrice, realizedGain: Math.round(gain * 100) / 100, createdAt: new Date().toISOString() }))
        remaining = 0
      }
    }

    const newQty = Math.round(((item.quantity || 0) - qty) * 1e8) / 1e8
    if (newQty <= 0) batch.delete(fs.doc(db, `users/${uid}/items`, item.id))
    else batch.update(fs.doc(db, `users/${uid}/items`, item.id), strip({ quantity: newQty }))

    const txRef = fs.doc(fs.collection(db, `users/${uid}/transactions`))
    batch.set(txRef, strip({
      type: 'SELL', symbol: item.symbol, institution: item.institution || '',
      quantity: qty, price: salePrice, amount: qty * salePrice, totalAmount: qty * salePrice,
      currency: item.currency || 'USD', date: saleDate,
      _linkedItemId: item.id, createdAt: new Date().toISOString(),
    }))

    await batch.commit()
    return { realizedGain: Math.round(totalRealizedGain * 100) / 100 }
  }, [uid, isDemo])

  // Record a cash contribution to a goal atomically: a CONTRIBUTION transaction
  // (so the goal's "saved so far" advances) plus the optional cash-account debit,
  // in one batch. `cashItemId` null means "from outside the portfolio".
  const executeContribution = useCallback(async ({ goal, amount, currency, date, note, cashItemId }) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    if (!goal?.id || !amount || amount <= 0) throw new Error('Invalid contribution')
    const { db, fs } = await getFirebase()
    const txDate = date || new Date().toISOString().split('T')[0]
    const batch = fs.writeBatch(db)
    const txRef = fs.doc(fs.collection(db, `users/${uid}/transactions`))
    batch.set(txRef, strip({
      type: 'CONTRIBUTION', symbol: (goal.name || 'META').toUpperCase().slice(0, 12),
      institution: goal.institution || '', quantity: 0, price: 0,
      amount, totalAmount: amount, currency: currency || 'USD', date: txDate,
      note: note || '', _goalId: goal.id, createdAt: new Date().toISOString(),
    }))
    if (cashItemId) {
      const cash = items.find(i => i.id === cashItemId)
      if (cash && cash.isCash) {
        batch.update(fs.doc(db, `users/${uid}/items`, cashItemId), strip({ quantity: Math.round(((cash.quantity || 0) - amount) * 100) / 100 }))
      }
    }
    const goalRef = fs.doc(db, `users/${uid}/goals`, goal.id)
    batch.set(goalRef, strip({ ...goal, savedAmount: Math.round(((goal.savedAmount || 0) + amount) * 100) / 100, updatedAt: new Date().toISOString() }), { merge: true })
    await batch.commit()
    return { txId: txRef.id }
  }, [uid, isDemo, items])

  const addPortfolio = useCallback(async (portfolio) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    const ref = await fs.addDoc(fs.collection(db, `users/${uid}/portfolios`), strip({
      ...portfolio,
      createdAt: new Date().toISOString(),
    }))
    return ref.id
  }, [uid, isDemo])

  const deletePortfolio = useCallback(async (id) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.deleteDoc(fs.doc(db, `users/${uid}/portfolios`, id))
  }, [uid, isDemo])

  const saveGoals = useCallback(async (data) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.setDoc(fs.doc(db, `users/${uid}/config`, 'goals'), strip(data), { merge: true })
  }, [uid, isDemo])

  const saveSettings = useCallback(async (data) => {
    if (!uid || isDemo) throw new Error('Not authenticated')
    const { db, fs } = await getFirebase()
    await fs.setDoc(fs.doc(db, `users/${uid}/config`, 'settings'), strip(data), { merge: true })
  }, [uid, isDemo])

  // ---- Item price snapshots (monthly per-item close, for the spreadsheet) ----
  const SNAPSHOT_VERSION = 1

  const saveItemSnapshots = useCallback(async (monthKey, itemValues, currency) => {
    if (!uid || isDemo) return
    const { db, fs } = await getFirebase()
    const ref = fs.doc(db, `users/${uid}/itemSnapshots`, monthKey)
    const snapData = strip(Object.entries({
      items: itemValues,
      savedAt: new Date().toISOString(),
      _version: SNAPSHOT_VERSION,
      ...(currency ? { _currency: currency } : {}),
    }).filter(([, v]) => v !== undefined))
    await fs.setDoc(ref, snapData, { merge: true })
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

  const bulkImport = useCallback(async ({ items: newItems, lots: newLots, transactions: newTxs, snapshots: newSnaps, updateItems, deleteIds }, onProgress) => {
    if (!uid) throw new Error('Not authenticated')
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
      const id = snap.date || now.split('T')[0]
      const existing = existingSnapByDate.get(id)
      if (existing) {
        const incoming = SNAPSHOT_SRC_PRIORITY[snap._source] || 0
        const current = SNAPSHOT_SRC_PRIORITY[existing._source] || 0
        if (incoming < current) continue
      }
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
  }, [uid, snapshots])

  return {
    items, snapshots, transactions, alerts, lots, portfolios, financeTransactions, goals, settings, profile, loading,
    addItem, updateItem, deleteItem, deleteAllItems, deleteItemGroup,
    saveSnapshot, deleteSnapshot, deleteAllSnapshots, deleteDemoData,
    addTransaction, updateTransaction, deleteTransaction, deleteAllTransactions,
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
