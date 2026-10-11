// ── Paciente → Federador Nacional del Ministerio de Salud ────────────────────
// Busca al paciente en el Federador (DNI + sexo + fecha de nacimiento) y guarda
// su id nacional en `profiles.federador_id`. Si no está y el modo lo permite,
// lo da de alta. Migración 196.
//
// Lo dispara la base (trigger `profiles_federar` + pg_net, y el cron de
// reintentos). El paciente no ve nada: si el bus falla, queda `error` con un
// reintento programado y el registro siguió igual.
//
// Request (sólo service role o admin/super admin):
//   { profileId }        — un paciente
//   { lote: n }          — hasta n pendientes/errores vencidos (cron, backfill)
//
// Modo (secret MSAL_FEDERADOR_MODO):
//   buscar  (default) — sólo busca y vincula. Nunca escribe en el Federador.
//   federar           — además da de alta a los que no están (nunca a cuentas
//                       de prueba). 🔴 El Federador es el registro nacional REAL
//                       (el de QA no responde): dar de alta datos de staging lo
//                       ensucia. Prenderlo es decisión de Mateo.
//
// Privacidad: sólo identidad. Nada clínico sale de Healthier por acá.
//
// Prueba de "bus caído": un paciente de prueba (es_prueba) cuyo mail tenga
// `+simular-bus-caido` se procesa como si el bus no respondiera. Lo usa
// scripts/verificar-federador.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  busFhir, BusError, credencialBus, diagnostico, quienLlama, proximoIntento,
  MAX_INTENTOS, CORS, json,
} from '../_shared/msalBus.ts'

const FED = '/masterfile-federacion-service/fhir/Patient'
const SYS_DNI = 'http://www.renaper.gob.ar/dni'
const SYS_FED = 'https://federador.msal.gob.ar/patient-id'
const EXT_PATERNO = 'http://hl7.org/fhir/StructureDefinition/humanname-fathers-family'

type Perfil = {
  id: string; role: string; email: string | null; dni: string | null; gender: string | null
  birth_date: string | null; first_name: string | null; last_name: string | null; full_name: string | null
  es_prueba: boolean | null; deleted_at: string | null; federador_intentos: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const quien = await quienLlama(db, req)
  if (!quien) return json({ error: 'Sólo Healthier puede consultar el Federador' }, 403)

  let body: { profileId?: string; lote?: number } = {}
  try { body = await req.json() } catch { /* vacío */ }

  const cred = credencialBus()
  const modo = (Deno.env.get('MSAL_FEDERADOR_MODO') || 'buscar').toLowerCase()

  let ids: string[] = []
  if (body.profileId) ids = [body.profileId]
  else {
    const n = Math.min(Math.max(Number(body.lote) || 20, 1), 50)
    const { data } = await db.from('profiles').select('id')
      .in('federador_estado', ['pendiente', 'error'])
      .lt('federador_intentos', MAX_INTENTOS)
      .or(`federador_proximo_intento.is.null,federador_proximo_intento.lte.${new Date().toISOString()}`)
      .order('federador_proximo_intento', { ascending: true, nullsFirst: true })
      .limit(n)
    ids = (data ?? []).map((r: { id: string }) => r.id)
  }

  const resultados = []
  for (const [i, id] of ids.entries()) {
    if (i > 0) await new Promise(r => setTimeout(r, 400)) // de a uno, sin ráfagas al bus
    resultados.push(await procesar(db, id, cred, modo))
  }
  return json({ modo, procesados: resultados.length, resultados })
})

