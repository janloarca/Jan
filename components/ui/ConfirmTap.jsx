'use client'

import { useEffect, useRef, useState } from 'react'

// FASE NC (Ronda 4 de la auditoría de UX). Dos toques para una acción
// destructiva, como primitivo compartido.
//
// El primer toque ARMA (el botón cambia a su forma de confirmación) y el
// segundo ejecuta; sin segundo toque, se desarma solo a los ~3.5s. El
// desarme por tiempo es lo que permite usarlo en contextos apretados (una ×
// en una fila de dropdown) donde no cabe un botón "No" al lado: esperar o
// tocar en otra parte cancela.
//
// Nace para los CUATRO sitios que borraban/revocaban con UN toque
// (PortfolioSelector, OptimizeModal, el revocar de ShareTab y el ocultar de
// Rebalanceo). Los dos-toques ad-hoc que ya existían (RecentTransactions,
// EditAccountModal, FinanceWipePanel, IncomePlanCalendar...) se quedan como
// están A PROPÓSITO: migrarlos es churn sin cambio de comportamiento, y este
// primitivo existe para que los sitios NUEVOS no escriban otra copia.
//
// stopPropagation SIEMPRE: estos botones viven dentro de filas y telones
// clickeables, y un toque que arma no puede además seleccionar la fila o
// cerrar el modal que lo contiene.
export default function ConfirmTap({
  onConfirm,
  children,
  confirmContent,
  className = '',
  confirmClassName,
  style,
  confirmStyle,
  ariaLabel,
  confirmAriaLabel,
  timeoutMs = 3500,
  disabled = false,
  title,
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const click = (e) => {
    e.stopPropagation()
    if (disabled) return
    if (!armed) {
      setArmed(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setArmed(false), timeoutMs)
      return
    }
    clearTimeout(timer.current)
    setArmed(false)
    onConfirm()
  }

  return (
    <button type="button" onClick={click} disabled={disabled} title={title}
      aria-label={armed ? (confirmAriaLabel || ariaLabel) : ariaLabel}
      className={armed ? (confirmClassName ?? className) : className}
      style={armed ? (confirmStyle ?? style) : style}>
      {armed ? (confirmContent ?? children) : children}
    </button>
  )
}
