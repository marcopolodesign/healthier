#!/usr/bin/env node
/**
 * Control del onboarding del paciente por pasos (migración 205, 2026-10-18).
 *
 *   node scripts/verificar-onboarding-paciente.mjs            # lógica + app + STAGING
 *   node scripts/verificar-onboarding-paciente.mjs --sin-base # sólo lógica y código
 *
 * Qué cuida, y por qué cada cosa:
 *
 *   1. La lógica de pasos (lib/pacienteOnboarding.js): qué cuenta como hecho.
 *      La usan el wizard, la tarjeta del inicio y el super admin; si se rompe,
 *      a un paciente completo se le piden datos o uno incompleto no se entera.
 *   2. Las opciones de sexo existen en `profiles_gender_check`. Hasta hoy la
 *      tercera era 'otro', que la base rechaza: elegirla daba error al guardar.
 *   3. La app (mobile/) crea la cuenta con role 'patient'. Mandaba 'paciente',
 *      el trigger `crear_perfil_al_registrarse` lo copiaba tal cual, chocaba con
 *      `profiles_role_check` y el alta por mail desde la app fallaba con
 *      "Database error saving new user" — sin que nada avisara.
 *   4. En staging, como un paciente real (con su sesión, por RLS): alta por mail
 *      con role 'patient', guarda consentimiento, el paso nunca retrocede y la
 *      fecha de completado queda la primera. Y que el alta con 'paciente' sigue
 *      siendo rechazada por la base (si eso cambia, revisar el punto 3).
 *
 * Crea un usuario de prueba (@healthier.app → es_prueba) y lo borra al final.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const { completitudPaciente, debeCompletarPerfil, PASOS_PACIENTE } = await import(join(aqui, '../src/lib/pacienteOnboarding.js'))
const { OPCIONES_SEXO } = await import(join(aqui, '../src/lib/datosReceta.js'))

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

// ── 1. Lógica ─────────────────────────────────────────────────────────────
{
  const vacio = completitudPaciente({ role: 'patient' })
  ok(vacio.obligatoriosHechos === 0 && vacio.primerPendiente === 0, 'perfil vacío: arranca en consentimiento, 0 obligatorios')
  ok(JSON.stringify(vacio.faltan) === JSON.stringify(['Sin consentimiento', 'Sin DNI', 'Sin sexo', 'Sin fecha de nacimiento', 'Sin cobertura']), 'perfil vacío: chips en orden')

  const base = { role: 'patient', consentimientoAt: '2026-10-18T10:00:00Z', dni: '30.111.222', gender: 'femenino', birthDate: '1990-01-01' }
  ok(completitudPaciente({ ...base, coverageType: 'particular' }).obligatoriosCompletos, 'particular cuenta como cobertura elegida; DNI con puntos es válido')
  ok(!completitudPaciente({ ...base, coverageType: 'financiador', financiadorId: null }).obligatoriosCompletos, 'obra social sin id del listado NO cuenta')
  ok(completitudPaciente({ ...base, coverageType: 'financiador', financiadorId: 28 }).primerPendiente === 3, 'obligatorios completos → abre en "Salud"')
  ok(!completitudPaciente({ ...base, dni: '123', coverageType: 'particular' }).obligatoriosCompletos, 'DNI de 3 dígitos no cuenta')
  ok(!debeCompletarPerfil({ role: 'patient', titularId: 'x' }), 'familiar a cargo no recibe el aviso')
  ok(!debeCompletarPerfil({ role: 'professional' }), 'profesional no recibe el aviso')
  ok(debeCompletarPerfil({ role: 'patient' }), 'paciente vacío sí recibe el aviso')
  ok(PASOS_PACIENTE.map(p => p.key).join() === 'consentimiento,datos,cobertura,salud,emergencia', 'orden de pasos estable (es lo que guarda paciente_paso_onboarding)')
}

// ── 2/3. Código: sexo y alta de la app ────────────────────────────────────
const VALIDOS_SEXO = ['masculino', 'femenino', 'no_binario', 'prefiero_no_decir'] // profiles_gender_check
ok(OPCIONES_SEXO.every(o => VALIDOS_SEXO.includes(o.value)), `web: opciones de sexo válidas para la base (${OPCIONES_SEXO.map(o => o.value)})`)

const mobile = join(homedir(), 'Local', 'Healthier', 'mobile')
const mobileDir = process.env.MOBILE_DIR || mobile
if (existsSync(join(mobileDir, 'app'))) {
  const leer = r => { try { return readFileSync(join(mobileDir, r), 'utf8') } catch { return '' } }
  const datosRecetaApp = leer('src/lib/datosReceta.ts')
  ok(!/value:\s*'otro'/.test(datosRecetaApp), 'app: OPCIONES_SEXO sin "otro"')
  const reg = leer('app/(auth)/register.tsx')
  ok(reg && !/role:\s*'paciente'/.test(reg), "app: el alta no manda role 'paciente'")
  ok(/role:\s*'patient'/.test(reg), "app: el alta manda role 'patient'")
  const onb = leer('app/onboarding.tsx')
  ok(/dni/.test(onb) && /financiadorId|financiador_id/.test(onb) && /consentimientoAt|consentimiento_at/.test(onb), 'app: el onboarding guarda DNI, cobertura del listado y consentimiento')
} else {
  console.log(`⚠️  sin repo de la app en ${mobileDir} — se saltean los chequeos de mobile`)
}

// ── 4. Staging ────────────────────────────────────────────────────────────
if (!process.argv.includes('--sin-base')) {
  const leerEnv = (ruta) => {
    try {
      return Object.fromEntries(readFileSync(ruta, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
    } catch { return {} }
  }
  const env = { ...leerEnv(join(homedir(), 'Local', 'Healthier', '.env')), ...leerEnv(join(homedir(), 'Local', '.env')) }
  const URL = env.HEALTHIER_STAGING_SUPABASE_URL
  if (!URL?.includes('itjhrvlzuqvyhqtffumc')) { console.error('❌ no encuentro la URL de STAGING — nunca se corre contra producción'); process.exit(1) }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, opts)
  const anon = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, opts)

  const ids = []
  try {
    // El alta vieja de la app: tiene que seguir rechazándose (si no, el punto 3 cambió).
    const malo = await anon.auth.signUp({ email: `onb-paciente-malo-${Date.now()}@healthier.app`, password: 'Prueba-12345', options: { data: { role: 'paciente' } } })
    if (malo.data?.user?.id) ids.push(malo.data.user.id)
    ok(!!malo.error, `staging: alta con role 'paciente' la rechaza la base (${malo.error?.message ?? 'NO la rechazó'})`)

    const email = `onb-paciente-${Date.now()}@healthier.app`
    const alta = await anon.auth.signUp({ email, password: 'Prueba-12345', options: { data: { full_name: 'Onboarding Prueba', first_name: 'Onboarding', last_name: 'Prueba', role: 'patient' } } })
    ok(!alta.error && alta.data?.user, `staging: alta con role 'patient' ${alta.error?.message ?? 'ok'}`)
    const uid = alta.data?.user?.id
    if (uid) ids.push(uid)

    const pac = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, opts)
    const { error: eLogin } = await pac.auth.signInWithPassword({ email, password: 'Prueba-12345' })
    if (eLogin) { await admin.auth.admin.updateUserById(uid, { email_confirm: true }); await pac.auth.signInWithPassword({ email, password: 'Prueba-12345' }) }

    const upd = async (cambios) => pac.from('profiles').update(cambios).eq('id', uid).select().single()
    let r = await upd({ consentimiento_at: new Date().toISOString(), consentimiento_version: '3.0', paciente_paso_onboarding: 3 })
    ok(!r.error && r.data?.consentimiento_at, `staging: el paciente guarda su consentimiento ${r.error?.message ?? ''}`)
    r = await upd({ paciente_paso_onboarding: 1 })
    ok(r.data?.paciente_paso_onboarding === 3, `staging: el paso no retrocede (quedó ${r.data?.paciente_paso_onboarding})`)
    r = await upd({ dni: '30111222', gender: 'no_binario', birth_date: '1990-01-01', coverage_type: 'particular' })
    ok(!r.error, `staging: guarda DNI, sexo X (no_binario) y particular ${r.error?.message ?? ''}`)
    const primera = '2026-10-18T12:00:00.000Z'
    await upd({ onboarding_completado_at: primera })
    r = await upd({ onboarding_completado_at: new Date().toISOString() })
    ok(new Date(r.data?.onboarding_completado_at).toISOString() === primera, 'staging: la fecha de completado queda la primera')
    ok(completitudPaciente({ role: 'patient', consentimientoAt: r.data.consentimiento_at, dni: r.data.dni, gender: r.data.gender, birthDate: r.data.birth_date, coverageType: r.data.coverage_type }).obligatoriosCompletos,
      'staging: con eso, la lógica lo da por completo')
  } finally {
    for (const id of ids) await admin.auth.admin.deleteUser(id)
  }
}

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ todo bien')
process.exit(fallas ? 1 : 0)
