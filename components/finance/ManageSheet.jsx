'use client'

import { Tags, Zap, ChevronRight, X } from 'lucide-react'
import { useEscClose } from '@/hooks/useEscClose'

// Una sola puerta para "administrar" Flujo: las categorías y la captura
// automática ya tenían cada una su modal, pero sus botones del encabezado
// estaban ocultos en teléfono (`hidden sm:inline-flex`) y Categorías no estaba
// en ningún otro lado. Esta hoja solo ELIGE a cuál ir; no duplica ninguno.
export default function ManageSheet({ onClose, onCategories, onAuto, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  useEscClose(onClose)

  const options = [
    {
      key: 'categories',
      icon: Tags,
      title: t('Categorías', 'Categories'),
      desc: t(
        'Cambia cómo se llaman (Alimentación, Transporte...), agrega nuevas, muévelas de grupo o escóndelas.',
        'Rename them, add new ones, move them between groups or hide them.'
      ),
      action: onCategories,
    },
    {
      key: 'auto',
      icon: Zap,
      title: t('Gastos automáticos', 'Automatic expenses'),
      desc: t(
        'Atajo del iPhone, correo reenviado y Android; tu token y lo que Chispu ya aprendió de tus comercios.',
        'iPhone shortcut, forwarded email and Android; your token and what Chispu has learned about your merchants.'
      ),
      action: onAuto,
    },
  ]

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}
      role="dialog" aria-modal="true" aria-labelledby="manage-sheet-title">
      <div className="modal-glass max-w-md w-full overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="manage-sheet-title" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('Administrar Flujo', 'Manage Flow')}
          </h2>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="p-2 -mr-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>
        <div className="p-3 space-y-1">
          {options.map(({ key, icon: Icon, title, desc, action }) => (
            <button key={key} onClick={action}
              className="w-full flex items-start gap-3 px-3 py-3 text-left rounded-xl hover:bg-theme-elevated transition-colors">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-blue)' }}>
                <Icon size={16} aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
                <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</span>
              </span>
              <ChevronRight size={16} className="mt-2 shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
