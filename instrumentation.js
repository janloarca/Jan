// Gancho de instrumentación de Next: carga la config de Sentry que corresponda
// al runtime en el que arrancó el proceso.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  // El SDK termina dentro del bundle del middleware de todos modos (lo inyecta
  // withSentryConfig), así que NO cargarlo acá solo perdería cobertura sin
  // ahorrar un solo kilobyte. Medido: quitarlo dejó el middleware igual.
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export async function onRequestError(...args) {
  const Sentry = await import('@sentry/nextjs')
  if (typeof Sentry.captureRequestError === 'function') {
    return Sentry.captureRequestError(...args)
  }
}
