'use client'

import { useState, useEffect } from 'react'

export default function SectionCollapse({ title, id, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (typeof window !== 'undefined' && id) {
      const saved = localStorage.getItem(`section-${id}`)
      if (saved !== null) setOpen(saved === '1')
    }
  }, [id])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined' && id) {
      localStorage.setItem(`section-${id}`, next ? '1' : '0')
    }
  }

  return (
    <>
      <button onClick={toggle} className="flex items-center gap-3 pt-8 pb-3 w-full group">
        <h2 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">{title}</h2>
        <div className="flex-1 h-px bg-[#334155]/50" />
        <span className={`text-slate-500 text-xs transition-transform duration-200 group-hover:text-slate-300 ${open ? 'rotate-0' : '-rotate-90'}`}>
          ▾
        </span>
      </button>
      {open && <div className="space-y-4 sm:space-y-6">{children}</div>}
    </>
  )
}
