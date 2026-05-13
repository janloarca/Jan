import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

let adminApp = null

function getAdminApp() {
  if (adminApp) return adminApp
  if (getApps().length > 0) {
    adminApp = getApps()[0]
    return adminApp
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    const missing = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY']
      .filter((k) => !process.env[k])
    console.error(`[firebase-admin] Missing env vars: ${missing.join(', ')}. Auth and database features will not work.`)
    return null
  }

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  })

  return adminApp
}

export function getAdminAuth() {
  const app = getAdminApp()
  if (!app) return null
  return getAuth(app)
}

export function getAdminDb() {
  const app = getAdminApp()
  if (!app) return null
  return getFirestore(app)
}
