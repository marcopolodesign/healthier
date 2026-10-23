// ── RCTA Anular — anula una receta electrónica emitida, con sus posdatadas ────
// Decisión de Mateo (2026-10-22, "se anulan y sí avisamos"): si el médico anula
// la receta de hoy (la original), se anulan también sus posdatadas que todavía
// no empezaron. Las que ya empezaron quedan como están.
//
// Request body:
//   medicationId – UUID de una fila de clinical_medications de la receta ORIGINAL
//                  (cualquiera de sus medicamentos: se anula la receta entera)
//   motivo       – opcional, queda en `stop_reason` (historia clínica)
//
// Orden, a propósito:
//   1. Primero se marca en NUESTRA base (status 'cancelled', rcta_status
//      'anulada', anulación "sin confirmar"). Desde ese momento la farmacia de
//      Healthier no la vende y el paciente deja de verla. Si se hiciera al
//      revés y la escritura fallara, quedaría anulada en el servicio pero a la
//      venta en la farmacia.
//   2. Después, una llamada por receta al servicio de recetas:
//      DELETE /apirecipe/Receta/{hash} con { clienteAppId }. El hash es el
//      campo `id` de la respuesta de la emisión (`rcta_hash`), NO el idReceta.
//   3. Cada resultado queda en la fila (`rcta_anulacion_estado`) y en
//      `rcta_issue_log` (super admin → Auditoría → Recetas electrónicas).
//
// Si el servicio no confirma, la receta igual queda anulada en Healthier y el
// panel ofrece "Reintentar": llamar de nuevo con el mismo medicationId reintenta
// sólo las que quedaron en error.
//
// Sólo la anula el profesional que la emitió (mismo criterio que rcta-issue).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TZ_OFFSET_MS = 3 * 3600 * 1000 // Argentina, sin horario de verano

type Fila = {
  id: string
  patient_id: string
  professional_id: string
  encounter_id: string | null
  status: string
  rcta_status: string | null
  posdatada_de: string | null
  vigencia_desde: string | null
  rcta_prescription_id: string | null
  rcta_hash: string | null
  rcta_transaction_id: string | null
  rcta_anulacion_estado: string | null
  medication_name: string | null
}

