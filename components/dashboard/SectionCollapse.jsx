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
      <button onClick={toggle} aria-expanded={open} aria-controls={id ? `section-${id}` : undefined} className="flex items-center gap-3 pt-8 pb-3 w-full group">
        <h2 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">{title}</h2>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-primary)' }} />
        <span className={`text-slate-500 text-xs transition-transform duration-200 group-hover:text-slate-300 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>
      {open && <div id={id ? `section-${id}` : undefined} className="space-y-4 sm:space-y-6">{children}</div>}
    </>
  )
}
