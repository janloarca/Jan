'use client'

import { useEffect, useState } from 'react'

// Lo que esta pantalla tiene que lograr: que una CAPTURA baste para diagnosticar.
//
// Antes imprimía `error.message` a secas, y en producción ese mensaje viene
// minificado: "Cannot access 'nL' before initialization" no dice qué variable
// era, ni en qué build, ni en qué pantalla. Un usuario que no es programador no
// puede darnos nada más que la captura, así que la captura tiene que traerlo
// todo. Es la misma lección del panel de diagnóstico de Google: lo que resolvió
// aquel caso no fue una hipótesis mejor, fue conseguir un dato que desambiguara.
export default function DashboardError({ error, reset }) {
  const [copied, setCopied] = useState(false)
  // Ruta, hora y navegador solo existen en el cliente. Calcularlos durante el
  // render haría que el HTML del servidor y el del navegador no coincidan, y
  // una pantalla de ERROR que a su vez provoca un error de hidratación es lo
  // último que queremos: se llenan después de montar, con el resto ya visible.
  const [client, setClient] = useState(null)

  const msg = typeof error?.message === 'string' && error.message ? error.message : 'Error inesperado en el dashboard.'
  // El build que está CORRIENDO. Sin esto no se puede distinguir "el arreglo no
  // sirvió" de "todavía corre el bundle viejo", que ya costó un día entero.
  const build = process.env.NEXT_BUILD_ID || 'desconocido'
  // Next le pone un digest a los errores de servidor: es la llave para buscarlo
  // en los logs de la plataforma.
  const digest = error?.digest || null

  useEffect(() => {
    console.error('[DashboardError]', error)
    try {
      setClient({
        where: window.location.pathname + window.location.search,
        when: new Date().toISOString(),
        ua: navigator.userAgent,
      })
    } catch {}
  }, [error])

  const report = [
    `Chispudo · error en el dashboard`,
    `mensaje: ${msg}`,
    digest ? `digest: ${digest}` : null,
    `build: ${build}`,
    client?.where ? `pantalla: ${client.where}` : null,
    client?.when ? `cuando: ${client.when}` : null,
    client?.ua ? `navegador: ${client.ua}` : null,
  ].filter(Boolean).join('\n')

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
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Algo salió mal</h2>
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
            Recargar
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