async function procesar(db: any, id: string, cred: ReturnType<typeof credencialBus>, modo: string) {
  const { data: p } = await db.from('profiles')
    .select('id, role, email, dni, gender, birth_date, first_name, last_name, full_name, es_prueba, deleted_at, federador_intentos')
    .eq('id', id).maybeSingle() as { data: Perfil | null }
  if (!p) return { id, estado: 'no_existe' }

  const guardar = (campos: Record<string, unknown>) =>
    db.from('profiles').update({ federador_actualizado_at: new Date().toISOString(), ...campos }).eq('id', id)
      .then(({ error }: { error: any }) => { if (error) console.error('federador: guardar', id, error.message) })

  const dni = String(p.dni ?? '').replace(/\D/g, '').replace(/^0+/, '')
  const genero = generoFhir(p.gender)
  const { nombres, apellido } = partirNombre(p)
  if (p.role !== 'patient' || p.deleted_at || dni.length < 7 || dni.length > 8 || !genero || !p.birth_date || !apellido) {
    await guardar({ federador_estado: 'sin_datos', federador_error: null, federador_proximo_intento: null })
    return { id, estado: 'sin_datos' }
  }

  try {
    if (!cred) throw new BusError('BUS_NO_CONFIGURADO', 'Faltan MSAL_FHIR_ISSUER / MSAL_FHIR_SECRET')
    if (p.es_prueba && /\+simular-bus-caido/i.test(p.email ?? '')) {
      throw new BusError('BUS_RED', 'Sin respuesta del bus (simulado para la prueba de bus caído)')
    }

    // ── 1 · ¿Ya está? ─────────────────────────────────────────────────────────
    const q = new URLSearchParams({ identifier: `${SYS_DNI}|${dni}`, birthdate: p.birth_date })
    if (genero !== 'other') q.set('gender', genero)
    const r = await busFhir(cred, 'Patient/*.read', `${FED}?${q}`)
    if (r.status !== 200 || r.body?.resourceType !== 'Bundle') {
      throw new BusError('FEDERADOR_BUSQUEDA', `El Federador respondió ${r.status}: ${diagnostico(r)}`, r.status)
    }
    const candidatos = (r.body.entry ?? []).map((e: any) => e.resource)
      .filter((pt: any) => pt?.resourceType === 'Patient' && pt.active !== false)
      .filter((pt: any) => pt.identifier?.some((i: any) => i.system === SYS_DNI && String(i.value).replace(/^0+/, '') === dni))
      .filter((pt: any) => pt.birthDate === p.birth_date)

    let elegido = candidatos.length === 1 ? candidatos[0] : null
    if (candidatos.length > 1) {
      const conApellido = candidatos.filter((pt: any) => mismoApellido(pt, apellido))
      if (conApellido.length === 1) elegido = conApellido[0]
      else {
        await guardar({
          federador_estado: 'no_encontrado', federador_proximo_intento: null,
          federador_error: `Varios pacientes del Federador coinciden (${candidatos.length}); no se vinculó ninguno`,
        })
        return { id, estado: 'no_encontrado', motivo: 'ambiguo', candidatos: candidatos.length }
      }
    }

    if (elegido) {
      const fid = idFederador(elegido)
      await guardar({ federador_id: fid, federador_estado: 'vinculado', federador_error: null, federador_proximo_intento: null, federador_intentos: 0 })
      return { id, estado: 'vinculado', federadorId: fid }
    }

    // ── 2 · No está ───────────────────────────────────────────────────────────
    if (modo !== 'federar' || p.es_prueba) {
      await guardar({ federador_estado: 'no_encontrado', federador_error: null, federador_proximo_intento: null, federador_intentos: 0 })
      return { id, estado: 'no_encontrado', motivo: p.es_prueba ? 'cuenta_de_prueba' : 'modo_buscar' }
    }

    const alta = {
      resourceType: 'Patient',
      identifier: [
        { use: 'usual', system: cred.issuer, value: p.id },
        { use: 'official', system: SYS_DNI, value: dni },
      ],
      active: true,
      name: [{
        use: 'official',
        text: `${nombres.join(' ')} ${apellido}`.trim(),
        family: apellido,
        _family: { extension: [{ url: EXT_PATERNO, valueString: apellido.split(/\s+/)[0] }] },
        given: nombres.length ? nombres : [apellido],
      }],
      gender: genero,
      birthDate: p.birth_date,
    }
    const w = await busFhir(cred, 'Patient/*.write', `${FED}/`, { body: alta })
    if (w.status !== 200 && w.status !== 201) {
      throw new BusError('FEDERADOR_ALTA', `El Federador rechazó el alta (${w.status}): ${diagnostico(w)}`, w.status)
    }
    // La guía no documenta el cuerpo del 201: el id sale del Location, del
    // cuerpo, o se busca por nuestro propio identificador.
    let fid: string | null = w.headers.get('location')?.match(/Patient\/([^/?]+)/)?.[1] ?? w.body?.id ?? null
    if (!fid) {
      const b = await busFhir(cred, 'Patient/*.read', `${FED}?${new URLSearchParams({ identifier: `${cred.issuer}|${p.id}` })}`)
      fid = b.body?.entry?.[0]?.resource ? idFederador(b.body.entry[0].resource) : null
    }
    await guardar({
      federador_id: fid, federador_estado: 'federado', federador_proximo_intento: null, federador_intentos: 0,
      federador_error: fid ? null : 'Alta aceptada pero el Federador no devolvió el id',
    })
    return { id, estado: 'federado', federadorId: fid }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof BusError ? e.code : 'ERROR'
    console.error('federador', id, code, msg)
    const intentos = (p.federador_intentos ?? 0) + 1
    await guardar({
      federador_estado: 'error',
      federador_intentos: intentos,
      federador_error: `${code}: ${msg}`.slice(0, 500),
      federador_proximo_intento: intentos >= MAX_INTENTOS ? null : proximoIntento(intentos),
    })
    return { id, estado: 'error', code, error: msg }
  }
}

function generoFhir(g: string | null) {
  const v = String(g ?? '').toLowerCase()
  if (v.startsWith('masc') || v === 'male' || v === 'm') return 'male'
  if (v.startsWith('fem') || v === 'female' || v === 'f') return 'female'
  return v ? 'other' : null
}

function partirNombre(p: Perfil) {
  const apellido = (p.last_name ?? '').trim()
  const nombre = (p.first_name ?? '').trim()
  if (apellido) return { apellido, nombres: nombre ? nombre.split(/\s+/) : [] }
  // Perfiles viejos sólo con full_name: la última palabra como apellido.
  const partes = (p.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  return { apellido: partes.length > 1 ? partes[partes.length - 1] : (partes[0] ?? ''), nombres: partes.slice(0, -1) }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

function mismoApellido(pt: any, apellido: string) {
  const a = norm(apellido)
  return (pt.name ?? []).some((n: any) => {
    const fam = norm(String(n.family ?? ''))
    const pat = (n._family?.extension ?? []).map((x: any) => norm(String(x.valueString ?? '')))
    return fam === a || fam.split(/\s+/).includes(a.split(/\s+/)[0]) || pat.includes(a.split(/\s+/)[0])
  })
}

function idFederador(pt: any): string | null {
  return pt.identifier?.find((i: any) => i.system === SYS_FED)?.value ?? pt.id ?? null
}
