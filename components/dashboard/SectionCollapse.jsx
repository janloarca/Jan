'use client'

import { useState } from 'react'

export default function SectionCollapse({ title, id, children, defaultOpen = false }) {
  const [open, setOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && id) {
        const saved = localStorage.getItem(`section-${id}`)
        if (saved !== null) return saved === '1'
      }
    } catch {}
    return defaultOpen
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      if (typeof window !== 'undefined' && id) {
        localStorage.setItem(`section-${id}`, next ? '1' : '0')
      }
    } catch {}
  }

  return (
    <>
      {/* El título de SECCIÓN tiene que verse distinto del de una card, y no lo
          era: los dos iban en `text-sm text-slate-400`, así que un <h2> y un
          <h3> pesaban exactamente lo mismo y la página no tenía jerarquía que
          escanear. Ahora la sección usa `text-h2` (17px/600) en tinta primaria y
          la card `text-caption` (13px) en tinta apagada: dos niveles que se
          distinguen de un vistazo. */}
      <button onClick={toggle} aria-expanded={open} aria-controls={id ? `section-${id}` : undefined} className="flex items-center gap-3 pt-8 pb-3 w-full group">
        <h2 className="text-h2" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-primary)' }} />
        <span aria-hidden="true" className={`text-caption transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          style={{ color: 'var(--text-muted)' }}>
          ▾
        </span>
      </button>
      {open && <div id={id ? `section-${id}` : undefined} className="space-y-4 sm:space-y-6">{children}</div>}
    </>
  )
}
