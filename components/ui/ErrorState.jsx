'use client'

import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'

const ICONS = {
  default: AlertTriangle,
  network: WifiOff,
}

export default function ErrorState({ title, message, onRetry, icon = 'default', lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const IconComp = ICONS[icon] || ICONS.default

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-2xl p-4 mb-4" style={{
        backgroundColor: 'rgba(248,113,113,0.08)',
        border: '1px solid rgba(248,113,113,0.15)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
      }}>
        <IconComp size={28} style={{ color: 'var(--accent-red)' }} />
      </div>
      <h3 className="text-sm font-semibold text-white mb-1">
        {title || t('Algo salió mal', 'Something went wrong')}
      </h3>
      <p className="text-xs text-slate-400 max-w-xs mb-4">
        {message || t('No se pudieron cargar los datos.', 'Could not load data.')}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs gap-1.5">
          <RefreshCw size={14} />
          {t('Reintentar', 'Retry')}
        </button>
      )}
    </div>
  )
}
