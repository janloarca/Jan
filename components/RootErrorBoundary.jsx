'use client'

import { Component } from 'react'
import { buildErrorReport, clientErrorContext } from '@/lib/errorReport'

// El boundary de ÚLTIMO recurso: atrapa todo lo que los boundaries de segmento
// no atrapan (el layout, la landing, cualquier pantalla sin su propio error.jsx).
//
// ⛔ Y ERA EL QUE MENOS DECÍA. FASE IB le dio a `app/dashboard/error.jsx` un
// bloque copiable con mensaje, digest, build, ruta, hora y navegador, con la
// regla escrita de que "una CAPTURA tiene que bastar para diagnosticar". Esta
// pantalla se quedó con "Something went wrong" y un botón de recargar, así que
// cuando de verdad falló, la captura del usuario no traía NI el mensaje NI el
// build: "lo rompió el deploy de hoy" y "el teléfono sigue pegado al bundle
// anterior" se veían idénticos. Esa ambigüedad ya costó un día entero y cuatro
// deploys (FASES HK/HM).
//
// El detalle se arma con `lib/errorReport.js`, compartido con las otras dos
// superficies de error: tres copias de esta decisión es exactamente cómo una se
// queda atrás, que es el motivo por el que esta pantalla estaba así.
export default class RootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, report: null, copied: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[RootErrorBoundary]', error, info?.componentStack)
    // Se arma acá y no en el render: `componentDidCatch` corre en el cliente y
    // después de montar, así que leer `window` es seguro. Hacerlo durante el
    // render arriesga un desajuste de hidratación, y una pantalla de error que
    // provoca otro error es lo último que queremos.
    this.setState({
      report: buildErrorReport(error, {
        context: clientErrorContext(),
        componentStack: info?.componentStack,
        title: 'Chispudo · error',
      }),
    })
  }

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.state.report || '')
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      // Sin permiso de portapapeles el bloque igual se puede capturar en
      // pantalla, que es como llega la mayoría de estos reportes.
    }
  }

  render() {
    if (this.state.hasError) {
      const { report, copied } = this.state
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-primary, #0A0A12)',
          color: 'var(--text-primary, #fff)',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem',
        }}>
          <div style={{
            textAlign: 'center',
            maxWidth: '440px',
            width: '100%',
            background: 'var(--bg-card, rgba(25,25,40,0.6))',
            border: 'var(--glass-border, 1px solid rgba(255,255,255,0.08))',
            borderRadius: '20px',
            padding: '2.5rem 1.75rem',
            boxShadow: 'var(--shadow-elevated, 0 8px 32px rgba(0,0,0,0.35))',
          }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: '16px',
              backgroundColor: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 15%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
              fontSize: '1.5rem',
            }}>!</div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Algo salió mal
            </h1>
            {/* Lo primero, y no es cortesía: en una app de dinero una pantalla
                de error sin esta frase asusta más de lo que informa. */}
            <p style={{ color: 'var(--text-secondary, rgba(235,235,245,0.6))', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Tus datos están a salvo. Vuelve a intentar, y si sigue pasando mándanos el detalle de abajo.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.625rem 1.5rem',
                backgroundColor: 'var(--accent-blue, #2563EB)',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
              }}
            >
              Recargar
            </button>

            {report && (
              <div style={{
                marginTop: '1.5rem',
                textAlign: 'left',
                border: 'var(--glass-border, 1px solid rgba(255,255,255,0.08))',
                borderRadius: '12px',
                padding: '0.75rem',
                backgroundColor: 'var(--bg-tertiary, rgba(255,255,255,0.03))',
              }}>
                <pre style={{
                  margin: 0,
                  fontSize: '11px',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-secondary, rgba(235,235,245,0.6))',
                  fontFamily: 'ui-monospace, monospace',
                }}>{report}</pre>
                <button onClick={this.copy} style={{
                  marginTop: '0.5rem',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: '12px',
                  color: 'var(--accent-blue, #2563EB)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}>
                  {copied ? 'Copiado' : 'Copiar para reportar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
