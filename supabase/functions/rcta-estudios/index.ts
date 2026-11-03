// ── rcta-estudios — la orden de estudios emitida por el servicio de recetas ──
// Pedido de una profesional (2026-11-02): con los medicamentos la receta se
// emite y le llega al paciente; con los estudios la orden quedaba sólo en la
// HC. Ahora se emite por el endpoint de prácticas (migración 227):
//   POST   /apirecipe/prescribirPractica          (emitir)
//   DELETE /apirecipe/Practica/{hash}              (anular)
//
// Body:
//   { accion: 'emitir', entryId }    la orden de la HC (entry_type 'order')
//   { accion: 'anular', ordenId }
//
// Mismas reglas que `rcta-certificado`, a propósito:
//   · Sólo emite el profesional que escribió la orden, y sólo si su
//     especialidad receta (`profesional_puede_recetar`).
//   · Sin firma cargada no se emite: 422 `RCTA_FIRMA_FALTANTE`.
//   · La fila se escribe ANTES de llamar (`pending`), una sola por orden.
//   · Un error de red o un 5xx NUNCA se reintenta: queda "a revisar".
//   · Un 4xx con la firma puesta se reintenta UNA vez sin la firma.
//   · Cada llamada deja su renglón en `rcta_issue_log`.
// Staging apunta a homologación y producción a producción por los secrets.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolverFirma, llamarRcta, cabecerasRcta, interpretarAnulacion, etiquetaEspecialidad, matriculaDe, problemaDeMatricula,
} from '../_shared/rcta/mod.ts'
import { CORS, json, rolDelJwt, decidirRecuperacion } from '../rcta-certificado/armado.ts'
import {
  estudiosDeLaEntrada, elegirDelCatalogo, consultasPara, resolverCobertura, armarPayloadOrden, problemasDeLaOrden,
  nombreDelProblemaOrden, type EstudioDeOrden,
} from './armado.ts'

