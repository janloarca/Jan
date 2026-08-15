'use client'

import { useState } from 'react'

// Collapsible "advanced" block for long forms: only the essentials stay
// permanently on screen, everything else lives behind one of these with a
// one-line summary of its current state so closing it never hides whether
// it's configured. Reused across EditAccountModal's secondary sections
// (Rendimiento, Costos & Comisiones, Vencimiento & Liquidez, Detalles).
export default function FormSection({ icon, title, summary, defaultOpen = false, badge, children, open: openProp, onToggle }) {
  const [openState, setOpenState] = useState(defaultOpen)
  // Controlled mode (open + onToggle passed): the parent owns whether the
  // section counts as "active" for save purposes, e.g. Rendimiento's toggle
  // also gates whether income fields get written on submit.
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : openState
  const toggle = () => isControlled ? onToggle?.(!open) : setOpenState(o => !o)
  return (
    <div className="border border-[var(--card-border,#38383A)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--input-bg,#000000)]/40"
      >
        {icon && <span className="text-sm shrink-0">{icon}</span>}
        <span className="text-sm font-medium text-[var(--text-primary,white)] shrink-0">{title}</span>
        {badge}
        {!open && summary && (
          <span className="text-xs truncate ml-auto pl-2" style={{ color: 'var(--text-muted,#475569)' }}>{summary}</span>
        )}
        <span className="text-sm shrink-0 leading-none" style={{ color: 'var(--text-muted,#475569)', marginLeft: !open && summary ? undefined : 'auto' }}>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-3 border-t border-[var(--card-border,#38383A)]">
          {children}
        </div>
      )}
    </div>
  )
}
