'use client'

import { useEffect, useState } from 'react'
import { buildErrorReport, clientErrorContext } from '@/lib/errorReport'

// El error CRÍTICO: reemplaza el layout raíz entero, así que no puede contar
// con los tokens de tema ni con nada que el layout monte (incluido
// `window.__CHISPU_BUILD`). Por eso es una superficie oscura fija y consistente
// consigo misma, y por eso el build lo resuelve `runningBuild()` desde
// `NEXT_BUILD_ID`, que se inlinea al compilar.
//
// Traía solo `error.message` y nada más. Ahora arma el mismo detalle que las
// otras dos pantallas de error, desde `lib/errorReport.js`.
export default function GlobalError({ error, reset }) {
  const [report, setReport] = useState(null)
  const [copied, setCopied] = useState(false)

  // En un efecto y no en el render: ruta, hora y navegador solo existen en el
  // cliente, y una pantalla de error que provoca un desajuste de hidratación
  // es lo último que queremos.
  useEffect(() => {
    console.error('[GlobalError]', error)
    setReport(buildErrorReport(error, { context: clientErrorContext(), title: 'Chispudo · error crítico' }))
  }, [error])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* la captura de pantalla sigue sirviendo */ }
  }

  return (
    <html>
      <body style={{ backgroundColor: '#000000', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1.5rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '28rem', width: '100%' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Error crítico</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Tus datos están a salvo. Vuelve a intentar, y si sigue pasando mándanos el detalle de abajo.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '0.625rem 1.5rem', backgroundColor: '#059669', color: 'white',
                borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
              }}
            >
              Reintentar
            </button>

            {report && (
              <div style={{
                marginTop: '1.5rem', textAlign: 'left',
                border: '1px solid #1e293b', borderRadius: '0.75rem',
                padding: '0.75rem', backgroundColor: '#0b1220',
              }}>
                <pre style={{
                  margin: 0, fontSize: '11px', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: '#94a3b8', fontFamily: 'ui-monospace, monospace',
                }}>{report}</pre>
                <button onClick={copy} style={{
                  marginTop: '0.5rem', background: 'none', border: 'none', padding: 0,
                  fontSize: '12px', color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer',
                }}>
                  {copied ? 'Copiado' : 'Copiar para reportar'}
                </button>
              </div>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
