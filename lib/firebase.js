import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// FASE FV. En Safari (iOS sobre todo), el helper de OAuth en
// <proyecto>.firebaseapp.com es un dominio cruzado cuyo storage el navegador
// bloquea: signInWithPopup/Redirect mueren en auth/internal-error. El arreglo
// documentado por Firebase es usar el PROPIO dominio de la app como authDomain
// y servir /__/auth por proxy (next.config.js rewrites). Solo se activa en los
// hosts conocidos: un preview de Vercel u otro dominio no autorizado en
// Firebase Console caería a unauthorized-domain, así que esos siguen con el
// authDomain de siempre. localhost queda FUERA a propósito: Firebase arma el
// helper como https://<authDomain>/... y el dev server corre en http, así que
// en dev se sigue usando firebaseapp.com como toda la vida.
const SAME_ORIGIN_AUTH_HOSTS = ['chispu.xyz', 'www.chispu.xyz']
function resolveAuthDomain() {
  if (typeof window !== 'undefined' && SAME_ORIGIN_AUTH_HOSTS.includes(window.location.hostname)) {
    return window.location.host
  }
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app = null
let auth = null
let db = null
let storage = null

if (typeof window !== 'undefined') {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
}

export { app, auth, db, storage }
