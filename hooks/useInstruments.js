import { useState, useEffect, useCallback } from 'react'
import { sanitizeInstrumentInput } from '@/lib/instrumentSheet'

// FASE KP. Las fichas de instrumento del asesor (users/{uid}/instruments):
// espejo del patrón de useEntities (onSnapshot + CRUD con imports dinámicos).
// Todo lo que se ESCRIBE pasa por sanitizeInstrumentInput, la misma frontera
// de topes que el resto del sistema de fichas, así que un doc jamás puede
// crecer sin límite ni llevar claves fuera del contrato.

export function useInstruments() {
  const [instruments, setInstruments] = useState([])
  const [loading, setLoading] = useState(true)
  const [uid, setUid] = useState(null)

  useEffect(() => {
    let unsub = () => {}
    let cancelled = false

    async function init() {
      try {
        const { db, auth } = await import('@/lib/firebase')
        const fs = await import('firebase/firestore')
        if (!auth || !db) { setLoading(false); return }

        const { onAuthStateChanged } = await import('firebase/auth')
        const unsubAuth = onAuthStateChanged(auth, (user) => {
          if (cancelled) return
          if (!user) { setLoading(false); return }
          setUid(user.uid)

          unsub = fs.onSnapshot(
            fs.collection(db, `users/${user.uid}/instruments`),
            (snap) => {
              if (cancelled) return
              const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
              docs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
              setInstruments(docs)
              setLoading(false)
            }
          )
        })
        return () => { unsubAuth(); unsub() }
      } catch {
        setLoading(false)
      }
    }

    const cleanup = init()
    return () => {
      cancelled = true
      unsub()
      cleanup?.then?.((fn) => fn?.())
    }
  }, [])

  const saveInstrument = useCallback(async (instrumentId, raw) => {
    if (!uid) return null
    const r = sanitizeInstrumentInput(raw)
    if (!r.ok) throw new Error(r.error)
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    const id = instrumentId || `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    // setDoc SIN merge a propósito: el cuerpo saneado ES el doc completo, y
    // con merge un campo borrado en el editor sobreviviría a la escritura
    // (la lección de FASE FT con los mapas fusionados campo a campo).
    await fs.setDoc(fs.doc(db, `users/${uid}/instruments`, id), {
      ...r.data,
      updatedAt: now,
      ...(instrumentId ? {} : { createdAt: now }),
    })
    return id
  }, [uid])

  const deleteInstrument = useCallback(async (instrumentId) => {
    if (!uid || !instrumentId) return
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    await fs.deleteDoc(fs.doc(db, `users/${uid}/instruments`, instrumentId))
  }, [uid])

  return { instruments, loading, saveInstrument, deleteInstrument }
}
