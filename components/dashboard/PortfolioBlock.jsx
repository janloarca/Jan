'use client'

import { useState } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'

// Un solo bloque con una sola sección visible a la vez. Solo diseño: cada
// sección es el componente de siempre en modo `embedded`; aquí únicamente se
// decide cuál se dibuja.
export default function PortfolioBlock({ lang, sections }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const visible = sections.filter((s) => s.node)
  const [active, setActive] = useState(visible[0]?.key)
  const current = visible.find((s) => s.key === active) || visible[0]
  if (!current) return null
  return (
    <div className="card p-4 sm:p-6">
      <SegmentedTabs
        tabs={visible.map((s) => ({ key: s.key, label: s.label }))}
        value={current.key}
        onChange={setActive}
        deps={[lang, visible.length]}
        ariaLabel={t('Secciones del portafolio', 'Portfolio sections')}
        className="mb-5"
      />
      {current.node}
    </div>
  )
}
