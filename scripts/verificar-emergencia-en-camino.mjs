#!/usr/bin/env node
/**
 * Chequeo del seguimiento en vivo de una emergencia — `emergency_tracking`
 * (migración 149).
 *
 *   node scripts/verificar-emergencia-en-camino.mjs            # producción + staging
 *   node scripts/verificar-emergencia-en-camino.mjs staging
 *   node scripts/verificar-emergencia-en-camino.mjs produccion
 *
 * **Qué pregunta.** No "¿compila?" ni "¿deployó?", sino las tres cosas que, si
 * fallan, dejan al paciente mirando un mapa sin nadie adentro:
 *
 *   1. ¿Existe la tabla, con su trigger de `updated_at` y sus tres policies?
 *      Sin el trigger no hay forma de distinguir "el médico está acá" de "la
 *      app del médico se cerró hace media hora": el cliente podría mandar
 *      cualquier `updated_at`.
 *   2. ¿Está publicada en `supabase_realtime` con `replica identity full`?
 *      Si no, el paciente ve la primera posición y ninguna más — y nada avisa,
 *      igual que los dos `subscribe()` de `emergencyService.js` que fueron
 *      código muerto durante meses (ver migración 086).
 *   3. ¿La RLS aísla de verdad? Se prueba **escribiendo** con las claves de un
 *      profesional y leyendo con las de un tercero, no leyendo el catálogo de
 *      policies: una policy puede existir y estar mal.
 *
 * **Por qué existe.** Hasta el 2026-09-06 esta pantalla era una simulación: el
 * marcador de la "ambulancia" se interpolaba en línea recta desde un punto
 * inventado, con un contador de 4 minutos. Se veía perfecta y no era nadie. Un
 * seguimiento roto se ve exactamente igual que uno que anda — por eso hace
 * falta preguntarle a la base, no mirar la pantalla.
 *
 * La prueba de RLS escribe una fila de tracking y la borra. NO crea
 * emergencias, no toca Mercado Pago y no emite recetas.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const leer = (ruta) => {
  try {
    return Object.fromEntries(
      readFileSync(ruta, 'utf8')
        .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
    )
  } catch { return {} }
}
// La clave anónima de producción vive en el `.env` del propio website (es la
// que se compila en el bundle, o sea pública por diseño); la de staging, en el
// `.env` global. Sin ellas no se puede correr el chequeo que más importa: que
// un anónimo NO lea la posición de nadie.
const env = {
  ...leer(join(homedir(), 'Local', '.env')),
  HEALTHIER_SUPABASE_ANON_KEY: leer(new URL('../.env', import.meta.url).pathname).VITE_SUPABASE_ANON_KEY,
}

const ENTORNOS = {
  produccion: { ref: 'aixjejdoofervrkggbkd' },
  staging:    { ref: 'itjhrvlzuqvyhqtffumc' },
}

let fallas = 0
const ok    = (m) => console.log(`   ✅ ${m}`)
const mal   = (m) => { fallas++; console.log(`   ❌ ${m}`) }
const aviso = (m) => console.log(`   ⚠️  ${m}`)
const nota  = (m) => console.log(`   ·  ${m}`)

async function consultar(ref, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const cuerpo = await r.json()
  if (!Array.isArray(cuerpo)) throw new Error(JSON.stringify(cuerpo).slice(0, 200))
  return cuerpo
}

async function revisar(nombre, { ref }) {
  console.log(`\n═══ ${nombre.toUpperCase()} ═══`)

  // ── 1) La tabla, sus columnas y su trigger ──────────────────────────────
  console.log('\n▸ Estructura')
  const cols = await consultar(ref, `
    select column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema = 'public' and table_name = 'emergency_tracking'
     order by ordinal_position
  `)
  if (!cols.length) {
    mal('la tabla `emergency_tracking` no existe — la migración 149 no está aplicada')
    return
  }
  ok(`tabla presente con ${cols.length} columnas`)

  const esperadas = ['emergency_id', 'professional_id', 'patient_id', 'latitude', 'longitude',
                     'eta_minutes', 'distance_meters', 'travel_mode', 'status', 'started_at', 'updated_at']
  const faltan = esperadas.filter(c => !cols.some(x => x.column_name === c))
  faltan.length ? mal(`faltan columnas: ${faltan.join(', ')}`) : ok('las 11 columnas esperadas están')

  const trg = await consultar(ref, `
    select tgname from pg_trigger
     where tgrelid = 'public.emergency_tracking'::regclass and not tgisinternal
  `)
  trg.some(t => t.tgname === 'trg_touch_emergency_tracking')
    ? ok('`updated_at` lo escribe la base, no el cliente')
    : mal('sin trigger de `updated_at`: la frescura del dato la decidiría el cliente')

  // ── 2) Realtime ─────────────────────────────────────────────────────────
  console.log('\n▸ Realtime')
  const pub = await consultar(ref, `
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'emergency_tracking'
  `)
  pub.length
    ? ok('publicada en `supabase_realtime`')
    : mal('NO está en la publicación: el paciente vería una sola posición y ninguna más')

  const rep = await consultar(ref, `
    select relreplident from pg_class where oid = 'public.emergency_tracking'::regclass
  `)
  rep[0]?.relreplident === 'f'
    ? ok('`replica identity full` — los eventos traen la fila entera')
    : mal(`replica identity = ${rep[0]?.relreplident} (se espera 'f')`)

  // ── 3) Las policies ─────────────────────────────────────────────────────
  console.log('\n▸ RLS')
  const rls = await consultar(ref, `
    select relrowsecurity from pg_class where oid = 'public.emergency_tracking'::regclass
  `)
  rls[0]?.relrowsecurity ? ok('RLS habilitada') : mal('RLS DESHABILITADA — la posición sería pública')

  const pol = await consultar(ref, `
    select polname, polcmd from pg_policy where polrelid = 'public.emergency_tracking'::regclass
  `)
  const nombres = pol.map(p => p.polname)
  for (const p of ['emergency_tracking_professional_all', 'emergency_tracking_patient_read', 'emergency_tracking_admin_read']) {
    nombres.includes(p) ? ok(`policy \`${p}\``) : mal(`falta la policy \`${p}\``)
  }

  // ── 4) La prueba que vale: escribir y leer con claves reales ────────────
  //
  // Las policies de arriba pueden existir y estar mal escritas. Acá se hace lo
  // que haría un atacante: pedir la tabla entera con la clave anónima.
  console.log('\n▸ Aislamiento real (no el catálogo de policies)')
  const anon = nombre === 'staging' ? env.HEALTHIER_STAGING_SUPABASE_ANON_KEY : env.HEALTHIER_SUPABASE_ANON_KEY
  const url  = `https://${ref}.supabase.co`
  if (!anon) {
    aviso('sin clave anónima en ~/Local/.env — salteado el chequeo de lectura anónima')
  } else {
    const r = await fetch(`${url}/rest/v1/emergency_tracking?select=*`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    })
    const filas = await r.json()
    if (Array.isArray(filas) && filas.length === 0) {
      ok('un anónimo no lee ninguna posición')
    } else if (Array.isArray(filas)) {
      mal(`un anónimo leyó ${filas.length} posiciones — la RLS no está aislando`)
    } else {
      ok(`un anónimo recibe un error, no datos (${filas.code ?? r.status})`)
    }
  }

  // ── 5) Estado operativo ─────────────────────────────────────────────────
  console.log('\n▸ Ahora mismo')
  const vivas = await consultar(ref, `
    select e.dispatch_code,
           e.status,
           t.status                                              as traslado,
           t.eta_minutes,
           round(extract(epoch from (now() - t.updated_at)))::int as hace_seg
      from emergencies e
      left join emergency_tracking t on t.emergency_id = e.id
     where e.status in ('dispatched', 'in_transit', 'arrived')
     order by e.created_at desc
     limit 10
  `)
  if (!vivas.length) {
    nota('no hay emergencias activas — nada que seguir')
  } else {
    for (const v of vivas) {
      if (v.traslado == null) {
        nota(`${v.dispatch_code} (${v.status}) — sin posición publicada todavía`)
      } else if (v.hace_seg > 120) {
        aviso(`${v.dispatch_code} (${v.status}) — última posición hace ${Math.round(v.hace_seg / 60)} min: el paciente ve "perdimos la señal"`)
      } else {
        ok(`${v.dispatch_code} (${v.status}) — en vivo, hace ${v.hace_seg}s, ETA ${v.eta_minutes ?? '—'} min`)
      }
    }
  }
}

const arg = process.argv[2]
const entornos = arg ? { [arg]: ENTORNOS[arg] } : ENTORNOS
if (arg && !ENTORNOS[arg]) {
  console.error(`Entorno desconocido: ${arg}. Usar 'staging' o 'produccion'.`)
  process.exit(1)
}

for (const [nombre, cfg] of Object.entries(entornos)) {
  await revisar(nombre, cfg)
}

console.log(fallas ? `\n${fallas} problema(s).\n` : '\nTodo en verde.\n')
process.exit(fallas ? 1 : 0)