const ENDPOINT = '/apirecipe/prescribirPractica'
const ENDPOINT_ANULAR = '/apirecipe/Practica'
const A_REVISAR = { error: 'Esta orden quizás ya salió y la está revisando Healthier. Para no emitir dos, esperá la respuesta de soporte.', code: 'ORDEN_A_REVISAR' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => ({}))
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const esServicio = rolDelJwt(jwt) === 'service_role'
    const { data: { user } } = esServicio ? { data: { user: null } } : await supabase.auth.getUser(jwt)
    if (!esServicio && !user) return json({ error: 'Sesión inválida' }, 401)

    const RCTA_API_URL = Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = Deno.env.get('RCTA_CLIENT_APP_ID')

    // deno-lint-ignore no-explicit-any
    const registrar = async (fila: Record<string, any>) => {
      try {
        const { error } = await supabase.from('rcta_issue_log').insert({
          purpose: 'produccion',
          api_base_url: RCTA_API_URL ?? null,
          cliente_app_id: RCTA_CLIENT_APP_ID ? Number(RCTA_CLIENT_APP_ID) : null,
          ...fila,
        })
        if (error) console.error('rcta-estudios: no se pudo escribir rcta_issue_log:', error.message)
      } catch (err) {
        console.error('rcta-estudios: no se pudo escribir rcta_issue_log:', String(err))
      }
    }
    const marcarARevisar = (id: string, detalle: string) => supabase.from('clinical_study_orders')
      .update({ status: 'error', a_revisar: true, error_detalle: detalle.slice(0, 1000) }).eq('id', id).in('status', ['pending', 'error'])

    // ═══════════════════════════════════════════════════════════════════════
    // Anular
    // ═══════════════════════════════════════════════════════════════════════
    if (body.accion === 'anular') {
      if (typeof body.ordenId !== 'string') return json({ error: 'ordenId requerido' }, 400)
      const { data: orden, error } = await supabase
        .from('clinical_study_orders').select('*').eq('id', body.ordenId).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      if (!orden) return json({ error: 'Orden no encontrada' }, 404)
      if (!esServicio && orden.professional_id !== user!.id) {
        return json({ error: 'Sólo el profesional que la emitió puede anularla.', code: 'RCTA_NO_ES_EL_PRESCRIPTOR' }, 403)
      }
      const reintento = orden.status === 'anulado' && orden.anulacion_estado === 'error'
      if (orden.status !== 'issued' && !reintento) {
        return json({ error: 'Esta orden no está emitida.', code: 'RCTA_NO_EMITIDA' }, 422)
      }
      if (!reintento) {
        const { error: e } = await supabase.from('clinical_study_orders')
          .update({ status: 'anulado', anulado_at: new Date().toISOString(), anulacion_estado: 'error', anulacion_detalle: 'Sin confirmar todavía.' })
          .eq('id', orden.id).eq('status', 'issued')
        if (e) return json({ error: `No se pudo anular: ${e.message}` }, 500)
      }

      const t0 = Date.now()
      let r: ReturnType<typeof interpretarAnulacion> = { estado: 'error', detalle: null, codigo: null }
      let httpStatus: number | null = null
      // deno-lint-ignore no-explicit-any
      let respuesta: any = null
      if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
        r = { estado: 'error', detalle: 'El servicio de recetas no está configurado en este entorno.', codigo: 'RCTA_NOT_CONFIGURED' }
      } else if (!orden.rcta_hash) {
        r = { estado: 'error', detalle: 'No se encontró el identificador de la orden.', codigo: 'RCTA_SIN_HASH' }
      } else {
        const res = await llamarRcta('DELETE', RCTA_API_URL, RCTA_API_KEY, `${ENDPOINT_ANULAR}/${encodeURIComponent(orden.rcta_hash)}`,
          { clienteAppId: Number(RCTA_CLIENT_APP_ID) })
        if (res.kind === 'network_error') {
          r = { estado: 'error', detalle: 'El servicio de recetas no respondió.', codigo: 'RCTA_SIN_RESPUESTA' }
        } else {
          httpStatus = res.status
          respuesta = res.kind === 'ok' ? res.data : res.json
          r = interpretarAnulacion(res.status, respuesta)
        }
      }
      await supabase.from('clinical_study_orders')
        .update({ anulacion_estado: r.estado, anulacion_detalle: r.detalle }).eq('id', orden.id)
      await registrar({
        estudios_orden_id: orden.id, consultation_id: orden.consultation_id, encounter_id: orden.encounter_id,
        patient_id: orden.patient_id, professional_id: orden.professional_id,
        endpoint: `DELETE ${ENDPOINT_ANULAR}/${orden.rcta_hash ?? ''}`,
        request: { clienteAppId: RCTA_CLIENT_APP_ID ? Number(RCTA_CLIENT_APP_ID) : null, reintento },
        http_status: httpStatus, response: respuesta, duration_ms: Date.now() - t0,
        id_receta: orden.rcta_numero,
        outcome: r.estado === 'error' ? 'anulacion_error' : 'anulada',
        error_code: r.codigo,
      })
      return json({ estado: r.estado, detalle: r.detalle })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Emitir
    // ═══════════════════════════════════════════════════════════════════════
    if (body.accion !== 'emitir') return json({ error: "accion tiene que ser 'emitir' o 'anular'" }, 400)
    if (typeof body.entryId !== 'string') return json({ error: 'entryId requerido' }, 400)

    const { data: entrada, error: eErr } = await supabase
      .from('clinical_entries')
      .select('id, encounter_id, patient_id, professional_id, entry_type, data, encounter:clinical_encounters!encounter_id(id, consultation_id, professional_id)')
      .eq('id', body.entryId).maybeSingle()
    if (eErr) return json({ error: eErr.message }, 500)
    if (!entrada || entrada.entry_type !== 'order') return json({ error: 'Orden de estudios no encontrada' }, 404)
    if (!esServicio && entrada.professional_id !== user!.id) {
      return json({ error: 'Sólo el profesional que escribió la orden puede emitirla.', code: 'RCTA_NO_ES_EL_PRESCRIPTOR' }, 403)
    }

    // Ya emitida: se devuelve, no se emite otra.
    const { data: yaEmitida } = await supabase.from('clinical_study_orders')
      .select('*').eq('entry_id', entrada.id).eq('status', 'issued').limit(1).maybeSingle()
    if (yaEmitida) return json({ orden: yaEmitida, yaEstaba: true })

    const { data: puede, error: permErr } = await supabase
      .rpc('profesional_puede_recetar', { p_professional_id: entrada.professional_id })
    if (permErr) return json({ error: permErr.message }, 500)
    if (!puede) {
      return json({ error: 'Tu especialidad no tiene habilitada la emisión de órdenes en Healthier. La orden quedó guardada en la historia clínica.', code: 'RCTA_ESPECIALIDAD_SIN_PERMISO' }, 403)
    }
    if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
      return json({ error: 'La emisión todavía no está habilitada en este entorno.', code: 'RCTA_NOT_CONFIGURED' }, 503)
    }

    // ── Los estudios, cada uno con su id del catálogo ─────────────────────
    let estudios: EstudioDeOrden[] = estudiosDeLaEntrada(entrada.data)
    if (!estudios.length) return json({ error: 'La orden no tiene estudios.', code: 'ORDEN_VACIA' }, 422)
    const sinCatalogo: string[] = []
    estudios = await Promise.all(estudios.map(async e => {
      if (e.id) return e
      // Órdenes guardadas antes de la emisión: se busca el nombre exacto.
      for (const q of consultasPara(e.nombre)) {
        try {
          const url = `${RCTA_API_URL}/apirecipe/GetPracticas?search=${encodeURIComponent(q)}&numeroPagina=1&clienteAppId=${RCTA_CLIENT_APP_ID}`
          const r = await fetch(url, { headers: cabecerasRcta(RCTA_API_KEY, { json: false }) })
          const d = r.ok ? await r.json() : null
          const hit = elegirDelCatalogo(e.nombre, Array.isArray(d?.practicas) ? d.practicas : [])
          if (hit) return { ...e, id: hit.id, categoria: hit.categoria }
        } catch { /* prueba la próxima */ }
      }
      sinCatalogo.push(e.nombre)
      return e
    }))
    if (sinCatalogo.length) {
      return json({
        error: `${sinCatalogo.length === 1 ? 'Este estudio no está' : 'Estos estudios no están'} en el listado del servicio de recetas: ${sinCatalogo.join(', ')}. Hacé una orden nueva eligiéndolos del listado.`,
        code: 'ORDEN_ESTUDIO_SIN_CATALOGO', estudios: sinCatalogo,
      }, 422)
    }

    // ── Paciente, profesional, cobertura y firma ──────────────────────────
    const enc = (Array.isArray(entrada.encounter) ? entrada.encounter[0] : entrada.encounter) as { consultation_id?: string | null } | null
    const consultationId = enc?.consultation_id ?? null
    const [{ data: patient }, { data: professional }, { data: consulta }] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, first_name, last_name, dni, gender, birth_date, phone, coverage_type, financiador_id, insurance_num')
        .eq('id', entrada.patient_id).single(),
      supabase.from('profiles')
        .select(`id, full_name, first_name, last_name, dni, gender, birth_date, phone,
                 professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, license_province, address)`)
        .eq('id', entrada.professional_id).single(),
      consultationId
        ? supabase.from('consultations').select('id, coverage_type, financiador_id, affiliate_number').eq('id', consultationId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const legajo = Array.isArray(professional?.professional_profiles)
      ? professional.professional_profiles[0] : professional?.professional_profiles
    const probMatricula = problemaDeMatricula(matriculaDe(legajo))
    if (probMatricula) return json(probMatricula, 422)
    const { cobertura, error: cobErr } = resolverCobertura(consulta, patient)
    if (cobErr) return json(cobErr, 422)

    const firmabase64 = await resolverFirma(supabase, entrada.professional_id)
    if (!firmabase64) {
      return json({
        error: 'Para emitir la orden necesitás cargar tu firma. Se hace una sola vez y queda para todo.',
        code: 'RCTA_FIRMA_FALTANTE',
      }, 422)
    }

    // Órdenes guardadas antes del límite del formulario pueden ser más largas:
    // se cortan al largo que acepta la fila (y el servicio).
    const indicaciones = String(entrada.data?.indicaciones ?? '').trim().slice(0, 1000)
    const diagnostico = String(entrada.data?.diagnostico ?? '').trim().slice(0, 200)
    const payload = armarPayloadOrden({
      clienteAppId: Number(RCTA_CLIENT_APP_ID),
      estudios,
      indicaciones,
      diagnostico,
      patient, professional, legajo,
      especialidadLabel: await etiquetaEspecialidad(supabase, legajo?.specialty),
      firmabase64,
      cobertura,
    })
    const sinFirmaEnLog = (p: Record<string, unknown>) => {
      const m = p.medico as { firmabase64?: string }
      return { ...p, medico: { ...m, ...(m?.firmabase64 ? { firmabase64: '(omitida)' } : {}) } }
    }

    const problemas = problemasDeLaOrden(payload)
    if (problemas.length) {
      const faltan = [...new Set(problemas.map(nombreDelProblemaOrden))]
      await registrar({
        consultation_id: consultationId, encounter_id: entrada.encounter_id,
        patient_id: entrada.patient_id, professional_id: entrada.professional_id,
        endpoint: ENDPOINT, request: sinFirmaEnLog(payload),
        outcome: 'validation_error', error_code: 'ORDEN_FALTAN_DATOS', errores: problemas,
      })
      return json({ error: `Para emitir la orden falta ${faltan.join(', ')}.`, code: 'ORDEN_FALTAN_DATOS', faltan: problemas }, 422)
    }

    // ── La fila, antes de llamar (una 'pending' por orden) ────────────────
    const { data: trabada, error: trabErr } = await supabase.from('clinical_study_orders')
      .select('id').eq('entry_id', entrada.id).eq('a_revisar', true).limit(1).maybeSingle()
    if (trabErr) return json({ error: `No se pudo verificar si hay una orden a revisar: ${trabErr.message}` }, 500)
    if (trabada) return json(A_REVISAR, 409)

    const nuevaFila = () => supabase.from('clinical_study_orders').insert({
      patient_id: entrada.patient_id,
      professional_id: entrada.professional_id,
      encounter_id: entrada.encounter_id,
      consultation_id: consultationId,
      entry_id: entrada.id,
      estudios: estudios.map(e => ({ id: e.id, nombre: e.nombre, categoria: e.categoria ?? null })),
      indicaciones: indicaciones || null,
      diagnostico: diagnostico || null,
      status: 'pending',
    }).select('id').single()

    let { data: fila, error: insErr } = await nuevaFila()
    if (insErr?.code === '23505') {
      const { data: previa } = await supabase.from('clinical_study_orders')
        .select('id, created_at, llamado_at').eq('entry_id', entrada.id).eq('status', 'pending').maybeSingle()
      const { data: log } = previa ? await supabase.from('rcta_issue_log')
        .select('created_at, id_receta, verificador, s3_link, response').eq('estudios_orden_id', previa.id).eq('outcome', 'issued')
        .order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null }
      const decision = previa ? decidirRecuperacion(previa, log, Date.now()) : 'en_curso'
      if (decision === 'en_curso') {
        return json({ error: 'Esta orden ya se está emitiendo. Esperá unos segundos.', code: 'ORDEN_EN_CURSO' }, 409)
      }
      if (decision === 'recuperar') {
        const otra = Array.isArray(log!.response?.otrasRecetas) ? log!.response.otrasRecetas[0] : null
        const { data: recuperada, error: recErr } = await supabase.from('clinical_study_orders').update({
          status: 'issued', rcta_hash: otra?.id ?? null, rcta_numero: log!.id_receta ?? null,
          rcta_verificador: log!.verificador ?? null, rcta_pdf_url: log!.s3_link,
          rcta_issued_at: log!.created_at, error_detalle: null,
        }).eq('id', previa!.id).eq('status', 'pending').select('*').maybeSingle()
        if (recErr) return json({ error: `La orden ya estaba emitida pero no se pudo guardar: ${recErr.message}. Avisá a soporte.`, code: 'RCTA_EMITIDA_SIN_PERSISTIR', pdfUrl: log!.s3_link }, 500)
        const final = recuperada ?? (await supabase.from('clinical_study_orders').select('*').eq('id', previa!.id).single()).data
        return json({ orden: final, recuperada: true })
      }
      if (decision === 'a_revisar') {
        await marcarARevisar(previa!.id, 'Se llamó al servicio y no quedó la respuesta: puede haber salido.')
        return json(A_REVISAR, 409)
      }
      await supabase.from('clinical_study_orders')
        .update({ status: 'error', error_detalle: 'Quedó sin terminar antes de llamar al servicio.' })
        .eq('id', previa!.id).eq('status', 'pending')
      ;({ data: fila, error: insErr } = await nuevaFila())
      if (insErr?.code === '23505') return json({ error: 'Esta orden ya se está emitiendo. Esperá unos segundos.', code: 'ORDEN_EN_CURSO' }, 409)
    }
    if (insErr || !fila) return json({ error: `No se pudo registrar la orden: ${insErr?.message ?? 'sin fila'}` }, 500)

    const t0 = Date.now()
    const base = {
      estudios_orden_id: fila.id, consultation_id: consultationId, encounter_id: entrada.encounter_id,
      patient_id: entrada.patient_id, professional_id: entrada.professional_id, endpoint: ENDPOINT, con_firma: true,
    }
    const marcarError = (detalle: string) =>
      supabase.from('clinical_study_orders').update({ status: 'error', error_detalle: detalle.slice(0, 1000) }).eq('id', fila.id)

    const { error: marcaErr } = await supabase.from('clinical_study_orders').update({ llamado_at: new Date().toISOString() }).eq('id', fila.id)
    if (marcaErr) {
      await marcarError(`No se pudo preparar la emisión: ${marcaErr.message}`)
      return json({ error: `No se pudo preparar la emisión: ${marcaErr.message}` }, 500)
    }

    let enviado: Record<string, unknown> = payload
    let res = await llamarRcta('POST', RCTA_API_URL, RCTA_API_KEY, ENDPOINT, payload)
    // deno-lint-ignore no-explicit-any
    let reintento: Record<string, any> | null = null

    if (res.kind === 'rejected' && ['QBI62', 'QBI65'].includes(res.json?.error)) {
      await marcarError('Falta la provincia de tu matrícula provincial.')
      await registrar({ ...base, request: sinFirmaEnLog(payload), http_status: res.status, response: res.json,
        outcome: 'api_error', error_code: res.json?.error ?? null, duration_ms: Date.now() - t0 })
      return json({
        error: 'El servicio de recetas pide la provincia de tu matrícula provincial. Cargala en tu perfil (Matrícula → Provincia) y volvé a emitir.',
        code: 'RCTA_MATRICULA_SIN_PROVINCIA',
      }, 422)
    }
    // Un estudio que el servicio no encuentra no es la firma: no se reintenta.
    const esDelEstudio = res.kind === 'rejected' && res.json?.error === 'QBI232'
    if (res.kind === 'rejected' && res.status >= 400 && res.status < 500 && res.status !== 429 && !esDelEstudio) {
      const { firmabase64: _f, ...medicoSinFirma } = payload.medico
      const sinFirma = { ...payload, medico: medicoSinFirma }
      const otra = await llamarRcta('POST', RCTA_API_URL, RCTA_API_KEY, ENDPOINT, sinFirma)
      reintento = { sin_firma: true, rechazo_status: res.status, rechazo_detalle: res.body }
      if (otra.kind === 'ok') { console.error('rcta-estudios: emitida SIN FIRMA tras reintento', res.body); res = otra; enviado = sinFirma }
      else if (otra.kind === 'rejected') { reintento.ok = false; res = otra.status >= 500 ? otra : res }
      else { res = otra; enviado = sinFirma }
    }
    const logRequest = sinFirmaEnLog(enviado)

    if (res.kind === 'network_error' || (res.kind === 'rejected' && res.status >= 500)) {
      await marcarARevisar(fila.id, res.kind === 'network_error'
        ? 'El servicio de recetas no respondió: puede haber salido.'
        : `El servicio de recetas contestó ${res.status}: puede haber salido.`)
      await registrar({ ...base, request: logRequest, reintento, outcome: 'network_error', error_code: 'RCTA_SIN_RESPUESTA',
        http_status: res.kind === 'rejected' ? res.status : null, duration_ms: Date.now() - t0 })
      return json({ error: 'El servicio de recetas no respondió y no sabemos si la orden salió. Lo revisa Healthier; para no emitir dos, no se puede volver a emitir hasta entonces.', code: 'RCTA_SIN_RESPUESTA' }, 504)
    }
    if (res.kind === 'rejected') {
      const msg = String(res.json?.mensaje ?? res.body ?? '').slice(0, 300)
      await marcarError(msg || `Rechazada (${res.status})`)
      await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.json,
        outcome: 'api_error', error_code: res.json?.error ?? null, duration_ms: Date.now() - t0 })
      return json({ error: `El servicio de recetas rechazó la orden: ${msg}`, code: res.json?.error ?? 'RCTA_RECHAZADO' }, 502)
    }

    const emitida = Array.isArray(res.data?.otrasRecetas) ? res.data.otrasRecetas[0] : null
    if (!emitida?.s3Link) {
      await marcarARevisar(fila.id, 'El servicio aceptó el pedido pero no devolvió el PDF: puede haber salido.')
      await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.data,
        outcome: 'api_error', error_code: 'ORDEN_SIN_PDF', duration_ms: Date.now() - t0 })
      return json({ error: 'El servicio de recetas aceptó el pedido pero no devolvió la orden. Lo revisa Healthier antes de que se pueda emitir de nuevo.', code: 'ORDEN_SIN_PDF' }, 502)
    }

    // El log primero: si la escritura de la fila falla, es lo que permite recuperarla.
    await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.data,
      outcome: 'issued', id_receta: emitida.numeroPrescripcion ?? null, verificador: emitida.verificador ?? null,
      s3_link: emitida.s3Link, id_transaccion: res.data?.requestId ?? null, duration_ms: Date.now() - t0 })

    const { data: guardada, error: updErr } = await supabase.from('clinical_study_orders').update({
      status: 'issued',
      rcta_hash: emitida.id ?? null,
      rcta_numero: emitida.numeroPrescripcion ?? null,
      rcta_verificador: emitida.verificador ?? null,
      rcta_pdf_url: emitida.s3Link,
      rcta_issued_at: new Date().toISOString(),
      error_detalle: null,
      a_revisar: false,
    }).eq('id', fila.id).select('*').single()
    if (updErr) {
      console.error('rcta-estudios: emitida pero no guardada', updErr.message, JSON.stringify(emitida))
      return json({ error: 'La orden se emitió pero no se pudo guardar en Healthier. Avisá a soporte.', code: 'RCTA_EMITIDA_SIN_PERSISTIR', pdfUrl: emitida.s3Link }, 500)
    }
    return json({ orden: guardada, sinFirma: Boolean(reintento && enviado !== payload) })
  } catch (err) {
    console.error('rcta-estudios error:', err)
    return json({ error: 'Error interno', detail: String(err) }, 500)
  }
})
