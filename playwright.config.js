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

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    locale: 'es-AR',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
})
