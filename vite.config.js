import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
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
  plugins: [react(), tailwindcss()],
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
