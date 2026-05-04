import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

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
