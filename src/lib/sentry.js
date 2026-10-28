import * as Sentry from '@sentry/react'
import { BUILD_COMMIT } from './buildInfo'
import { OPCIONES_PRIVADAS } from './sentryFilter'

/**
 * Se inicializa sólo si hay DSN — en dev local normalmente no se setea, así
 * que la app funciona igual sin Sentry configurado. `VITE_SENTRY_ENVIRONMENT`
 * distingue staging de producción contra el mismo proyecto de Sentry (no hay
 * un proyecto por entorno); default 'development' cuando no está seteada.
 *
 * **Sin datos personales** (Manual de Seguridad del convenio RENAPER): Sentry es
 * un tercero y a él no viajan mails, DNI, CUIT, teléfonos, tokens, query strings,
 * cuerpos de request ni datos del usuario más allá de su id. Todo eso lo hace
 * `OPCIONES_PRIVADAS` (sendDefaultPii: false + beforeSend / beforeSendTransaction /
 * beforeBreadcrumb de `sentryFilter.js`). Control: `npm run test:sentry`.
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
