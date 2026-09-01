'use client'

import { useEffect } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import PriceAlerts from './PriceAlerts'

// Las alertas de precio dejaron de ser una card fija del overview (casi
// siempre vacía, ocupando media columna) y pasaron a ser una acción más de
// QuickActionsCard. Este wrapper aporta lo que un modal necesita (fondo, Esc,
// foco atrapado) y deja el contenido intacto: PriceAlerts sigue siendo el
// mismo componente, con su propio marco como panel.
export default function PriceAlertsModal({ onClose, ...props }) {
  const trapRef = useFocusTrap()

  useEscClose(onClose)

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={trapRef} className="modal-anim max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <PriceAlerts {...props} onClose={onClose} />
      </div>
    </div>
  )
}
