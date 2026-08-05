#!/usr/bin/env node
/**
 * Emite las pruebas de certificación que Innovamed pide para habilitar producción.
 *
 * Innovamed (soporte.it@innovamed.com.ar, 2026-07-28):
 *   "Para certificar la parte tecnica necesitamos estas 4 pruebas: [...]
 *    Copiando el id de transacción de cada una."
 *
 * Dos cosas que este script hace a propósito y que la tanda del 2026-07-28 no hizo:
 *
 *   1. **Emite atravesando la Edge Function `rcta-issue`**, no mandando el payload
 *      suelto contra el sandbox. Lo que Innovamed certifica es la integración, no
 *      un curl: si la receta sale por el mismo camino que va a usar un profesional
 *      real, la prueba vale para las dos cosas.
 *   2. **Deja el `idTransaccion` guardado** en `rcta_issue_log` y en
 *      `clinical_medications.rcta_transaction_id` (migración 092). La vez pasada
 *      ese dato se perdió y hubo que reconstruir las pruebas a mano.
 *
 * Uso (desde website/):
 *   node scripts/rcta-certificacion.mjs                 # emite todos los casos
 *   node scripts/rcta-certificacion.mjs --dry-run       # arma los datos y no emite
 *   node scripts/rcta-certificacion.mjs --caso pasteur  # sólo los casos que matcheen
 *
 * `--caso` importa: las filas clínicas **no se pueden borrar** (trigger de
 * retención a 10 años, Ley 26.529 Art. 18), así que cada corrida completa deja
 * cinco recetas nuevas en la base. Para reintentar un solo caso, filtralo.
 *
 * Los datos que crea quedan marcados con `purpose: 'certificacion'` en el log y
 * con "[CERTIFICACIÓN RCTA]" en las notas, para poder separarlos de una receta real.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const aca = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(aca, '../.env'), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const SUPABASE_URL = env.VITE_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
const RCTA_URL     = env.RCTA_API_URL
const RCTA_KEY     = env.RCTA_API_KEY
const RCTA_APP     = env.RCTA_CLIENT_APP_ID

for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, RCTA_URL, RCTA_KEY, RCTA_APP })) {
  if (!v) { console.error(`Falta ${k} en website/.env`); process.exit(1) }
}

const DRY = process.argv.includes('--dry-run')
const FILTRO = (process.argv[process.argv.indexOf('--caso') + 1] ?? '').toLowerCase()

// ── Las 4 pruebas, tal como las pidió Innovamed ──────────────────────────────
// Los dos mails de Innovamed no coinciden en los números de afiliado, así que se
// emiten las dos variantes de cada uno con diferencia y que ellos tomen la que
// corresponda — es más barato que rebotar la certificación por un dígito:
//
//   · Luis Pasteur — 6/7: 23701900080 · 28/7: 42731800060
//     ⚠️ El del 28/7 responde **QBI212 "CREDENCIAL INHABILITADA"** (probado
//     2026-08-05). El del 6/7 emite bien. Preguntado a Innovamed.
//   · Accord Salud — 6/7: 23256785 (8 díg.) · 28/7: 2325678 (7 díg.)
//     Las dos emiten sin error.
const CASOS = [
  { nombre: 'OSDE',                      idFinanciador: 28, afiliado: '23200126801' },
  { nombre: 'Luis Pasteur (mail 6/7)',   idFinanciador: 9,  afiliado: '23701900080' },
  { nombre: 'Luis Pasteur (mail 28/7)',  idFinanciador: 9,  afiliado: '42731800060' },
  { nombre: 'Accord Salud (8 díg.)',     idFinanciador: 96, afiliado: '23256785'    },
  { nombre: 'Accord Salud (7 díg.)',     idFinanciador: 96, afiliado: '2325678'     },
  { nombre: 'Particular',                idFinanciador: null, afiliado: null        },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
const rest = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const insertar = async (tabla, fila) => (await rest(tabla, { method: 'POST', body: JSON.stringify(fila) }))[0]

// ── 1. Un medicamento real del vademécum ────────────────────────────────────
// `regNo` tiene que salir del catálogo de Innovamed o la API responde QBI105.
// Se evitan los controlados/psicofármacos: para certificar alcanza con el caso
// simple, y un producto que exige duplicado agrega una variable al pedo.
async function elegirMedicamento(busqueda = 'ibuprofeno') {
  const res = await fetch(
    `${RCTA_URL}/apirecipe/GetMedicamento/${encodeURIComponent(busqueda)}?clienteAppId=${RCTA_APP}&numeroPagina=1`,
    { headers: { Authorization: `Bearer ${RCTA_KEY}` } },
  )
  if (!res.ok) throw new Error(`GetMedicamento → ${res.status}`)
  const { medicamentos = [] } = await res.json()
  const simple = medicamentos.find(m =>
    !m.psicofarmaco && !m.estupefaciente && !m.ventaControlada && !m.requiereDuplicado && m.regNo)
  const elegido = simple ?? medicamentos.find(m => m.regNo)
  if (!elegido) throw new Error(`Sin resultados de catálogo para "${busqueda}"`)
  return elegido
}

// ── 2. Paciente y profesional de prueba ─────────────────────────────────────
// Se reusan perfiles demo ya sembrados en vez de crear usuarios nuevos: RCTA
// exige DNI, sexo y fecha de nacimiento, y estos ya los tienen cargados.
async function actores() {
  // Se pide `birth_date` además del DNI: varios perfiles sembrados lo tienen en
  // NULL, y para una prueba de certificación conviene el payload más completo
  // que se pueda armar. La dirección es obligatoria de verdad — sin ella la API
  // rechaza con QBI248 "DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN".
  const [pro] = await rest(
    'profiles?select=id,full_name,dni,birth_date,professional_profiles!professional_profiles_user_id_fkey(specialty,license_type,license_number,address)' +
    '&role=eq.professional&dni=not.is.null&birth_date=not.is.null&limit=1&order=created_at.asc',
  )
  if (!pro?.professional_profiles?.address) throw new Error('El profesional demo no tiene dirección cargada (QBI248)')
  const [paciente] = await rest(
    'profiles?select=id,full_name,dni,gender,birth_date&role=eq.patient&dni=not.is.null&birth_date=not.is.null&limit=1&order=created_at.asc',
  )
  if (!pro?.professional_profiles) throw new Error('No hay profesional demo con DNI y ficha profesional')
  if (!paciente) throw new Error('No hay paciente demo con DNI y fecha de nacimiento')
  return { pro, paciente }
}

// ── 3. Una consulta + encuentro + medicación por caso ───────────────────────
async function armarReceta({ pro, paciente, medicamento, caso }) {
  const ficha = pro.professional_profiles

  const consulta = await insertar('consultations', {
    patient_id: paciente.id,
    professional_id: pro.id,
    status: 'completed',
    coverage_type: caso.idFinanciador ? 'financiador' : 'particular',
    financiador_id: caso.idFinanciador,
    affiliate_number: caso.afiliado,
    obra_social_name: caso.idFinanciador ? caso.nombre : null,
  })

  const encuentro = await insertar('clinical_encounters', {
    patient_id: paciente.id,
    professional_id: pro.id,
    consultation_id: consulta.id,
    professional_license_type: ficha.license_type ?? 'MN',
    professional_license_number: ficha.license_number ?? '',
    modality: 'telemedicina',
    specialty: ficha.specialty ?? 'medicina_general',
    status: 'in_progress',
  })

  const medicacion = await insertar('clinical_medications', {
    patient_id: paciente.id,
    professional_id: pro.id,
    encounter_id: encuentro.id,
    professional_license_type: ficha.license_type ?? 'MN',
    professional_license_number: ficha.license_number ?? '',
    medication_name: medicamento.nombreProducto,
    nombre_droga: medicamento.nombreDroga,
    presentacion: medicamento.presentacion,
    reg_no: medicamento.regNo,
    dosage_text: '1 comprimido',
    frequency: 'cada 8 horas',
    quantity: '1',
    notes: `[CERTIFICACIÓN RCTA] Prueba ${caso.nombre} — Innovamed 2026-07-28`,
  })

  return { consulta, encuentro, medicacion }
}

// ── 4. Emitir por la Edge Function real ─────────────────────────────────────
async function emitir(medicationId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/rcta-issue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ medicationIds: [medicationId], purpose: 'certificacion' }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ── Main ────────────────────────────────────────────────────────────────────
const medicamento = await elegirMedicamento()
const { pro, paciente } = await actores()

console.log(`Ambiente:     ${RCTA_URL}  (clienteAppId ${RCTA_APP})`)
console.log(`Medicamento:  ${medicamento.nombreProducto} — ${medicamento.presentacion} (regNo ${medicamento.regNo})`)
console.log(`Profesional:  ${pro.full_name} · ${pro.professional_profiles.license_type} ${pro.professional_profiles.license_number}`)
console.log(`Paciente:     ${paciente.full_name} · DNI ${paciente.dni}\n`)

const resultados = []
for (const caso of CASOS.filter(c => !FILTRO || c.nombre.toLowerCase().includes(FILTRO))) {
  const { medicacion } = await armarReceta({ pro, paciente, medicamento, caso })
  if (DRY) {
    console.log(`· ${caso.nombre}: medicación ${medicacion.id} lista (dry-run, no se emitió)`)
    resultados.push({ caso, medicationId: medicacion.id })
    continue
  }

  const { status, body } = await emitir(medicacion.id)
  const ok = status === 200
  console.log(
    `${ok ? '✅' : '❌'} ${caso.nombre.padEnd(24)} ` +
    (ok
      ? `idTransaccion ${body.transactionId ?? '—'} · idReceta ${body.prescriptionId}`
      : `HTTP ${status} · ${JSON.stringify(body?.detail ?? body?.error).slice(0, 160)}`),
  )
  resultados.push({ caso, medicationId: medicacion.id, status, body })
}

if (!DRY) {
  console.log('\n── Para el mail a Innovamed ──────────────────────────────────')
  for (const r of resultados.filter(r => r.status === 200)) {
    console.log(`${r.caso.nombre}${r.caso.afiliado ? ` (afiliado ${r.caso.afiliado})` : ''}: id de transacción ${r.body.transactionId}`)
  }
}
