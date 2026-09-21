'use client'

import { useEffect, useState } from 'react'
import { buildErrorReport, clientErrorContext } from '@/lib/errorReport'

// Flujo no tenía pantalla de error de RUTA. Sin ella, un throw fuera de las
// cards (en un memo de la página, en el motor de meses) se lo llevaba todo
// hasta `RootErrorBoundary`, que es la superficie de último recurso: el usuario
// perdía la navegación entera por un fallo de una sola pantalla.
//
// Lo que esta pantalla tiene que lograr es lo mismo que la del tablero: que una
// CAPTURA baste para diagnosticar. En producción el mensaje viene minificado,
// así que sin el build id "lo rompió el deploy de hoy" y "el teléfono sigue
// pegado al bundle anterior" se ven idénticos, y esa ambigüedad ya costó un día
// entero y cuatro deploys (FASES HK/HM).
export default function FinancesError({ error, reset }) {
  const [copied, setCopied] = useState(false)
  // Ruta, hora y navegador solo existen en el cliente. Calcularlos durante el
  // render haría que el HTML del servidor y el del navegador no coincidan, y
  // una pantalla de ERROR que a su vez provoca un error de hidratación es lo
  // último que queremos: se llenan después de montar, con el resto ya visible.
  const [client, setClient] = useState(null)

  useEffect(() => {
    console.error('[FinancesError]', error)
    setClient(clientErrorContext())
  }, [error])

  const report = buildErrorReport(error, { context: client, title: 'Chispudo · error en Flujo' })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sin permiso de portapapeles el bloque de abajo igual se puede capturar
      // en pantalla, que es como llegan la mayoría de estos reportes.
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-theme-base px-6">
      <div className="text-center max-w-lg w-full">
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Algo salió mal en Flujo</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Tus datos están a salvo. Vuelve a intentar, y si sigue pasando mándanos el detalle de abajo.
        </p>

        <div className="flex gap-3 justify-center mb-5">
          <button
            onClick={() => reset()}
            className="px-6 py-2.5 rounded-lg transition-opacity hover:opacity-90 text-sm font-medium"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => { window.location.href = '/dashboard' }}
            className="px-6 py-2.5 rounded-lg transition-opacity hover:opacity-90 text-sm font-medium border"
            style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
          >
            Ir al tablero
          </button>
        </div>

        <div className="rounded-lg border p-3 text-left"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words m-0"
            style={{ color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace' }}>{report}</pre>
          <button onClick={copy} className="mt-2 text-xs underline" style={{ color: 'var(--accent-blue)' }}>
            {copied ? 'Copiado' : 'Copiar para reportar'}
          </button>
        </div>
      </div>
    </div>
  )
}
