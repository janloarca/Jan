'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// FASE NC (Ronda 4 de la auditoría de UX). Un click en el telón cerraba los
// formularios largos AL INSTANTE: diez campos tecleados de un activo nuevo se
// perdían por un dedo que cayó fuera del panel, que en un teléfono es el
// accidente más fácil de todos.
//
// La regla: con el formulario LIMPIO el telón cierra igual que siempre; con
// cambios encima, el primer click no cierra (muestra el aviso vía
// `backdropArmed`, ver DiscardHint) y el segundo dentro de la ventana sí
// descarta. La × y Esc NO se guardan a propósito: son gestos explícitos de
// cerrar, no un accidente, y guardar Esc exigiría tocar useEscClose para
// todos sus consumidores.
//
// `markDirty` va en el helper `set()` del formulario (una línea cubre todos
// los campos); un caller sin helper único puede pasar el booleano calculado
// directo a `onBackdropClick(dirty)`.
export function useDirtyClose(onClose) {
  const dirtyRef = useRef(false)
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const markDirty = useCallback(() => { dirtyRef.current = true }, [])

  const onBackdropClick = useCallback((isDirtyNow) => {
    // Un onClick pasa el EVENTO como primer argumento: solo un booleano
    // explícito reemplaza al ref.
    const dirty = typeof isDirtyNow === 'boolean' ? isDirtyNow : dirtyRef.current
    if (!dirty || armed) {
      clearTimeout(timer.current)
      onClose()
      return
    }
    setArmed(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(false), 3500)
  }, [armed, onClose])

  return { markDirty, onBackdropClick, backdropArmed: armed }
}
