// Sentry en el NAVEGADOR. Ver lib/sentryScrub.js para qué se limpia y por qué.
//
// Apagado por completo mientras no exista NEXT_PUBLIC_SENTRY_DSN: mismo patrón
// que el correo (SMTP_*) y el respaldo de precios (Upstash). Sin la variable
// esto no inicializa nada, no manda nada y no pesa en tiempo de ejecución.
import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentryScrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    // El build que corre. Es EL dato que faltó todo un día: sin él no se puede
    // distinguir "el arreglo no sirvió" de "todavía corre el bundle viejo".
    release: process.env.NEXT_BUILD_ID,
    environment: process.env.NODE_ENV,

    // Configuración deliberadamente FLACA. Lo que se quiere es saber qué se
    // rompió, no medir rendimiento ni grabar sesiones: trazas y replay pesan en
    // el bundle (esto se abre en teléfonos) y replay además grabaría la pantalla
    // de alguien mirando su patrimonio, que es exactamente lo que no queremos
    // mandarle a un tercero.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Sin esto Sentry adjunta ip y datos del usuario por su cuenta.
    sendDefaultPii: false,

    beforeSend: scrubEvent,
    beforeBreadcrumb(crumb) {
      // Los console.log de la app son ruido y pueden llevar datos del
      // portafolio; el error en sí ya viaja completo.
      if (crumb.category === 'console' && crumb.level !== 'error') return null
      return crumb
    },

    ignoreErrors: [
      // Extensiones del navegador y ruido conocido que no es nuestro.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      /^Network request failed$/,
      /Load failed/,
    ],
  })

  // Puente para etiquetar al usuario SIN que nadie más tenga que importar el
  // SDK. Medido, no supuesto: un `import('@sentry/nextjs')` dentro de AuthGate
  // (que envuelve TODAS las pantallas) arrastraba el SDK entero al bundle
  // compartido y le sumaba 36 kB al arranque de la app completa. Acá el SDK ya
  // está cargado, así que exponer una función cuesta cero.
  //
  // Solo el id, nunca el correo: ver lib/sentryScrub.js.
  window.__chispuSentryUser = (uid) => {
    try { Sentry.setUser(uid ? { id: uid } : null) } catch {}
  }
}
