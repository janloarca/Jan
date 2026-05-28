'use client'

export default function DashboardError({ error, reset }) {
  const msg = typeof error?.message === 'string' ? error.message : 'Error inesperado en el dashboard.'
  const digest = error?.digest || ''
  const stack = typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 8).join('\n') : ''

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f172a]">
      <div className="text-center max-w-lg px-6">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-white mb-2">Algo salio mal</h2>
        <p className="text-slate-400 text-sm mb-4">{msg}</p>
        {stack && (
          <pre className="text-left text-xs text-slate-500 bg-[#0f172a] border border-[#334155] rounded-lg p-3 mb-4 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
            {stack}
          </pre>
        )}
        {digest && <p className="text-xs text-slate-600 mb-4">Digest: {digest}</p>}
        <button
          onClick={() => reset()}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium"
        >
          Intentar de nuevo
        </button>
        <p className="text-slate-600 text-xs mt-4">
          Si el problema persiste, recarga la pagina.
        </p>
      </div>
    </div>
  )
}
