// ── dni-completado — un profesional verificado completó un DNI que faltaba ────
// Migración 225 (decisión de Mateo, 2026-11-02). La dispara la base
// (`marcar_reverificacion_por_identidad` → `llamar_edge_function`) con
// `{ chequeoId }`. Consulta REFEPS (SISA) por ese DNI con el mismo código y el
// mismo criterio que `sisa-verify` (`_shared/refeps.ts`) y deja el resultado
// con `resolver_chequeo_dni`:
//   · coincide       → la matrícula declarada figura habilitada: sigue verificado.
//   · no_coincide    → no está en REFEPS, la matrícula no figura o no está
//                      habilitada: va a revisión.
//   · sin_respuesta  → el bus falló o no está configurado: va a revisión.
// Esta función NUNCA pone is_verified en true ni lo baja por su cuenta: eso
// lo hace `resolver_chequeo_dni` y sólo hacia revisión.
//
// Sólo la llama el servidor (service key) o un admin (para reintentar).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CORS, json, quienLlama } from '../_shared/msalBus.ts'
import { RefepsError, buscarPractitioner, codigoRefeps, evaluarRefeps } from '../_shared/refeps.ts'
import { veredictoDni } from './veredicto.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const quien = await quienLlama(db, req)
    if (!quien) return json({ error: 'No autorizado' }, 403)

    const { chequeoId } = await req.json().catch(() => ({}))
    if (typeof chequeoId !== 'string') return json({ error: 'chequeoId requerido' }, 400)

    const { data: c, error } = await db
      .from('dni_completado_chequeos')
      .select('id, resultado, dni, professional:professional_profiles!professional_profile_id(id, license_type, license_number)')
      .eq('id', chequeoId)
      .maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!c) return json({ error: 'Chequeo no encontrado' }, 404)
    if (c.resultado !== 'pendiente') return json({ resultado: c.resultado, yaResuelto: true })

    // deno-lint-ignore no-explicit-any
    const pp: any = Array.isArray(c.professional) ? c.professional[0] : c.professional
    const dni = String(c.dni).replace(/\D/g, '')
    const codigo = codigoRefeps(dni)

    let v: ReturnType<typeof veredictoDni>
    // deno-lint-ignore no-explicit-any
    let refeps: Record<string, any> = { codigo_profesional: codigo, dni, matricula_declarada: pp?.license_number ?? null }
    if (dni.length < 7 || dni.length > 8) {
      v = { resultado: 'no_coincide', detalle: `DNI con formato inválido (${c.dni}).` }
    } else {
      try {
        const practitioner = await buscarPractitioner(codigo)
        const ev = evaluarRefeps(practitioner, pp?.license_number)
        v = veredictoDni(ev.estado, pp?.license_number)
        refeps = {
          ...refeps,
          estado: ev.estado,
          encontrado: !!practitioner,
          nombre: practitioner?.name?.[0]?.text ?? null,
          matriculas: ev.matriculas,
        }
      } catch (e) {
        if (!(e instanceof RefepsError)) throw e
        console.error('dni-completado REFEPS', e.code, e.httpStatus, JSON.stringify(e.detail))
        v = { resultado: 'sin_respuesta', detalle: `SISA no respondió: ${e.message}` }
        refeps = { ...refeps, error: e.code }
      }
    }

    const { data: aplicado, error: rpcErr } = await db.rpc('resolver_chequeo_dni', {
      p_id: chequeoId, p_resultado: v.resultado, p_detalle: v.detalle, p_refeps: refeps,
    })
    if (rpcErr) return json({ error: `No se pudo guardar el resultado: ${rpcErr.message}` }, 500)
    return json({ resultado: aplicado, detalle: v.detalle })
  } catch (err) {
    console.error('dni-completado error:', err)
    return json({ error: 'Error interno', detail: String(err) }, 500)
  }
})
