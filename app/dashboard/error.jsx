'use client'

import { useEffect } from 'react'

export default function DashboardError({ error, reset }) {
  const msg = typeof error?.message === 'string' ? error.message : 'Error inesperado en el dashboard.'

  useEffect(() => {
    console.error('[DashboardError]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-theme-base">
      <div className="text-center max-w-lg px-6">
        <h2 className="text-xl font-bold text-white mb-2">Algo salio mal</h2>
        <p className="text-slate-400 text-sm mb-4">{msg}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium"
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="px-6 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors text-sm font-medium"
          >
            Recargar
          </button>
        </div>
      </div>
    </div>
  )
}
