// Una sesión de Supabase de staging para una cuenta demo, sin tipear ni tocar
// su contraseña: magic link del Admin API canjeado por la sesión. Es lo mismo
// que hace ~/Local/scripts/supabase-session.py, en Node para Playwright.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Lee ~/Local/.env (y el .env del repo) sin pisar lo que ya esté en el entorno. */
export function cargarEnv() {
  for (const f of [path.join(os.homedir(), 'Local/.env')]) {
    if (!fs.existsSync(f)) continue
    for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = linea.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  const url = process.env.HEALTHIER_STAGING_SUPABASE_URL
  const anon = process.env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
  const service = process.env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) throw new Error('Faltan HEALTHIER_STAGING_* en ~/Local/.env')
  const ref = new URL(url).hostname.split('.')[0]
  return { url, anon, service, ref }
}

async function post(url, body, headers) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`)
  return j
}

/** Devuelve la sesión ({ access_token, refresh_token, user, ... }) de ese mail. */
export async function sesionDe(email, env = cargarEnv()) {
  const link = await post(`${env.url}/auth/v1/admin/generate_link`, { type: 'magiclink', email },
    { apikey: env.service, Authorization: `Bearer ${env.service}` })
  const token_hash = link.hashed_token || link.properties?.hashed_token
  const s = await post(`${env.url}/auth/v1/verify`, { type: 'magiclink', token_hash }, { apikey: env.anon || env.service })
  if (!s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + s.expires_in
  return s
}

/** La llave de localStorage donde supabase-js guarda la sesión. */
export const llaveSesion = (env) => `sb-${env.ref}-auth-token`
