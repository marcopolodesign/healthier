#!/usr/bin/env node
/**
 * Control de la migración 236: las RPC SECURITY DEFINER no se pueden llamar
 * SIN SESIÓN.
 *
 *   node scripts/verificar-rpc-anonimas.mjs             # staging
 *   node scripts/verificar-rpc-anonimas.mjs produccion  # sólo lectura, también sirve
 *
 * Por qué existe. Una guarda `IF get_my_role() NOT IN (...) THEN RAISE` no
 * dispara sin sesión (NULL NOT IN (...) es NULL), y las funciones conservaban
 * EXECUTE para PUBLIC/anon. Con sólo la anon key, sin token de usuario, se
 * leían todos los profesionales con mail y código, los referidos de cualquiera,
 * saldos y deuda, y se podían liquidar pagos o cerrar consultas.
 *
 * Qué hace (dos pruebas):
 *  1. Llama con la anon key, sin token, a cada RPC protegida con argumentos de
 *     mentira y exige un ERROR. Si alguna devuelve 2xx, el problema volvió.
 *  2. Lista TODAS las funciones SECURITY DEFINER de `public` (no triggers) que
 *     anon puede ejecutar y las compara con la lista blanca de más abajo. Una
 *     función nueva que anon pueda ejecutar y no esté en la lista falla el
 *     chequeo: o se le revoca anon, o se la agrega acá a propósito.
 *
 * Sólo lee (las llamadas de la prueba 1 deben ser rechazadas; si no lo fueran,
 * con argumentos inexistentes no tocan ningún dato real). Usa el
 * SUPABASE_ACCESS_TOKEN de ~/Local/.env para la anon key y la prueba 2.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)
const REFS = { staging: 'itjhrvlzuqvyhqtffumc', produccion: 'aixjejdoofervrkggbkd' }
const entorno = process.argv[2] === 'produccion' ? 'produccion' : 'staging'
const ref = REFS[entorno]
const url = `https://${ref}.supabase.co`
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN en ~/Local/.env'); process.exit(2) }

const U = '00000000-0000-0000-0000-000000000000'

// Protegidas: nombre -> argumentos de mentira. Todas tienen que dar error sin sesión.
const PROTEGIDAS = {
  resumen_de_referidos: { p_incluir_prueba: true },
  referidos_de_profesional: { p_professional_id: U },
  get_credit_balance: { p_patient: U },
  get_professional_pending_debt: { p_professional: U },
  mark_settlement_paid: { p_payment: U },
  mark_reassignment_owed_paid: { p_reassignment_id: U },
  reassign_consultation: { p_consultation_id: U, p_new_professional_id: U },
  completar_cierre_de_consulta: { p_consultation_id: U, p_motivo_sin_codigo: 'x' },
  verificar_codigo_de_cierre: { p_consultation_id: U, p_code: '000000' },
  start_consultation: { p_consultation_id: U, p_code: '000000' },
  finalize_consultation: { p_consultation_id: U, p_role: 'professional' },
  promote_user_to_admin: { target_email: 'nadie@example.invalid', new_role: 'admin' },
  complete_patient_rcta_data: { p_patient_id: U },
  accept_ondemand_request: { p_request_id: U },
  actualizar_item_pedido_medicamentos: { p_item_id: U, p_quantity: 1 },
  agregar_item_pedido_medicamentos: { p_product_id: U, p_delta: 1 },
  marcar_notificaciones_leidas: {},
  mis_referidos: {},
  // sólo service_role
  apply_debt_recovery: { p_professional: U, p_amount: 1, p_payment_id: U },
  enviar_push: { p_user_id: U, p_titulo: 'x', p_cuerpo: 'x', p_url: 'x' },
  cerrar_consultas_colgadas: {},
  recalc_professional_rating: { p_professional_id: U },
  recalcular_total_pedido_medicamentos: { p_order_id: U },
  // de la 214/155, ya estaban bien: que no se rompan
  farmacia_recetas_del_pedido: { p_order_id: U },
  verificar_codigo_entrega: { p_order_id: U, p_code: '000000' },
  atribuciones_de_referidos: { p_incluir_prueba: true },
  mi_programa_de_referidos: {},
}

// Públicas A PROPÓSITO (se llaman sin sesión o las usan las policies de RLS).
// Agregar una acá es una decisión: dejar escrito por qué.
const LISTA_BLANCA = new Set([
  // antes de iniciar sesión
  'resolver_link_de_referido', 'resolver_codigo_de_paciente', 'cuenta_dada_de_baja',
  // helpers de RLS / de la UI: devuelven false o vacío sin sesión
  'get_my_role', 'es_operador_de_plataforma', 'has_shared_consultation', 'puedo_actuar_como',
  'soy_tripulacion', 'soy_medico_del_movil', 'soy_paciente_de_ambulancia', 'movil_de_guardia',
  'entidad_de_ambulancia', 'mi_entidad_de_emergencias', 'mundo_que_veo', 'veo_bajas',
  'puede_tomar_ondemand', 'profesionales_en_atencion', 'profesional_puede_recetar',
  '_aal_actor_es_admin',
])

let rojo = 0
const falla = (m) => { rojo++; console.log('  ✗ ' + m) }
const ok = (m) => console.log('  ✓ ' + m)

async function mgmt(path, init = {}) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' },
  })
  return r.json()
}

const keys = await mgmt('/api-keys')
const anon = keys.find(k => k.name === 'anon')?.api_key
if (!anon) { console.error('No pude leer la anon key'); process.exit(2) }

console.log(`\n[${entorno}] 1. RPC protegidas llamadas SIN sesión (la anon key sola)`)
for (const [fn, args] of Object.entries(PROTEGIDAS)) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const cuerpo = await r.text()
  if (r.status === 404 && /Could not find the function/.test(cuerpo)) {
    // la función no existe en este ambiente (ej.: las de la 235 en producción): no hay nada que cerrar
    console.log(`  - ${fn}: no existe en ${entorno}, se saltea`)
    continue
  }
  if (r.ok) falla(`${fn} RESPONDIÓ ${r.status} sin sesión: ${cuerpo.slice(0, 120)}`)
  else ok(`${fn} → ${r.status} ${(JSON.parse(cuerpo || '{}').code) || ''}`)
}

console.log(`\n[${entorno}] 2. SECURITY DEFINER ejecutables por anon vs. la lista blanca`)
const filas = await mgmt('/database/query', {
  method: 'POST',
  body: JSON.stringify({
    query: `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and has_function_privilege('anon', p.oid, 'EXECUTE')
              and pg_get_function_result(p.oid) <> 'trigger'
            order by 1`,
  }),
})
if (!Array.isArray(filas)) falla('no pude listar las funciones: ' + JSON.stringify(filas).slice(0, 200))
else {
  const sobran = [...new Set(filas.map(f => f.proname))].filter(n => !LISTA_BLANCA.has(n))
  if (sobran.length === 0) ok(`${filas.length} funciones ejecutables por anon, todas en la lista blanca`)
  for (const n of sobran) falla(`${n} la puede ejecutar anon y no está en la lista blanca`)
}

console.log(rojo === 0 ? '\nVERDE — nada se puede llamar sin sesión.\n' : `\nROJO — ${rojo} problema(s).\n`)
process.exit(rojo === 0 ? 0 : 1)
