'use client'

import { useCallback, useState } from 'react'

// Un estado de interfaz que se recuerda entre visitas: si una tarjeta quedó
// plegada o en qué pestaña quedó, al volver se abre igual. Solo preferencias
// de vista, jamás datos: vive en localStorage del navegador (por dispositivo),
// y si el almacenamiento no está disponible (ventana privada, iOS con datos
// del sitio bloqueados) se comporta como un useState normal.
//
// `allowed` acota lo que se acepta al leer: una pestaña que existía y ya no
// (o un valor escrito por otra versión de la app) cae al default en vez de
// dejar la tarjeta en un estado que no sabe dibujar.
export function readPersisted(key, fallback, allowed) {
  try {
    if (typeof window === 'undefined' || !key) return fallback
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const val = JSON.parse(raw)
    if (Array.isArray(allowed) && !allowed.includes(val)) return fallback
    if (typeof fallback === 'boolean' && typeof val !== 'boolean') return fallback
    return val
  } catch {
    return fallback
  }
}

export function writePersisted(key, val) {
  try {
    if (typeof window === 'undefined' || !key) return
    window.localStorage.setItem(key, JSON.stringify(val))
  } catch {}
}

export default function usePersistedState(key, fallback, allowed) {
  const [value, setValue] = useState(() => readPersisted(key, fallback, allowed))
  const set = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next
      writePersisted(key, v)
      return v
    })
  }, [key])
  return [value, set]
}