const COLUMNAS = 'id, patient_id, professional_id, encounter_id, status, rcta_status, posdatada_de, vigencia_desde, rcta_prescription_id, rcta_hash, rcta_transaction_id, rcta_anulacion_estado, medication_name'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => ({}))
    const medicationId = typeof body.medicationId === 'string' ? body.medicationId : null
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 500) || null : null
    if (!medicationId) return json({ error: 'medicationId requerido' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Quién llama ──────────────────────────────────────────────────────────
    // verify_jwt = true (default): el gateway ya validó la firma. Se acepta la
    // service key (scripts de control) o la sesión del profesional que emitió.
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const rol = (() => {
      try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return null }
    })()
    let quienId: string | null = null
    if (rol !== 'service_role') {
      const { data: { user } } = await supabase.auth.getUser(jwt)
      if (!user) return json({ error: 'Sesión inválida' }, 401)
      quienId = user.id
    }

    // ── La receta original ──────────────────────────────────────────────────
    const { data: fila, error: filaErr } = await supabase
      .from('clinical_medications').select(COLUMNAS).eq('id', medicationId).maybeSingle<Fila>()
    if (filaErr) return json({ error: filaErr.message }, 500)
    if (!fila) return json({ error: 'La receta no existe' }, 404)

    if (quienId && fila.professional_id !== quienId) {
      return json({ error: 'Sólo el profesional que emitió la receta puede anularla.', code: 'RCTA_NO_ES_EL_PRESCRIPTOR' }, 403)
    }
    if (fila.posdatada_de) {
      return json({ error: 'Las recetas posdatadas se anulan desde la receta original.', code: 'RCTA_ANULAR_DESDE_ORIGINAL' }, 422)
    }
    if (!fila.rcta_prescription_id || (fila.rcta_status !== 'issued' && fila.rcta_status !== 'anulada')) {
      return json({ error: 'Esta medicación no tiene una receta emitida para anular.', code: 'RCTA_NO_EMITIDA' }, 422)
    }
    const reintento = fila.rcta_status === 'anulada'

    // Todos los medicamentos de la receta (una receta puede llevar varios).
    const { data: grupoData, error: grupoErr } = await supabase
      .from('clinical_medications').select(COLUMNAS)
      .eq('patient_id', fila.patient_id)
      .eq('rcta_prescription_id', fila.rcta_prescription_id)
      .is('posdatada_de', null)
    if (grupoErr) return json({ error: grupoErr.message }, 500)
    const grupo = (grupoData ?? []) as Fila[]
    const idsGrupo = grupo.map(g => g.id)

    const hoyAr = new Date(Date.now() - TZ_OFFSET_MS).toISOString().slice(0, 10)
    const ahora = new Date().toISOString()

    let aAnular: Fila[] = []
    let siguenVigentes: Fila[] = []

    if (!reintento) {
      if (grupo.some(g => g.status !== 'active' || g.rcta_status !== 'issued')) {
        return json({ error: 'Esta receta ya no está vigente.', code: 'RCTA_NO_VIGENTE' }, 409)
      }
      const { data: posData, error: posErr } = await supabase
        .from('clinical_medications').select(COLUMNAS)
        .in('posdatada_de', idsGrupo)
        .eq('rcta_status', 'issued')
        .eq('status', 'active')
      if (posErr) return json({ error: posErr.message }, 500)
      const posdatadas = (posData ?? []) as Fila[]
      // "Ya empezó" = su fecha de inicio es hoy o antes (día argentino). Una
      // posdatada no se puede comprar antes de empezar, así que las compradas
      // caen siempre en este grupo.
      const noEmpezadas = posdatadas.filter(p => (p.vigencia_desde ?? '') > hoyAr)
      siguenVigentes = posdatadas.filter(p => (p.vigencia_desde ?? '') <= hoyAr)

      // 1 · Primero nuestra base, con la condición puesta: si otra pestaña la
      // anuló un instante antes, no se anula dos veces.
      const ids = [...idsGrupo, ...noEmpezadas.map(p => p.id)]
      const { data: marcadas, error: marcaErr } = await supabase
        .from('clinical_medications')
        .update({
          status: 'cancelled',
          rcta_status: 'anulada',
          stopped_at: ahora,
          stopped_by: quienId ?? fila.professional_id,
          stop_reason: motivo ?? 'Receta anulada por el profesional',
          rcta_anulacion_estado: 'error',
          rcta_anulacion_detalle: 'Sin confirmar todavía por el servicio de recetas.',
        })
        .in('id', ids)
        .eq('rcta_status', 'issued')
        .eq('status', 'active')
        .select(COLUMNAS)
      if (marcaErr) return json({ error: `No se pudo anular: ${marcaErr.message}` }, 500)
      if ((marcadas ?? []).length !== ids.length) {
        // Carrera con otra anulación: lo que quedó marcado se reintenta abajo.
        console.warn(`rcta-anular: se esperaban ${ids.length} filas y se marcaron ${(marcadas ?? []).length}`)
      }
      aAnular = (marcadas ?? []) as Fila[]
    } else {
      // Reintento: las filas de esta receta y de sus posdatadas que quedaron
      // anuladas acá pero sin confirmar allá.
      const { data: pendientes, error: pendErr } = await supabase
        .from('clinical_medications').select(COLUMNAS)
        .or(`id.in.(${idsGrupo.join(',')}),posdatada_de.in.(${idsGrupo.join(',')})`)
        .eq('rcta_status', 'anulada')
        .eq('rcta_anulacion_estado', 'error')
      if (pendErr) return json({ error: pendErr.message }, 500)
      aAnular = (pendientes ?? []) as Fila[]
    }

    // ── 2 · El servicio de recetas ──────────────────────────────────────────
    const RCTA_API_URL = Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = Deno.env.get('RCTA_CLIENT_APP_ID')

    // Una llamada por receta (varias filas pueden ser la misma receta).
    const porReceta = new Map<string, Fila[]>()
    for (const f of aAnular) {
      const k = f.rcta_prescription_id ?? f.id
      porReceta.set(k, [...(porReceta.get(k) ?? []), f])
    }

    const resultados: { prescriptionId: string; vigenciaDesde: string | null; estado: string; detalle: string | null }[] = []

    for (const [prescriptionId, filas] of porReceta) {
      const f0 = filas[0]
      const t0 = Date.now()
      let estado: 'confirmada' | 'no_hacia_falta' | 'error' = 'error'
      let detalle: string | null = null
      let httpStatus: number | null = null
      // deno-lint-ignore no-explicit-any
      let respuesta: any = null
      let codigo: string | null = null

      const hash = f0.rcta_hash ?? await hashDesdeElLog(supabase, prescriptionId)

      if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
        detalle = 'El servicio de recetas no está configurado en este entorno.'
        codigo = 'RCTA_NOT_CONFIGURED'
      } else if (!hash) {
        detalle = 'No se encontró el identificador de la receta en el servicio de recetas.'
        codigo = 'RCTA_SIN_HASH'
      } else {
        try {
          const res = await fetch(`${RCTA_API_URL}/apirecipe/Receta/${encodeURIComponent(hash)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RCTA_API_KEY}` },
            body: JSON.stringify({ clienteAppId: Number(RCTA_CLIENT_APP_ID) }),
          })
          httpStatus = res.status
          const texto = await res.text()
          try { respuesta = JSON.parse(texto) } catch { respuesta = texto ? { raw: texto } : null }
          const r = interpretar(res.status, respuesta)
          estado = r.estado; detalle = r.detalle; codigo = r.codigo
        } catch (err) {
          detalle = 'El servicio de recetas no respondió.'
          codigo = 'RCTA_SIN_RESPUESTA'
          console.error('rcta-anular: error de red', String(err))
        }
      }

      const { error: updErr } = await supabase
        .from('clinical_medications')
        .update({
          rcta_anulacion_estado: estado,
          rcta_anulacion_detalle: detalle,
          ...(hash && !f0.rcta_hash ? { rcta_hash: hash } : {}),
        })
        .in('id', filas.map(x => x.id))
      if (updErr) console.error('rcta-anular: no se pudo guardar el resultado:', updErr.message)

      // El log nunca puede tumbar la anulación.
      try {
        const { error: logErr } = await supabase.from('rcta_issue_log').insert({
          medication_ids: filas.map(x => x.id),
          encounter_id: f0.encounter_id,
          patient_id: f0.patient_id,
          professional_id: f0.professional_id,
          purpose: 'produccion',
          api_base_url: RCTA_API_URL ?? null,
          cliente_app_id: RCTA_CLIENT_APP_ID ? Number(RCTA_CLIENT_APP_ID) : null,
          endpoint: hash ? `DELETE /apirecipe/Receta/${hash}` : 'DELETE /apirecipe/Receta',
          request: { clienteAppId: RCTA_CLIENT_APP_ID ? Number(RCTA_CLIENT_APP_ID) : null, motivo, reintento },
          http_status: httpStatus,
          response: respuesta,
          duration_ms: Date.now() - t0,
          id_transaccion: f0.rcta_transaction_id,
          id_receta: prescriptionId,
          outcome: estado === 'error' ? 'anulacion_error' : 'anulada',
          error_code: codigo,
        })
        if (logErr) console.error('rcta-anular: no se pudo escribir rcta_issue_log:', logErr.message)
      } catch (err) {
        console.error('rcta-anular: no se pudo escribir rcta_issue_log:', String(err))
      }

      resultados.push({ prescriptionId, vigenciaDesde: f0.vigencia_desde, estado, detalle })
    }

    return json({
      reintento,
      anuladas: resultados,
      sinConfirmar: resultados.filter(r => r.estado === 'error').length,
      siguenVigentes: siguenVigentes.map(p => ({ prescriptionId: p.rcta_prescription_id, vigenciaDesde: p.vigencia_desde })),
    })
  } catch (err) {
    console.error('rcta-anular error:', err)
    return json({ error: 'Error interno', detail: String(err) }, 500)
  }
})

