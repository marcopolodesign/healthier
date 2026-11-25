#!/usr/bin/env node
/**
 * Embudo de los pacientes nuevos: qué pantallas miran después de registrarse y
 * dónde se quedan. SÓLO LEE.
 *
 *   node scripts/embudo-pacientes.mjs staging
 *   node scripts/embudo-pacientes.mjs produccion --desde 2026-11-10
 *   node scripts/embudo-pacientes.mjs staging --con-prueba   # incluye cuentas de prueba (verificar)
 *
 * Pacientes nuevos = role 'patient', sin marca de prueba, sin baja, creados
 * desde `--desde` (por defecto, hace 14 días).
 *
 * Fuentes (de cada paciente):
 *   · `profiles.flow_url` (migración 232) — el recorrido HASTA el alta.
 *   · `recorrido_paciente` (migración 247) — pantallas e hitos DESPUÉS del alta,
 *     web y app. Si la tabla todavía no existe en ese entorno, se avisa y el
 *     embudo sale sólo con lo de antes del alta.
 *   · `consultations` — si reservó de verdad (cualquier consulta propia).
 *
 * Imprime: cuántos llegaron a cada paso clave y cuál fue la última pantalla de
 * cada uno (conteo).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)

const REFS = { produccion: 'aixjejdoofervrkggbkd', staging: 'itjhrvlzuqvyhqtffumc' }
let entorno
let desde
let conPrueba = false

function leerArgumentos() {
  entorno = process.argv[2]
  if (!REFS[entorno]) {
    console.error('uso: node scripts/embudo-pacientes.mjs <staging|produccion> [--desde YYYY-MM-DD] [--con-prueba]')
    process.exit(1)
  }
  conPrueba = process.argv.includes('--con-prueba')
  const iDesde = process.argv.indexOf('--desde')
  desde = iDesde > 0 ? process.argv[iDesde + 1] : new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) { console.error('--desde tiene que ser YYYY-MM-DD'); process.exit(1) }
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REFS[entorno]}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 300))
  return cuerpo
}

// ── Pasos clave: una pantalla (por nombre, web o app) o un hito ───────────
// `nombres` son los nombres legibles de src/lib/flowUrl.js (web) y
// mobile/src/lib/flowUrl.ts (app).
export const PASOS = [
  { clave: 'alta', titulo: 'Completó el alta (onboarding)', es: p => p.completoAlta },
  { clave: 'inicio', titulo: 'Inicio del paciente', nombres: ['Inicio del paciente'] },
  { clave: 'buscar', titulo: 'Buscar profesional', nombres: ['Buscar profesional', 'Profesionales disponibles', 'Buscar disponibles', 'Mis profesionales'] },
  { clave: 'perfil_pro', titulo: 'Perfil de un profesional', nombres: ['Perfil del profesional', 'Ficha del profesional'] },
  { clave: 'reservar', titulo: 'Reservar (wizard)', nombres: ['Reservar consulta', 'Reservar: elegir servicio', 'Mis consultas'] },
  { clave: 'eligio_pro', titulo: 'Eligió profesional', hitos: ['eligio_profesional'] },
  { clave: 'horarios', titulo: 'Vio horarios', hitos: ['vio_horarios'] },
  { clave: 'eligio_horario', titulo: 'Eligió horario', hitos: ['eligio_horario'] },
  { clave: 'inmediata', titulo: 'Consulta inmediata', nombres: ['Consulta inmediata'] },
  { clave: 'pago', titulo: 'Llegó al pago', nombres: ['Pago de la consulta'], hitos: ['llego_al_pago'] },
  { clave: 'pago_error', titulo: 'Error de pago', hitos: ['error_de_pago'] },
  { clave: 'pago_ok', titulo: 'Pagó / turno confirmado', nombres: ['Turno confirmado'], hitos: ['pago'], es: p => p.reservo },
  { clave: 'farmacia', titulo: 'Farmacia', prefijo: 'Farmacia' },
  { clave: 'boveda', titulo: 'Bóveda / documentos', nombres: ['Bóveda de salud', 'Mis documentos', 'Mis recetas', 'Receta'] },
]

export function llegoA(paso, p) {
  if (paso.es?.(p)) return true
  const despues = p.despues
  if (paso.nombres && despues.some(e => !e.hito && paso.nombres.includes(e.name))) return true
  if (paso.prefijo && despues.some(e => !e.hito && String(e.name).startsWith(paso.prefijo))) return true
  if (paso.hitos && despues.some(e => paso.hitos.includes(e.hito))) return true
  return false
}

/** Última pantalla (no hito): la de después del alta, o la última de antes. */
export function ultimaPantalla(p) {
  const pantallas = p.despues.filter(e => !e.hito)
  if (pantallas.length) return pantallas.at(-1).name
  if (Array.isArray(p.antes) && p.antes.length) return `${p.antes.at(-1).name} (antes del alta)`
  return '(sin recorrido)'
}

