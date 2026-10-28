import * as Sentry from '@sentry/react'
import { BUILD_COMMIT } from './buildInfo'
import { OPCIONES_PRIVADAS } from './sentryFilter'

/**
 * Se inicializa sólo si hay DSN — en dev local normalmente no se setea, así
 * que la app funciona igual sin Sentry configurado. `VITE_SENTRY_ENVIRONMENT`
 * distingue staging de producción contra el mismo proyecto de Sentry (no hay
 * un proyecto por entorno); default 'development' cuando no está seteada.
 *
 * **Sin datos personales — LISTA BLANCA** (Manual de Seguridad del convenio RENAPER):
 * Sentry es un tercero. No se tapa PII en texto libre: `OPCIONES_PRIVADAS`
 * (`sentryFilter.js`) reconstruye cada evento con lo único que sale —user.id (UUID),
 * type + código + frames de la excepción, breadcrumbs sin texto, request sin query,
 * contexts técnicos y tags nuestros— y `sendDefaultPii: false`. La identificación de la
 * persona la hacemos nosotros con el id. Control: `npm run test:sentry`.
 *
 * Replay y feedback NO están habilitados. Si algún día se suman, tienen que
 * llevar `maskAllText: true`, `maskAllInputs: true` y `blockAllMedia: true`; el
 * test falla si aparecen sin eso.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: BUILD_COMMIT,
    tracesSampleRate: 0.1,
    ...OPCIONES_PRIVADAS,
  })
}

export { Sentry }
