import { useState, useCallback } from 'react'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]

export function useDocumentVault() {
  const [uploading, setUploading] = useState(false)

  const uploadDocument = useCallback(async (uid, itemId, file) => {
    if (!uid || !itemId || !file) throw new Error('Missing parameters')
    if (file.size > MAX_FILE_SIZE) throw new Error('File too large (max 10MB)')
    if (!ALLOWED_TYPES.includes(file.type)) throw new Error('File type not allowed')

    setUploading(true)
    try {
      const { storage } = await import('@/lib/firebase')
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage')
      const { db } = await import('@/lib/firebase')
      const fs = await import('firebase/firestore')

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const timestamp = Date.now()
      const storagePath = `users/${uid}/documents/${itemId}/${timestamp}_${safeName}`
      const storageRef = ref(storage, storagePath)

      await uploadBytes(storageRef, file, { contentType: file.type })
      const url = await getDownloadURL(storageRef)

      const docData = {
        name: file.name,
        type: file.type,
        size: file.size,
        url,
        storagePath,
        uploadedAt: new Date().toISOString(),
      }

      await fs.addDoc(fs.collection(db, `users/${uid}/items/${itemId}/documents`), docData)
      return docData
    } finally {
      setUploading(false)
    }
  }, [])

  const deleteDocument = useCallback(async (uid, itemId, docId, storagePath) => {
    const { storage } = await import('@/lib/firebase')
    const { ref, deleteObject } = await import('firebase/storage')
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')

    try {
      await deleteObject(ref(storage, storagePath))
    } catch {}
    await fs.deleteDoc(fs.doc(db, `users/${uid}/items/${itemId}/documents`, docId))
  }, [])

  const listDocuments = useCallback(async (uid, itemId) => {
    const { db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    const snap = await fs.getDocs(fs.collection(db, `users/${uid}/items/${itemId}/documents`))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  }, [])

  return { uploadDocument, deleteDocument, listDocuments, uploading }
}
