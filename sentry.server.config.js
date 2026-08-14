// Sentry del lado del SERVIDOR (rutas de API y crones). Mismo apagado por
// ausencia de DSN que el cliente. Acá se usa SENTRY_DSN (sin NEXT_PUBLIC): no
// hay razón para exponerlo al navegador desde el servidor.
import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentryScrub'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_BUILD_ID,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  })
}
