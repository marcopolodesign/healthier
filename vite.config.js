import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { execSync } from 'node:child_process'

/**
 * Versión del build, embebida en el bundle.
 *
 * Existe para una pregunta concreta y repetida: "¿estoy viendo el fix o el
 * build viejo que me quedó cacheado?". Sin esto se contesta comparando a mano el
 * hash del `index-*.js` contra lo que sirve producción, que no es algo que se le
 * pueda pedir a nadie desde el teléfono.
 *
 * En Vercel el commit sale de `VERCEL_GIT_COMMIT_SHA`; en local, de git. Si las
 * dos fallan (un tarball sin `.git`), queda "dev" y el build NO se rompe: es un
 * cartelito informativo, no puede tirar abajo un deploy.
 */
function versionDelBuild() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
    ?? (() => {
      try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim() }
      catch { return null }
    })()
  return {
    commit: sha ? sha.slice(0, 7) : 'dev',
    fecha: new Date().toISOString(),
  }
}

export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(versionDelBuild()),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Sube source maps a Sentry para que los stack traces minificados se
    // lean como el código real. Sólo corre si hay SENTRY_AUTH_TOKEN (no
    // seteado en dev local) — sin token, el plugin no hace nada y el build
    // no se rompe.
    process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.js.map'] },
    }),
  ],
  build: {
    // Sólo emite .map cuando se van a subir y borrar después — si no hay
    // token no tiene sentido generarlos (y evita que queden públicos en el
    // deploy por accidente).
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN,
  },
  server: {
    proxy: {
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        headers: {
          'anthropic-version': '2023-06-01',
        },
      },
    },
  },
})
