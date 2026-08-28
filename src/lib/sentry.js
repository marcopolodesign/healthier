import * as Sentry from '@sentry/react'
import { BUILD_COMMIT } from './buildInfo'

/**
 * Se inicializa sólo si hay DSN — en dev local normalmente no se setea, así
 * que la app funciona igual sin Sentry configurado. `VITE_SENTRY_ENVIRONMENT`
 * distingue staging de producción contra el mismo proyecto de Sentry (no hay
 * un proyecto por entorno); default 'development' cuando no está seteada.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: BUILD_COMMIT,
    tracesSampleRate: 0.1,
  })
}

export { Sentry }
