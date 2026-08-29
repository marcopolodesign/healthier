import { defineConfig } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load .env.test if it exists (local test credentials)
try {
  const lines = readFileSync(join(import.meta.dirname, '.env.test'), 'utf8').split('\n')
  for (const line of lines) {
    const [k, ...rest] = line.split('=')
    if (k && rest.length) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch { /* no .env.test — rely on environment */ }

const PORT = 5200

// E2E_BASE_URL apunta los tests a un entorno ya deployado (staging o
// producción) en vez de levantar un dev server local — así se puede correr
// la suite después de un deploy real. Cuando está seteada NO se define
// `webServer`: no tiene sentido levantar Vite local para pegarle a una URL
// remota, y el flujo local (sin la variable) sigue exactamente igual que
// antes para ondemand.spec.js y el resto.
//
// 🔴 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// (usadas por los specs vía createClient) tienen que ser las del MISMO
// entorno que E2E_BASE_URL. Si apuntás E2E_BASE_URL a producción con las
// claves de staging (o viceversa), los asserts de base de datos miran una
// base que no es la que el browser está usando — el test puede "pasar" sin
// haber probado nada. No hay forma de validar esto automáticamente porque
// las claves llegan por variables de entorno sueltas; quien corre el test
// tiene que pasar las tres juntas y del mismo lugar.
const E2E_BASE_URL = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: E2E_BASE_URL ?? `http://localhost:${PORT}`,
    headless: true,
    locale: 'es-AR',
  },
  ...(E2E_BASE_URL ? {} : {
    webServer: {
      command: `npm run dev -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 20_000,
    },
  }),
})
