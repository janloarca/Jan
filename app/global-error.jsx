'use client'

export default function GlobalError({ error, reset }) {
  return (
    <html>
      <body style={{ backgroundColor: '#0b1120', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1.5rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Error critico</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {error?.message || 'Ocurrio un error inesperado.'}
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
          </div>
        </div>
      </body>
    </html>
  )
}
