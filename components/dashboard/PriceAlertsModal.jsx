'use client'

import { useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import PriceAlerts from './PriceAlerts'

// Las alertas de precio dejaron de ser una card fija del overview (casi
// siempre vacía, ocupando media columna) y pasaron a ser una acción más de
// QuickActionsCard. Este wrapper aporta lo que un modal necesita (fondo, Esc,
// foco atrapado) y deja el contenido intacto: PriceAlerts sigue siendo el
// mismo componente, con su propio marco como panel.
export default function PriceAlertsModal({ onClose, ...props }) {
  const trapRef = useFocusTrap()

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-anim max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <PriceAlerts {...props} onClose={onClose} />
      </div>
    </div>
  )
}
