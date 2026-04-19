'use client'

export default function DashboardError({ error, reset }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b1120]">
      <div className="text-center max-w-md px-6">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-white mb-2">Algo salio mal</h2>
        <p className="text-slate-400 text-sm mb-6">{error?.message || 'Error inesperado en el dashboard.'}</p>
        <button
          onClick={() => reset()}
          className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium"
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
