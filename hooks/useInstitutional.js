'use client'

// Modo institucional: qué ve ESTE usuario. Tres señales, y sin ninguna de las
// tres la app es exactamente la de siempre:
//   flag         abrió alguna vez la app con ?institucional=1
//   memberships  firmas donde es miembro activo (espejo users/{uid}/orgMemberships)
//   grants       firmas a las que les dio (o les quitó) acceso de lectura
// Se lee UNA vez por sesión y se comparte entre Header, MobileNav y Ajustes.
import { useEffect, useState } from 'react'

const FLAG_KEY = 'chispu-institucional'
const EMPTY = { loading: true, flag: false, uid: null, memberships: [], grants: [] }
let state = EMPTY
let started = false
const listeners = new Set()

function emit(next) {
  state = next
  listeners.forEach((fn) => fn(state))
}

// ?institucional=1 deja la bandera guardada (como ?brokers=1 en su momento) y
// ?institucional=0 la apaga. Se exporta para que la landing la capture ANTES de
// redirigir al tablero, que si no pierde el query.
export function captureInstitutionalFlag() {
  try {
    const q = new URLSearchParams(window.location.search).get('institucional')
    if (q === '1') localStorage.setItem(FLAG_KEY, '1')
    else if (q === '0') localStorage.removeItem(FLAG_KEY)
    return localStorage.getItem(FLAG_KEY) === '1'
  } catch { return false }
}

const readFlag = captureInstitutionalFlag

// Apagar la bandera desde la interfaz (solo tiene efecto si no hay firma).
export function clearInstitutionalFlag() {
  try { localStorage.removeItem(FLAG_KEY) } catch {}
  emit({ ...state, flag: false })
}

async function load() {
  const flag = readFlag()
  try {
    const { auth, db } = await import('@/lib/firebase')
    const fs = await import('firebase/firestore')
    if (!auth || !db) { emit({ ...EMPTY, loading: false, flag }); return }
    if (typeof auth.authStateReady === 'function') await auth.authStateReady()
    const uid = auth.currentUser?.uid
    if (!uid) { started = false; emit({ ...EMPTY, loading: false, flag }); return }
    const [mem, gr] = await Promise.all([
      fs.getDocs(fs.collection(db, `users/${uid}/orgMemberships`)),
      fs.getDocs(fs.collection(db, `users/${uid}/grants`)),
    ])
    emit({
      loading: false, flag, uid,
      memberships: mem.docs.map((d) => ({ orgId: d.id, ...d.data() })).filter((m) => m.status === 'active'),
      grants: gr.docs.map((d) => ({ orgId: d.id, ...d.data() })),
    })
  } catch {
    emit({ ...EMPTY, loading: false, flag })
  }
}

export function refreshInstitutional() {
  started = true
  return load()
}

export function useInstitutional() {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    setS(state)
    if (!started) { started = true; load() }
    return () => { listeners.delete(setS) }
  }, [])
  const activeGrants = s.grants.filter((g) => g.status === 'active')
  return {
    ...s,
    isAdvisor: s.memberships.length > 0,
    hasAdvisor: activeGrants.length > 0,
    activeGrants,
    // "Para asesores" en Ajustes: por bandera o por ya pertenecer a una firma.
    showAdvisorSetup: s.flag || s.memberships.length > 0,
    refresh: refreshInstitutional,
  }
}
