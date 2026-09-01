'use client'

import { useEffect } from 'react'

// Esc cierra el modal — UNA definición para toda la app (FASE ME6).
//
// Antes esto vivía copiado verbatim en 18 archivos (el mismo useEffect con
// window.addEventListener('keydown', handleEsc)), y once modales reales no lo
// tenían en absoluto. Dos copias de la misma regla es cómo una se queda atrás:
// acá además el defecto era estructural, no solo de duplicación.
//
// LA RAZÓN DE LA PILA: con listeners de window independientes, un Esc con un
// modal ANIDADO abierto los cerraba TODOS a la vez. Casos reales de hoy:
// BrokerConnectModal (z-[60]) dentro de ConnectionsModal, e
// InstrumentSheetsManager dentro de SettingsModal. El usuario aprieta Esc para
// salir del hijo y pierde también al padre. Con la pila, solo responde la
// entrada MÁS RECIENTE (el modal de más arriba): el hijo se monta después del
// padre por construcción (el padre lo renderiza), así que el orden de la pila
// ES el orden visual de apilamiento.
//
// `active` existe para modales que se montan siempre y se muestran por prop
// (o que quieren suspender el Esc durante una operación): con false, la
// entrada no está en la pila y el Esc le toca al de abajo.
const stack = []

export function useEscClose(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== 'function') return
    const entry = { onClose }
    stack.push(entry)
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== entry) return
      entry.onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      window.removeEventListener('keydown', handler)
    }
  }, [onClose, active])
}

export default useEscClose
