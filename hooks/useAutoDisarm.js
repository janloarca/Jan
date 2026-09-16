'use client'

import { useEffect, useRef } from 'react'

// FASE ND. Los dos-toques ad-hoc (Eliminar -> Confirmar) que ya existian se
// quedaban ARMADOS para siempre: tocar "Eliminar todo" en Ajustes solo para
// LEER la advertencia dejaba la app a un toque accidental de borrar todo, sin
// ningun boton de salida. Este hook desarma solo a los ~5s, igual que el
// desarme automatico de ConfirmTap.
//
// `disarm` va por ref a proposito: casi siempre es una arrow inline cuya
// identidad cambia en cada render, y tenerla en las deps reiniciaria el timer
// con cada re-render del padre (el tablero re-renderiza con cada tick de
// precios), o sea el desarme no llegaria nunca.
export function useAutoDisarm(armed, disarm, ms = 5000) {
  const fn = useRef(disarm)
  fn.current = disarm
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => fn.current(), ms)
    return () => clearTimeout(t)
  }, [armed, ms])
}
