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
import { interpretarAnulacion, llamarRcta } from '../_shared/rcta/mod.ts'

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
  // Migración 223: las recetas que contienen esta medicación. Normalmente una;
  // más si el servicio la repartió. Las filas viejas no la tienen.
  rcta_recetas: { id: string | null; idReceta: string | null }[] | null
}

const COLUMNAS = 'id, patient_id, professional_id, encounter_id, status, rcta_status, posdatada_de, vigencia_desde, rcta_prescription_id, rcta_hash, rcta_transaction_id, rcta_anulacion_estado, medication_name, rcta_recetas'

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
    // Migración 223: una fila "a revisar" (error con recetas del lote guardadas)
    // también se anula — esas recetas valen afuera y no hay otra forma de bajarlas.
    const aRevisar = (f: Fila) => f.rcta_status === 'error' && (f.rcta_recetas?.length ?? 0) > 0
    if (!aRevisar(fila) && (!fila.rcta_prescription_id || (fila.rcta_status !== 'issued' && fila.rcta_status !== 'anulada'))) {
      return json({ error: 'Esta medicación no tiene una receta emitida para anular.', code: 'RCTA_NO_EMITIDA' }, 422)
    }
    const reintento = fila.rcta_status === 'anulada'

    // Todos los medicamentos de la receta (una receta puede llevar varios).
    const { data: grupoData, error: grupoErr } = aRevisar(fila)
      ? { data: [fila], error: null }
      : await supabase
        .from('clinical_medications').select(COLUMNAS)
        .eq('patient_id', fila.patient_id)
        .eq('rcta_prescription_id', fila.rcta_prescription_id)
        .is('posdatada_de', null)
    if (grupoErr) return json({ error: grupoErr.message }, 500)
    const grupo = (grupoData ?? []) as Fila[]

    // Migración 223: una fila puede estar en más de una receta (`rcta_recetas`).
    // Anular esas recetas anula también a las otras medicaciones que las
    // comparten, aunque su receta "principal" sea otra: entran al grupo, si no
    // quedarían a la venta con una receta ya anulada del otro lado.
    const idRecetasDe = (f: Fila) => (f.rcta_recetas?.length ? f.rcta_recetas.map(r => r.idReceta) : [f.rcta_prescription_id])
      .filter(Boolean) as string[]
    const recetasDelGrupo = new Set(grupo.flatMap(idRecetasDe))
    // Siempre que haya transacción (revisión, ronda 2: también cuando la fila
    // anulada tiene una sola receta que otra fila comparte). Sólo entran las que
    // siguen vigentes o "a revisar": una ya anulada o suspendida no frena nada.
    if (!reintento && fila.rcta_transaction_id) {
      const { data: hermanas, error: hermErr } = await supabase
        .from('clinical_medications').select(COLUMNAS)
        .eq('patient_id', fila.patient_id)
        .eq('rcta_transaction_id', fila.rcta_transaction_id)
        .is('posdatada_de', null)
      if (hermErr) return json({ error: hermErr.message }, 500)
      for (const h of (hermanas ?? []) as Fila[]) {
        const vigente = h.status === 'active' && (h.rcta_status === 'issued' || aRevisar(h))
        if (vigente && !grupo.some(g => g.id === h.id) && idRecetasDe(h).some(id => recetasDelGrupo.has(id))) grupo.push(h)
      }
    }
    const idsGrupo = grupo.map(g => g.id)

    const hoyAr = new Date(Date.now() - TZ_OFFSET_MS).toISOString().slice(0, 10)
    const ahora = new Date().toISOString()

    let aAnular: Fila[] = []
    let siguenVigentes: Fila[] = []

    if (!reintento) {
      if (grupo.some(g => g.status !== 'active' || (g.rcta_status !== 'issued' && !aRevisar(g)))) {
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
        .in('rcta_status', ['issued', 'error'])   // 'error' sólo puede ser una fila "a revisar" del grupo
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

    // Una llamada por receta. Varias filas pueden ser la misma receta, y una
    // fila puede estar en más de una (migración 223: el servicio repartió el
    // lote). Sin `rcta_recetas` (filas viejas) vale la receta de la fila.
    const porReceta = new Map<string, { hash: string | null; filas: Fila[] }>()
    for (const f of aAnular) {
      const suyas = f.rcta_recetas?.length
        ? f.rcta_recetas
        : [{ id: f.rcta_hash, idReceta: f.rcta_prescription_id }]
      for (const r of suyas) {
        const k = r.idReceta ?? r.id ?? f.id
        const actual = porReceta.get(k) ?? { hash: r.id ?? null, filas: [] }
        if (!actual.filas.includes(f)) actual.filas.push(f)
        porReceta.set(k, actual)
      }
    }

    const resultados: { prescriptionId: string; vigenciaDesde: string | null; estado: string; detalle: string | null }[] = []
    // Por fila, el peor resultado de sus recetas: con una sin confirmar, la fila
    // queda para "Reintentar".
    const porFila = new Map<string, { estado: 'confirmada' | 'no_hacia_falta' | 'error'; detalles: string[]; hash: string | null }>()
    const RANGO = { no_hacia_falta: 0, confirmada: 1, error: 2 } as const

    for (const [prescriptionId, { hash: hashGuardado, filas }] of porReceta) {
      const f0 = filas[0]
      const t0 = Date.now()
      let estado: 'confirmada' | 'no_hacia_falta' | 'error' = 'error'
      let detalle: string | null = null
      let httpStatus: number | null = null
      // deno-lint-ignore no-explicit-any
      let respuesta: any = null
      let codigo: string | null = null

      const hash = hashGuardado ?? await hashDesdeElLog(supabase, prescriptionId)
      // Ya se compró en la farmacia de Healthier: está dispensada, el servicio
      // de recetas no la va a anular y "Reintentar" fallaría para siempre.
      const dispensada = await yaSeCompro(supabase, filas.map(x => x.id))

      if (dispensada) {
        estado = 'no_hacia_falta'
        detalle = 'Ya se dispensó en la farmacia de Healthier.'
      } else if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
        detalle = 'El servicio de recetas no está configurado en este entorno.'
        codigo = 'RCTA_NOT_CONFIGURED'
      } else if (!hash) {
        detalle = 'No se encontró el identificador de la receta en el servicio de recetas.'
        codigo = 'RCTA_SIN_HASH'
      } else {
        const r = await llamarRcta('DELETE', RCTA_API_URL, RCTA_API_KEY,
          `/apirecipe/Receta/${encodeURIComponent(hash)}`, { clienteAppId: Number(RCTA_CLIENT_APP_ID) })
        if (r.kind === 'network_error') {
          detalle = 'El servicio de recetas no respondió.'
          codigo = 'RCTA_SIN_RESPUESTA'
          console.error('rcta-anular: error de red', String(r.err))
        } else {
          httpStatus = r.status
          respuesta = r.kind === 'ok' ? r.data : r.json
          const i = interpretarAnulacion(r.status, respuesta)
          estado = i.estado; detalle = i.detalle; codigo = i.codigo
        }
      }

      for (const f of filas) {
        const prev = porFila.get(f.id)
        porFila.set(f.id, {
          estado: !prev || RANGO[estado] > RANGO[prev.estado] ? estado : prev.estado,
          detalles: [...(prev?.detalles ?? []), ...(detalle ? [detalle] : [])],
          hash: prev?.hash ?? (hash && !f.rcta_hash && prescriptionId === f.rcta_prescription_id ? hash : null),
        })
      }

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

    for (const [id, r] of porFila) {
      const { error: updErr } = await supabase
        .from('clinical_medications')
        .update({
          rcta_anulacion_estado: r.estado,
          rcta_anulacion_detalle: [...new Set(r.detalles)].join(' · ') || null,
          ...(r.hash ? { rcta_hash: r.hash } : {}),
        })
        .eq('id', id)
      if (updErr) console.error('rcta-anular: no se pudo guardar el resultado:', updErr.message)
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

// `interpretarAnulacion` vive en `_shared/rcta/respuesta.ts` (lo comparten
// las Otras Prescripciones).

/** ¿Alguna de estas filas se usó en un pedido pagado de la farmacia? */
// deno-lint-ignore no-explicit-any
async function yaSeCompro(supabase: any, ids: string[]): Promise<boolean> {
  const { data, error } = await supabase
    .from('medication_order_items')
    .select('id, order:medication_orders!inner(payment_status, status)')
    .in('clinical_medication_id', ids)
    .in('order.payment_status', ['pagado', 'exento'])
    .neq('order.status', 'cancelado')
    .limit(1)
  if (error) { console.error('rcta-anular: no se pudo mirar si ya se compró:', error.message); return false }
  return (data ?? []).length > 0
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
    .in('outcome', ['issued', 'issued_partial'])
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
