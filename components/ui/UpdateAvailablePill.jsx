'use client'

// FASE HM. El aviso VISIBLE de "hay una versión nueva".
//
// Hasta ahora la app intentaba actualizarse sola y en silencio (layout.jsx:
// compara el build del HTML contra /api/version y recarga). Cuando ese intento
// no prospera (iOS Safari puede servir el MISMO documento cacheado, y el guard
// anti-loop impide reintentar), la pestaña se queda en el build viejo sin que
// nada lo diga: un usuario real pasó un día entero, a través de cuatro
// deploys, viendo exactamente la misma pantalla y creyendo que los arreglos no
// funcionaban.
//
// Este componente no reemplaza la recarga automática: es la red de seguridad
// para cuando falla. Solo aparece si el build servido difiere del que está
// corriendo, y ofrece UN toque que fuerza el documento fresco (query param
// nuevo = clave de caché nueva, lo mismo que hace el auto-reload de FASE HK).
// Muestra los dos ids cortos a propósito: en un teléfono no hay consola, y una
// captura de pantalla con esos dos valores dice exactamente qué build está
// corriendo, sin tener que deducirlo.

import { useEffect, useState } from 'react'

const CHECK_MS = 60000

export default function UpdateAvailablePill({ buildId }) {
  const [serverBuild, setServerBuild] = useState(null)

  useEffect(() => {
    if (!buildId || buildId === '__dev__') return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        if (data?.buildId && data.buildId !== '__dev__' && data.buildId !== buildId) {
          setServerBuild(data.buildId)
        } else {
          setServerBuild(null)
        }
      } catch { /* sin red: no hay nada que avisar */ }
    }
    // Después del intento automático de layout.jsx (3s), para no competir con él.
    const first = setTimeout(check, 8000)
    const timer = setInterval(check, CHECK_MS)
    return () => { cancelled = true; clearTimeout(first); clearInterval(timer) }
  }, [buildId])

  if (!serverBuild) return null

  const reload = () => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('_cb', serverBuild.slice(0, 12))
      window.location.replace(u.toString())
    } catch {
      window.location.reload()
    }
  }

  return (
    <button
      onClick={reload}
      className="fixed left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium shadow-lg"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
        backgroundColor: 'var(--accent-blue)',
        color: '#fff',
      }}
    >
      <span>Hay una versión nueva. Tocá para actualizar</span>
      <span style={{ opacity: 0.7 }}>
        {String(buildId).slice(0, 6)}→{String(serverBuild).slice(0, 6)}
      </span>
    </button>
  )
}
