import { useState, useEffect, useCallback } from 'react'

const ENTITY_TYPES = [
  { key: 'personal', icon: '👤', es: 'Personal', en: 'Personal' },
  { key: 'business', icon: '🏢', es: 'Empresa', en: 'Business' },
  { key: 'family', icon: '👨‍👩‍👧‍👦', es: 'Familia', en: 'Family' },
  { key: 'custom', icon: '📁', es: 'Personalizado', en: 'Custom' },
]

const DEFAULT_ENTITY = { id: 'default', name: 'Personal', type: 'personal', icon: '👤', isDefault: true }

export { ENTITY_TYPES, DEFAULT_ENTITY }

export function useEntities() {
  const [entities, setEntities] = useState([DEFAULT_ENTITY])
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
            fs.collection(db, `users/${user.uid}/entities`),
            (snap) => {
              if (cancelled) return
              const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
              if (docs.length === 0) {
                setEntities([DEFAULT_ENTITY])
              } else {
                setEntities(docs)
              }
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
      cleanup?.then?.(fn => fn?.())
    }
  }, [])

  const addEntity = useCallback(async (entity) => {
    if (!uid) return
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    const id = `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const data = Object.fromEntries(Object.entries({
      name: entity.name,
      type: entity.type || 'custom',
      icon: entity.icon || '📁',
      createdAt: new Date().toISOString(),
    }).filter(([, v]) => v !== undefined))
    await fs.setDoc(fs.doc(db, `users/${uid}/entities`, id), data)

    if (entities.length === 1 && entities[0].id === 'default' && entities[0].isDefault) {
      await fs.setDoc(fs.doc(db, `users/${uid}/entities`, 'default'), {
        name: DEFAULT_ENTITY.name,
        type: DEFAULT_ENTITY.type,
        icon: DEFAULT_ENTITY.icon,
        createdAt: new Date().toISOString(),
      })
    }

    return id
  }, [uid, entities])

  const updateEntity = useCallback(async (entityId, data) => {
    if (!uid) return
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    await fs.updateDoc(fs.doc(db, `users/${uid}/entities`, entityId), data)
  }, [uid])

  const deleteEntity = useCallback(async (entityId) => {
    if (!uid || entityId === 'default') return
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    await fs.deleteDoc(fs.doc(db, `users/${uid}/entities`, entityId))
  }, [uid])

  return { entities, loading, addEntity, updateEntity, deleteEntity }
}
