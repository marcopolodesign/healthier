#!/usr/bin/env node
/**
 * Chequeo de "¿Olvidaste tu contraseña?".
 *
 *   node scripts/verificar-recuperar-contrasena.mjs            # producción
 *   node scripts/verificar-recuperar-contrasena.mjs staging
 *
 * Qué prueba:
 *   1. La plantilla de recuperación cargada en Supabase Auth arma el link con
 *      `token_hash` hacia `/restablecer-contrasena` — NO con
 *      `{{ .ConfirmationURL }}`. Con PKCE el code verifier queda en el
 *      dispositivo que pidió el mail, así que un pedido hecho desde la app no
 *      se podía canjear en la web. Si alguien vuelve a pegar la plantilla por
 *      defecto (o el `aplicar-mails-de-auth.ts` de una rama vieja), esto cae.
 *   2. El rate limit de mails no volvió a 2 por hora (el default): con eso,
 *      dos pedidos de cualquiera en toda la plataforma bloquean al resto.
 *   3. El circuito de punta a punta contra la API real: crea una cuenta de
 *      prueba descartable, genera el link por admin API (no manda mail),
 *      canjea el token_hash con `verifyOtp` como lo hace la pantalla, cambia la
 *      contraseña con esa sesión y entra con la nueva. Al final borra la cuenta.
 *
 * No manda ningún mail y no toca ninguna cuenta existente.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd', url: 'https://aixjejdoofervrkggbkd.supabase.co' },
  staging:    { ref: 'itjhrvlzuqvyhqtffumc', url: 'https://itjhrvlzuqvyhqtffumc.supabase.co' },
}
const nombre = process.argv[2] || 'produccion'
const entorno = ENTORNOS[nombre]
if (!entorno) { console.error('Uso: node scripts/verificar-recuperar-contrasena.mjs [produccion|staging]'); process.exit(1) }

let fallas = 0
const ok  = (m) => console.log(`   ✅ ${m}`)
const mal = (m) => { fallas++; console.log(`   ❌ ${m}`) }

const mgmt = (path) => fetch(`https://api.supabase.com/v1/projects/${entorno.ref}${path}`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
}).then(r => r.json())

console.log(`\n═══ RECUPERAR CONTRASEÑA · ${nombre.toUpperCase()} ═══`)

// ── 1 y 2) Configuración de Auth ────────────────────────────────────────────
console.log('\n▸ Configuración de Auth')
const cfg = await mgmt('/config/auth')
const plantilla = cfg.mailer_templates_recovery_content || ''
if (/\{\{\s*\.SiteURL\s*\}\}\/restablecer-contrasena\?token_hash=\{\{\s*\.TokenHash\s*\}\}&(amp;)?type=recovery/.test(plantilla)) {
  ok('la plantilla arma el link con token_hash hacia /restablecer-contrasena')
} else {
  mal('la plantilla de recuperación NO usa token_hash → /restablecer-contrasena (correr `npx tsx scripts/aplicar-mails-de-auth.ts ' + nombre + '`)')
}
if (plantilla.includes('ConfirmationURL')) mal('la plantilla todavía menciona {{ .ConfirmationURL }} (PKCE: no anda entre dispositivos)')
const limite = Number(cfg.rate_limit_email_sent)
if (limite >= 10) ok(`rate limit de mails: ${limite} por hora`)
else mal(`rate limit de mails en ${limite} por hora — con eso dos pedidos bloquean a toda la plataforma`)

// ── 3) Circuito completo ────────────────────────────────────────────────────
console.log('\n▸ Circuito: generar link → verifyOtp → cambiar contraseña → entrar')
const keys = await mgmt('/api-keys?reveal=true')
const buscar = (n) => (Array.isArray(keys) ? keys.find(k => k.name === n)?.api_key : '') || ''
const anon = buscar('anon'), service = buscar('service_role')
if (!anon || !service) {
  mal('no se pudieron leer las claves del proyecto')
} else {
  const admin = createClient(entorno.url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  // Crear la cuenta dispara el mail de bienvenida (trigger de profiles). Va a
  // la casilla sumidero de Resend, que lo acepta sin rebotar: un dominio
  // inventado rebotaría en cada corrida y le baja la reputación al remitente.
  const email = `delivered+recuperar-${Date.now()}@resend.dev`
  const vieja = `Vieja-${Math.random().toString(36).slice(2, 10)}`
  const nueva = `Nueva-${Math.random().toString(36).slice(2, 10)}`
  let userId = null
  try {
    const { data: creado, error: eCrear } = await admin.auth.admin.createUser({
      email, password: vieja, email_confirm: true,
      user_metadata: { full_name: 'QA Recuperar Contraseña', role: 'patient' },
    })
    if (eCrear) throw new Error(`crear cuenta de prueba: ${eCrear.message}`)
    userId = creado.user.id

    const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    if (eLink) throw new Error(`generate_link: ${eLink.message}`)
    const tokenHash = link.properties?.hashed_token
    if (!tokenHash) throw new Error('generate_link no devolvió hashed_token')
    ok('generate_link devolvió un token_hash')

    const cliente = createClient(entorno.url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: v, error: eV } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    if (eV || !v.session) throw new Error(`verifyOtp: ${eV?.message || 'sin sesión'}`)
    ok('verifyOtp con el token_hash da sesión')

    const { error: eReuso } = await createClient(entorno.url, anon, { auth: { persistSession: false } })
      .auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    if (eReuso) ok('el mismo token no sirve dos veces')
    else mal('el token de recuperación se pudo canjear dos veces')

    const { error: eUpd } = await cliente.auth.updateUser({ password: nueva })
    if (eUpd) throw new Error(`updateUser: ${eUpd.message}`)
    ok('updateUser cambió la contraseña con esa sesión')

    const otro = createClient(entorno.url, anon, { auth: { persistSession: false } })
    const { error: eNueva } = await otro.auth.signInWithPassword({ email, password: nueva })
    if (eNueva) mal(`no entra con la contraseña nueva: ${eNueva.message}`)
    else ok('entra con la contraseña nueva')
    const { error: eVieja } = await otro.auth.signInWithPassword({ email, password: vieja })
    if (eVieja) ok('la contraseña vieja ya no sirve')
    else mal('la contraseña vieja sigue sirviendo')

    const { error: eBasura } = await otro.auth.verifyOtp({ token_hash: 'no-es-un-token', type: 'recovery' })
    if (eBasura) ok(`un token inválido se rechaza (${eBasura.code || eBasura.message})`)
    else mal('un token inválido dio sesión')
  } catch (err) {
    mal(err.message)
  } finally {
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) mal(`no se pudo borrar la cuenta de prueba ${email}: ${error.message}`)
      else console.log(`   ·  cuenta de prueba borrada`)
    }
  }
}

console.log(fallas ? `\n❌ ${fallas} falla(s)\n` : '\n✅ Todo en orden\n')
process.exit(fallas ? 1 : 0)
