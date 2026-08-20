'use client'

import { useState, useEffect } from 'react'

export default function ErrorBanner({ pricesError, ratesError, lang }) {
  const [dismissed, setDismissed] = useState(false)
  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    if (pricesError || ratesError) setDismissed(false)
  }, [pricesError, ratesError])

  if (dismissed || (!pricesError && !ratesError)) return null

  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border"
      style={{ backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.2)', color: 'var(--alert-warn-icon)' }}>
      <div className="flex items-center gap-2 text-sm">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span>
          {pricesError && ratesError
            ? t('Precios y tasas desactualizados: Error de conexión', 'Prices and rates outdated: Connection error')
            : pricesError
              ? t('Precios desactualizados: No se pudo conectar', 'Prices outdated: Could not connect')
              : t('Tasas de cambio desactualizadas', 'Exchange rates outdated')}
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="ml-2 p-1 transition-colors" style={{ color: 'rgba(245,158,11,0.6)' }}
        onMouseOver={e => e.currentTarget.style.color = 'var(--alert-warn-icon)'}
        onMouseOut={e => e.currentTarget.style.color = 'rgba(245,158,11,0.6)'}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
