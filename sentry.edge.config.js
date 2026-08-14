// Sentry en el runtime EDGE (el middleware corre acá).
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