/**
 * Qué quiere decir la respuesta del servicio de recetas.
 * 200 → anulada. QBI79 ("LA RECETA HA VENCIDO EL DIA …") → ya no vale allá:
 * no hace falta anularla. Una receta ya anulada antes también cuenta como
 * hecha. Cualquier otra cosa queda en error, con el mensaje, para reintentar.
 */
// deno-lint-ignore no-explicit-any
function interpretar(status: number, r: any): { estado: 'confirmada' | 'no_hacia_falta' | 'error'; detalle: string | null; codigo: string | null } {
  const codigo = (r?.error ?? null) as string | null
  const mensaje = String(r?.mensaje ?? r?.raw ?? '').trim() || null
  if (status >= 200 && status < 300) return { estado: 'confirmada', detalle: mensaje, codigo: null }
  if (codigo === 'QBI79' || /VENCID/i.test(mensaje ?? '')) return { estado: 'no_hacia_falta', detalle: mensaje, codigo }
  if (/ANULAD|DADA DE BAJA/i.test(mensaje ?? '')) return { estado: 'confirmada', detalle: mensaje, codigo }
  return { estado: 'error', detalle: mensaje ?? `El servicio de recetas respondió ${status}.`, codigo }
}

/**
 * El hash de una receta emitida antes de que se guardara en la fila: la
 * respuesta entera de la emisión está en `rcta_issue_log` (migración 092).
 */
// deno-lint-ignore no-explicit-any
async function hashDesdeElLog(supabase: any, idReceta: string): Promise<string | null> {
  const { data } = await supabase
    .from('rcta_issue_log')
    .select('response')
    .eq('outcome', 'issued')
    .contains('response', { recetas: [{ idReceta }] })
    .order('created_at', { ascending: false })
    .limit(1)
  // deno-lint-ignore no-explicit-any
  const receta = (data?.[0]?.response?.recetas ?? []).find((r: any) => r?.idReceta === idReceta)
  return receta?.id ?? null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
