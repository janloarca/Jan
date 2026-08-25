'use client'

import { useEffect, useRef, useState } from 'react'

// Mantener montado un modal mientras corre su animación de SALIDA.
//
// El problema que resuelve: los modales se renderizan con `{modal === 'x' &&
// <Modal/>}`, así que en el instante en que el estado cambia a null el nodo
// desaparece del DOM. Una animación de salida no puede correr sobre algo que ya
// no existe, y por eso los modales ENTRABAN con animación (FASE JE2) y SALÍAN
// de golpe: la asimetría se nota cada vez que cerrás uno.
//
// El hook devuelve dos cosas: `shown`, que es lo que hay que renderizar (el
// valor viejo sobrevive los milisegundos de la salida), y `closing`, que marca
// que ese render es el de despedida.
//
// ⛔ ABRIR SIEMPRE ES INMEDIATO, y no es un detalle:
// - Abrir un modal es la respuesta a un toque, así que retrasarlo sería
//   exactamente el "le falta tacto" que este trabajo vino a arreglar.
// - Cambiar de un modal a OTRO (el picker de venta hace `setModal(null)` y
//   `setSellItem(it)` en la misma vuelta) tiene que dejar entrar al nuevo sin
//   esperar a que termine de irse el viejo.
// - Reabrir el MISMO modal a mitad de su salida cancela la salida y lo deja
//   entero, que es lo que significa "me arrepentí".
//
// Con `prefers-reduced-motion` no hay retraso en absoluto: dejar el modal
// montado 200ms invisibles solo bloquearía la pantalla sin mostrar nada.

export const MODAL_EXIT_MS = 200

const isOpen = (v) => v != null && v !== false

function reducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function useModalExit(value, ms = MODAL_EXIT_MS) {
  const [shown, setShown] = useState(value)
  const [closing, setClosing] = useState(false)
  // El valor que de verdad se está renderizando. Va en un ref y no se lee del
  // estado porque el efecto tiene que decidir con lo último que se pintó, no
  // con lo que el render en curso tenga capturado en su closure.
  const shownRef = useRef(value)
  const timer = useRef(0)

  useEffect(() => {
    if (isOpen(value)) {
      clearTimeout(timer.current)
      shownRef.current = value
      setShown(value)
      setClosing(false)
      return undefined
    }
    // Ya estaba cerrado: no hay nada que despedir.
    if (!isOpen(shownRef.current)) return undefined

    if (reducedMotion()) {
      shownRef.current = null
      setShown(null)
      setClosing(false)
      return undefined
    }

    setClosing(true)
    timer.current = setTimeout(() => {
      shownRef.current = null
      setShown(null)
      setClosing(false)
    }, ms)
    return () => clearTimeout(timer.current)
  }, [value, ms])

  return [shown, closing]
}
