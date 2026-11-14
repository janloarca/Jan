'use client'

import usePersistedState from '@/hooks/usePersistedState'

export default function SectionCollapse({ title, id, children, defaultOpen = false }) {
  // La llave vieja (`section-<id>`, '1'/'0') se lee como punto de partida, así
  // quien ya plegó una sección no pierde su elección al pasar al gancho
  // compartido (que guarda JSON bajo `section-<id>:v2`).
  const key = id ? `section-${id}` : null
  const [open, setOpen] = usePersistedState(key ? `${key}:v2` : null, readLegacy(key, defaultOpen))
  const toggle = () => setOpen((o) => !o)

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

function readLegacy(key, fallback) {
  try {
    if (typeof window === 'undefined' || !key) return fallback
    const v = window.localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
  } catch {}
  return fallback
}