/** Llegó al pago (la última vez) y después no pagó ni creó una consulta. */
export function abandonoElPago(p) {
  const i = p.despues.findLastIndex(e => e.hito === 'llego_al_pago' || (!e.hito && e.name === 'Pago de la consulta'))
  if (i < 0) return false
  // Una consulta creada después de llegar al pago cuenta como que siguió.
  if (p.ultimaConsulta && Date.parse(p.ultimaConsulta) >= Date.parse(p.despues[i].at)) return false
  return !p.despues.slice(i + 1).some(e => e.hito === 'pago' || e.name === 'Turno confirmado')
}

async function main() {
  leerArgumentos()
  const hayTabla = (await sql(`select to_regclass('public.recorrido_paciente') is not null as hay`))[0]?.hay

  const pacientes = await sql(`
    select p.id, p.created_at, p.flow_url,
           (p.onboarding_completado_at is not null
             or not coalesce(p.requiere_onboarding, true)) as completo_alta,
           exists (select 1 from consultations c where c.patient_id = p.id) as reservo,
           (select max(c.created_at) from consultations c where c.patient_id = p.id) as ultima_consulta
      from profiles p
     where p.role = 'patient'
       and (${conPrueba} or not coalesce(p.es_prueba, false))
       and p.deleted_at is null
       and p.created_at >= '${desde}'::date
     order by p.created_at`)

  const despuesPorPaciente = new Map()
  if (hayTabla && pacientes.length) {
    const filas = await sql(`
      select r.user_id, r.at, r.name, r.via, r.hito
        from recorrido_paciente r
        join profiles p on p.id = r.user_id
       where p.role = 'patient' and (${conPrueba} or not coalesce(p.es_prueba, false)) and p.deleted_at is null
         and p.created_at >= '${desde}'::date
       order by r.user_id, r.at, r.id`)
    for (const f of filas) {
      if (!despuesPorPaciente.has(f.user_id)) despuesPorPaciente.set(f.user_id, [])
      despuesPorPaciente.get(f.user_id).push(f)
    }
  }

  const ps = pacientes.map(p => ({
    id: p.id,
    antes: p.flow_url,
    completoAlta: p.completo_alta,
    reservo: p.reservo,
    ultimaConsulta: p.ultima_consulta,
    despues: despuesPorPaciente.get(p.id) ?? [],
  }))

  const n = ps.length
  const pct = k => (n ? `${Math.round((k / n) * 100)}%` : '—')
  console.log(`\nEmbudo de pacientes nuevos — ${entorno} — desde ${desde}`)
  console.log(`Pacientes nuevos (${conPrueba ? 'CON cuentas de prueba' : 'sin prueba'}, sin baja): ${n}`)
  if (!hayTabla) {
    console.log('⚠️  La tabla recorrido_paciente (migración 247) no existe en este entorno:')
    console.log('    lo de después del alta sale vacío; sólo cuenta el recorrido hasta el alta y las reservas.')
  }
  const conDespues = ps.filter(p => p.despues.length)
  const enApp = conDespues.filter(p => p.despues.some(e => e.via === 'app')).length
  const enWeb = conDespues.filter(p => p.despues.some(e => e.via === 'web')).length
  console.log(`Con recorrido después del alta: ${conDespues.length} (web ${enWeb} · app ${enApp})`)

  console.log('\n▸ Llegaron a cada paso')
  const ancho = Math.max(...PASOS.map(p => p.titulo.length))
  for (const paso of PASOS) {
    const k = ps.filter(p => llegoA(paso, p)).length
    console.log(`   ${paso.titulo.padEnd(ancho)}  ${String(k).padStart(4)}  ${pct(k).padStart(4)}`)
  }
  const ab = ps.filter(abandonoElPago).length
  console.log(`   ${'Abandonó el pago'.padEnd(ancho)}  ${String(ab).padStart(4)}  ${pct(ab).padStart(4)}`)

  console.log('\n▸ Última pantalla de cada paciente')
  const conteo = new Map()
  for (const p of ps) {
    const u = ultimaPantalla(p)
    conteo.set(u, (conteo.get(u) ?? 0) + 1)
  }
  for (const [nombre, k] of [...conteo].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(k).padStart(4)}  ${nombre}`)
  }
  console.log('')
}

// Sólo corre si se lo llama directo (el test importa las funciones).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('❌', e.message); process.exit(1) })
}
