#!/usr/bin/env node
/**
 * Chequeo del circuito de receta electrónica (RCTA / Innovamed) — SOLO LECTURA.
 *
 *   node scripts/verificar-recetas.mjs            # producción + staging
 *   node scripts/verificar-recetas.mjs produccion # sólo producción
 *   node scripts/verificar-recetas.mjs staging    # sólo staging
 *
 * **Por qué existe.** Desde el 2026-08-28 producción está viva con las claves
 * reales de Innovamed: emitir una receta desde `gethealthier.vercel.app` es un
 * acto médico legalmente válido, asociado a la matrícula real del profesional.
 * Eso significa que `scripts/rcta-certificacion.mjs` — que SÍ emite recetas —
 * no puede formar parte de ningún chequeo automático (post-deploy o el que
 * sea): correrlo desde acá emitiría recetas reales cada vez que alguien
 * deployara. Este script existe para separar las dos cosas: probar que el
 * circuito está en pie es automático, emitir sigue siendo un acto manual y
 * deliberado.
 *
 * **Qué chequea, por entorno:**
 *   1. Los tres secrets de RCTA están cargados en Supabase (sólo presencia —
 *      la API de secrets devuelve un hash, nunca el valor en texto plano).
 *   2. `rcta-catalog` y `rcta-issue` están deployadas, ACTIVE, y con
 *      `verify_jwt=true` (no públicas) — tanto en vivo como en
 *      `supabase/config.toml`.
 *   3. Sin `Authorization`, `rcta-catalog` contesta 401 (la guarda de
 *      autenticación funciona) — nunca 404 (no deployada) ni 5xx (rota).
 *   4. Producción y staging NO comparten claves de Innovamed — se detecta
 *      comparando los HASHES de `RCTA_API_URL`, `RCTA_API_KEY` y
 *      `RCTA_CLIENT_APP_ID` entre los dos proyectos de Supabase. Si hashean
 *      igual, alguien copió las claves de producción a staging y ahí se
 *      prueba emitiendo recetas reales.
 *
 * **Qué NO hace este script:** no llama a `rcta-issue`, no emite ninguna
 * receta, no toca ninguna base ni ningún secret. La prueba de emisión real
 * (`rcta-certificacion.mjs`) es manual, a propósito, y hay que correrla con la
 * cabeza puesta en que cada corrida es un acto médico de verdad.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)

const ENTORNOS = {
  produccion: {
    ref: 'aixjejdoofervrkggbkd',
    url: 'https://aixjejdoofervrkggbkd.supabase.co',
  },
  staging: {
    ref: 'itjhrvlzuqvyhqtffumc',
    url: 'https://itjhrvlzuqvyhqtffumc.supabase.co',
  },
}

const SECRETS_REQUERIDOS = ['RCTA_API_URL', 'RCTA_CLIENT_APP_ID', 'RCTA_API_KEY']
const FUNCIONES_RCTA = ['rcta-catalog', 'rcta-issue']

let fallas = 0
const ok   = (m) => console.log(`   ✅ ${m}`)
const mal  = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const nota = (m) => console.log(`   ·  ${m}`)

// ── Secrets: sólo se puede verificar presencia, la API devuelve un hash ──────
function listarSecrets(ref) {
  try {
    const salida = execFileSync(
      'npx', ['supabase', 'secrets', 'list', '--project-ref', ref],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN } },
    )
    // eslint-disable-next-line no-control-regex
    const limpio = salida.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    const mapa = {}
    for (const linea of limpio.split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*\|\s*([0-9a-f]+)\s*$/)
      if (m) mapa[m[1]] = m[2]
    }
    return mapa
  } catch (err) {
    console.log(`   ❌ no se pudo correr "supabase secrets list --project-ref ${ref}": ${err.message}`)
    return null
  }
}

function reportarSecrets(nombre, mapa) {
  console.log(`\n▸ Secrets de RCTA cargados (${nombre})`)
  if (!mapa) { fallas++; return }
  for (const s of SECRETS_REQUERIDOS) {
    if (mapa[s]) ok(`${s} está cargado (sólo se verifica presencia, nunca el valor)`)
    else mal(`${s} FALTA en los secrets de ${nombre} — el circuito de recetas no puede funcionar`)
  }
}

// ── Functions: deployadas, ACTIVE, y no públicas ─────────────────────────────
async function chequearFunciones(nombre, ref) {
  console.log(`\n▸ Edge Functions de RCTA (${nombre})`)
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })
  const fns = await r.json()
  if (!Array.isArray(fns)) { mal(`no se pudo leer las functions de ${nombre}: ${JSON.stringify(fns).slice(0, 120)}`); return }

  for (const slug of FUNCIONES_RCTA) {
    const f = fns.find((x) => x.slug === slug)
    if (!f) { mal(`${slug}: no está deployada en ${nombre}`); continue }
    if (f.status !== 'ACTIVE') { mal(`${slug}: status=${f.status} (no ACTIVE) en ${nombre}`); continue }
    if (f.verify_jwt !== true) {
      mal(`${slug}: verify_jwt=${f.verify_jwt} en ${nombre} — tiene que ser true. Sin el gateway exigiendo` +
          ' sesión, cualquiera podría consultar el catálogo con nuestra cuota o, en el caso de rcta-issue,' +
          ' llegar a intentar emitir sin ser un profesional autenticado.')
    } else {
      ok(`${slug}: deployada, ACTIVE, verify_jwt=true`)
    }
  }
}

// ── config.toml: ninguna de las dos puede quedar declarada como pública ─────
function chequearConfigToml() {
  console.log('\n▸ supabase/config.toml — rcta-catalog y rcta-issue no deben ser públicas')
  const ruta = join(__dirname, '..', 'supabase', 'config.toml')
  let texto
  try {
    texto = readFileSync(ruta, 'utf8')
  } catch (err) {
    mal(`no se pudo leer ${ruta}: ${err.message}`)
    return
  }
  for (const slug of FUNCIONES_RCTA) {
    const bloque = new RegExp(`\\[functions\\.${slug}\\][^\\[]*verify_jwt\\s*=\\s*false`, 'i')
    if (bloque.test(texto)) {
      mal(`config.toml declara ${slug} con verify_jwt=false — NO puede ser pública, expondría el catálogo` +
          ' de Innovamed y/o la emisión de recetas a cualquiera sin login.')
    } else {
      ok(`config.toml no declara ${slug} como pública (default verify_jwt=true, correcto)`)
    }
  }
}

// ── La guarda de autenticación de rcta-catalog responde de verdad ──────────
// Ojo: sólo se prueba esto contra rcta-catalog. rcta-issue NUNCA se llama
// desde este script — es la que emite, y hasta un intento sin Authorization
// que el gateway corta antes de ejecutar el código queda fuera de lo que este
// chequeo debe arriesgar.
async function chequearGuardaCatalogo(nombre, url) {
  console.log(`\n▸ rcta-catalog sin Authorization (${nombre})`)
  try {
    const r = await fetch(`${url}/functions/v1/rcta-catalog?action=financiadores`)
    if (r.status === 401) {
      ok('responde 401 — está deployada y la guarda de autenticación funciona')
    } else if (r.status === 404) {
      mal(`404 — rcta-catalog no está deployada en ${nombre}`)
    } else if (r.status >= 500) {
      mal(`${r.status} — rcta-catalog está deployada pero rompe antes de llegar a chequear el auth`)
    } else {
      mal(`respondió ${r.status} en vez de 401 — revisar si la guarda de autenticación sigue activa`)
    }
  } catch (err) {
    mal(`no se pudo conectar a rcta-catalog en ${nombre}: ${err.message}`)
  }
}

// ── Producción y staging no pueden compartir claves de Innovamed ───────────
function chequearCruceAmbientes(secretosProd, secretosStaging) {
  console.log('\n═══ PRODUCCIÓN vs STAGING — no pueden compartir claves de Innovamed ═══')
  if (!secretosProd || !secretosStaging) {
    nota('no se pudo comparar — falló la lectura de secrets de alguno de los dos entornos')
    return
  }
  for (const s of SECRETS_REQUERIDOS) {
    if (!secretosProd[s] || !secretosStaging[s]) {
      nota(`${s}: no se puede comparar, falta en alguno de los dos entornos`)
      continue
    }
    if (secretosProd[s] === secretosStaging[s]) {
      mal(`${s} hashea IGUAL en producción y en staging — probablemente se copiaron las claves de` +
          ' producción a staging. Con esto, cualquier prueba en staging emite una receta REAL contra' +
          ' Innovamed. Separar las claves ya.')
    } else {
      ok(`${s} es distinto entre producción y staging`)
    }
  }
}

const pedido = process.argv[2]

// Los secrets de los DOS entornos se leen siempre, aunque se pida uno solo:
// el chequeo #4 (cruce de ambientes) los necesita a ambos para tener sentido.
const secretosPorEntorno = {}
for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  secretosPorEntorno[nombre] = listarSecrets(cfg.ref)
}

for (const [nombre, cfg] of Object.entries(ENTORNOS)) {
  if (pedido && pedido !== nombre) continue
  console.log(`\n═══ ${nombre.toUpperCase()} ═══`)
  reportarSecrets(nombre, secretosPorEntorno[nombre])
  await chequearFunciones(nombre, cfg.ref)
  await chequearGuardaCatalogo(nombre, cfg.url)
}

chequearConfigToml()
chequearCruceAmbientes(secretosPorEntorno.produccion, secretosPorEntorno.staging)

console.log('\n· Este script no emitió ninguna receta: es sólo lectura. La prueba de' +
  ' emisión real es manual y deliberada (rcta-certificacion.mjs) — nunca corre sola desde un chequeo automático.')

console.log(fallas === 0
  ? '\n✅ El circuito de receta electrónica está sano.\n'
  : `\n❌ ${fallas} problema(s) en el circuito de receta electrónica. NO cerrar la tarea sin resolverlos.\n`)
process.exit(fallas === 0 ? 0 : 1)
