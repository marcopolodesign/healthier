// ── operador-sisa — chequeo con SISA (REFEPS) del DNI del operador del día ───
// Migración 241. Lo dispara la base (`registrar_operador_del_dia` →
// `llamar_edge_function`) con `{ registroId }`. Consulta REFEPS por DNI (mismo
// código y criterio que sisa-verify / dni-completado, `_shared/refeps.ts`) y deja
// el resultado con `resolver_sisa_operador`. NUNCA frena nada: sólo informa al
// despacho y, si hay un médico habilitado, habilita la carga de medicación.
//   habilitado     — alguna matrícula figura habilitada (sisa_es_medico dice si es médico/a)
//   suspendido     — figura pero ninguna matrícula habilitada
//   no_encontrado  — el DNI no está en REFEPS
//   sin_respuesta  — el bus falló / no está configurado
// Sólo la llama el servidor (service key) o un admin (reintentar).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CORS, json, quienLlama } from '../_shared/msalBus.ts'
import { RefepsError, buscarPractitioner, codigoRefeps, leerMatriculas } from '../_shared/refeps.ts'

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const quien = await quienLlama(db, req)
    if (!quien) return json({ error: 'No autorizado' }, 403)

    const { registroId } = await req.json().catch(() => ({}))
    if (typeof registroId !== 'string') return json({ error: 'registroId requerido' }, 400)

    const { data: r, error } = await db.from('operadores_del_dia').select('id, dni').eq('id', registroId).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!r) return json({ error: 'Registro no encontrado' }, 404)

    const dni = String(r.dni).replace(/\D/g, '')
    const codigo = codigoRefeps(dni)
    let estado = 'sin_respuesta'
    let esMedico = false
    let profesion: string | null = null
    let matricula: string | null = null
    let nombre: string | null = null
    // deno-lint-ignore no-explicit-any
    let detalle: Record<string, any> = { codigo_profesional: codigo, dni }
    try {
      const practitioner = await buscarPractitioner(codigo)
      if (!practitioner) {
        estado = 'no_encontrado'
      } else {
        const mats = leerMatriculas(practitioner)
        nombre = practitioner?.name?.[0]?.text ?? null
        const hab = practitioner.active !== false ? mats.filter(m => m.habilitada) : []
        const elegida = hab.find(m => /medic/.test(sinTildes(m.profesion ?? ''))) ?? hab[0] ?? null
        estado = elegida ? 'habilitado' : 'suspendido'
        esMedico = !!elegida && /medic/.test(sinTildes(elegida.profesion ?? ''))
        profesion = (elegida ?? mats[0])?.profesion ?? null
        matricula = (elegida ?? mats[0])?.matricula ?? null
        detalle = { ...detalle, matriculas: mats }
      }
    } catch (e) {
      if (!(e instanceof RefepsError)) throw e
      console.error('operador-sisa REFEPS', e.code, e.httpStatus, JSON.stringify(e.detail))
      detalle = { ...detalle, error: e.code }
    }

    const { error: rpcErr } = await db.rpc('resolver_sisa_operador', {
      p_id: registroId, p_estado: estado, p_es_medico: esMedico, p_profesion: profesion,
      p_matricula: matricula, p_nombre: nombre, p_detalle: detalle,
    })
    if (rpcErr) return json({ error: `No se pudo guardar el resultado: ${rpcErr.message}` }, 500)
    return json({ estado, esMedico })
  } catch (err) {
    console.error('operador-sisa error:', err)
    return json({ error: 'Error interno', detail: String(err) }, 500)
  }
})
