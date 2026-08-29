#!/usr/bin/env node
/**
 * Punto de entrada único post-deploy a producción (o staging).
 *
 *   node scripts/verificar-produccion.mjs                 # producción, con alta de cuenta
 *   node scripts/verificar-produccion.mjs staging          # staging
 *   node scripts/verificar-produccion.mjs produccion --sin-alta  # sin crear cuenta
 *
 * Corre, en orden, y da UN veredicto único al final:
 *   1. `scripts/verificar-pagos.mjs`   — circuito de Mercado Pago (solo lectura)
 *   2. `scripts/verificar-recetas.mjs` — circuito de receta electrónica (solo lectura)
 *   3. `npm run test:e2e:deploy`       — alta de cuenta real de punta a punta
 *
 * **Qué NO corre, y por qué:** nunca invoca `scripts/rcta-certificacion.mjs` ni
 * ninguna otra ruta que emita una receta real. Desde el 2026-08-28 producción
 * emite recetas legalmente válidas con las claves reales de Innovamed —
 * automatizar la emisión post-deploy significaría emitir una receta real cada
 * vez que alguien deployara. El chequeo de recetas de este runner (paso 2) es
 * de solo lectura a propósito; emitir sigue siendo un acto manual y deliberado.
 *
 * **`--sin-alta`:** salta el paso 3. Usarlo cuando no se quiere crear una
 * cuenta descartable. Sin esta bandera, contra PRODUCCIÓN el test de alta de
 * cuenta crea y borra un usuario real en la base de producción (una cuenta de
 * prueba, pensada para ser descartable — no un dato de un paciente real).
 *
 * Exit code: 0 si los tres pasos (o los dos, con --sin-alta) salieron bien;
 * distinto de 0 si cualquiera falló.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RAIZ_WEBSITE = join(__dirname, '..')

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])
)

// 🔴 Los nombres de estas variables tienen que ser EXACTAMENTE los que lee el
// test (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
// `SUPABASE_SERVICE_ROLE_KEY`). `playwright.config.js` completa con `??=` lo que
// falte desde `.env.test`, **que apunta a producción** — así que una variable
// mal nombrada no rompe: silenciosamente hace que el test cree el usuario en un
// entorno y lo busque en el otro. Pasó, y dejó cuentas colgadas en staging.
const ENTORNOS = {
  produccion: {
    e2eBaseUrl: 'https://gethealthier.vercel.app',
    supabaseUrl: 'https://aixjejdoofervrkggbkd.supabase.co',
    supabaseAnonKey: env.HEALTHIER_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: env.HEALTHIER_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  staging: {
    e2eBaseUrl: 'https://gethealthier-staging.vercel.app',
    supabaseUrl: env.HEALTHIER_STAGING_SUPABASE_URL ?? '',
    supabaseAnonKey: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
}

const args = process.argv.slice(2)
const sinAlta = args.includes('--sin-alta')
const pedido = args.find((a) => !a.startsWith('--')) ?? 'produccion'

if (!ENTORNOS[pedido]) {
  console.log(`❌ Entorno "${pedido}" desconocido. Usar "produccion" o "staging".`)
  process.exit(1)
}
const entorno = ENTORNOS[pedido]

console.log(`\n╔══════════════════════════════════════════════════════════════╗`)
console.log(`║  VERIFICACIÓN POST-DEPLOY — ${pedido.toUpperCase().padEnd(35)}║`)
console.log(`╚══════════════════════════════════════════════════════════════╝`)

const resumen = []

function correrPaso(titulo, fn) {
  console.log(`\n\n──────────────────────────────────────────────────────────────`)
  console.log(`▶ ${titulo}`)
  console.log(`──────────────────────────────────────────────────────────────`)
  const resultado = fn()
  resumen.push({ titulo, ...resultado })
  return resultado
}

// ── 1) Pagos ──────────────────────────────────────────────────────────────
correrPaso('1/3 · Circuito de pagos (verificar-pagos.mjs)', () => {
  const r = spawnSync('node', ['scripts/verificar-pagos.mjs', pedido], {
    cwd: RAIZ_WEBSITE, stdio: 'inherit',
  })
  if (r.error) return { ok: false, detalle: `no se pudo ejecutar: ${r.error.message}` }
  return { ok: r.status === 0, detalle: r.status === 0 ? 'ok' : `exit ${r.status}` }
})

// ── 2) Recetas ────────────────────────────────────────────────────────────
correrPaso('2/3 · Circuito de receta electrónica (verificar-recetas.mjs, solo lectura)', () => {
  const r = spawnSync('node', ['scripts/verificar-recetas.mjs', pedido], {
    cwd: RAIZ_WEBSITE, stdio: 'inherit',
  })
  if (r.error) return { ok: false, detalle: `no se pudo ejecutar: ${r.error.message}` }
  return { ok: r.status === 0, detalle: r.status === 0 ? 'ok' : `exit ${r.status}` }
})

// ── 3) Alta de cuenta E2E ────────────────────────────────────────────────
if (sinAlta) {
  correrPaso('3/3 · Alta de cuenta E2E — SALTEADO (--sin-alta)', () => {
    console.log('   ·  Salteado a pedido (--sin-alta). No se creó ninguna cuenta.')
    return { ok: true, detalle: 'salteado' }
  })
} else {
  correrPaso('3/3 · Alta de cuenta E2E (npm run test:e2e:deploy)', () => {
    if (pedido === 'produccion') {
      console.log('   ⚠️  Esto crea y borra una cuenta descartable en la base de PRODUCCIÓN.')
    }
    // Chequeo previo: ¿existe el script npm? Si otro agente todavía no lo
    // agregó a package.json, hay que decirlo con claridad — nunca reventar
    // con un stack trace de "Missing script".
    let scripts
    try {
      scripts = JSON.parse(readFileSync(join(RAIZ_WEBSITE, 'package.json'), 'utf8')).scripts ?? {}
    } catch (err) {
      return { ok: false, detalle: `no se pudo leer package.json: ${err.message}` }
    }
    if (!scripts['test:e2e:deploy']) {
      console.log('   ·  El script "test:e2e:deploy" todavía no existe en package.json.')
      return { ok: false, detalle: 'no disponible todavía (falta el script npm)' }
    }
    const r = spawnSync('npm', ['run', 'test:e2e:deploy'], {
      cwd: RAIZ_WEBSITE, stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BASE_URL: entorno.e2eBaseUrl,
        VITE_SUPABASE_URL: entorno.supabaseUrl,
        VITE_SUPABASE_ANON_KEY: entorno.supabaseAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: entorno.serviceRoleKey,
      },
    })
    if (r.error) return { ok: false, detalle: `no se pudo ejecutar: ${r.error.message}` }
    return { ok: r.status === 0, detalle: r.status === 0 ? 'ok' : `exit ${r.status}` }
  })
}

// ── Veredicto único ──────────────────────────────────────────────────────
console.log(`\n\n╔══════════════════════════════════════════════════════════════╗`)
console.log(`║  RESUMEN — ${pedido.toUpperCase().padEnd(53)}║`)
console.log(`╚══════════════════════════════════════════════════════════════╝\n`)

let huboFallas = false
for (const { titulo, ok, detalle } of resumen) {
  const icono = ok ? '✅' : '❌'
  if (!ok) huboFallas = true
  console.log(`${icono} ${titulo} — ${detalle}`)
}

console.log(huboFallas
  ? '\n❌ VEREDICTO: hay problemas. No dar el deploy por verificado hasta resolverlos.\n'
  : '\n✅ VEREDICTO: el deploy está verificado.\n')

process.exit(huboFallas ? 1 : 0)
