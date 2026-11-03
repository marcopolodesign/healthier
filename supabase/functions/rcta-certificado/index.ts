// ── rcta-certificado — constancias de atención y certificados de reposo ──────
// Pedido de los profesionales (2026-11-02). Se emiten por el servicio de
// recetas, endpoint "Otras Prescripciones":
//   POST   /apirecipe/OtrasPrescripciones           (emitir)
//   DELETE /apirecipe/OtrasPrescripciones/{id}      (anular, `id` = hash)
//
// Body:
//   { accion: 'emitir' | 'vista_previa', consultationId, encounterId?,
//     tipo: 'constancia'|'reposo'|'escolar',
//     dias?, desde? (AAAA-MM-DD), indicaciones?, cie10Code?, cie10Display?,
//     imprimirDiagnostico? }
//   { accion: 'anular', certificadoId }
//
// Mismas reglas que la receta (`rcta-issue`), a propósito:
//   · Sólo emite el profesional de la consulta, y sólo si su especialidad
//     receta (`profesional_puede_recetar`, migración 116).
//   · Sin firma cargada no se emite: 422 `RCTA_FIRMA_FALTANTE` y el front abre
//     la hoja para firmar.
//   · La fila se escribe ANTES de llamar (`pending`): si la función se corta en
//     el medio, queda rastro. El resultado se guarda después.
//   · Cada llamada deja un renglón en `rcta_issue_log` con el request y la
//     respuesta crudos (la respuesta real no coincide con el swagger).
//   · Un error de red NUNCA se reintenta (podría duplicar el certificado). Un
//     4xx con la firma puesta se reintenta UNA vez sin la firma.
//   · Anular: primero se marca en Healthier (el paciente deja de verlo), después
//     se llama al servicio; si no confirma, queda el error para reintentar.
//
// Staging apunta a homologación y producción a producción por los secrets
// RCTA_* de cada proyecto — esta función no elige ambiente.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolverFirma, llamarRcta, interpretarAnulacion, etiquetaEspecialidad, matriculaDe, problemaDeMatricula,
} from '../_shared/rcta/mod.ts'
import {
  CORS, json, rolDelJwt, armarPayloadCertificado, problemasDelPayload, validarCertificado,
  vistaPrevia, conDias, diaAr, TIPOS, consultaNoCertificable, nombreDelProblema, type Certificado,
} from './armado.ts'

const ENDPOINT = '/apirecipe/OtrasPrescripciones'

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
        if (error) console.error('rcta-certificado: no se pudo escribir rcta_issue_log:', error.message)
      } catch (err) {
        console.error('rcta-certificado: no se pudo escribir rcta_issue_log:', String(err))
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Anular
    // ═══════════════════════════════════════════════════════════════════════
    if (body.accion === 'anular') {
      if (typeof body.certificadoId !== 'string') return json({ error: 'certificadoId requerido' }, 400)
      const { data: cert, error } = await supabase
        .from('clinical_certificates').select('*').eq('id', body.certificadoId).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      if (!cert) return json({ error: 'Certificado no encontrado' }, 404)
      if (!esServicio && cert.professional_id !== user!.id) {
        return json({ error: 'Sólo el profesional que lo emitió puede anularlo.', code: 'RCTA_NO_ES_EL_PRESCRIPTOR' }, 403)
      }
      const reintento = cert.status === 'anulado' && cert.anulacion_estado === 'error'
      if (cert.status !== 'issued' && !reintento) {
        return json({ error: 'Este certificado no está emitido.', code: 'RCTA_NO_EMITIDA' }, 422)
      }

      // 1 · Primero en Healthier.
      if (!reintento) {
        const { error: e } = await supabase.from('clinical_certificates')
          .update({ status: 'anulado', anulado_at: new Date().toISOString(), anulacion_estado: 'error', anulacion_detalle: 'Sin confirmar todavía.' })
          .eq('id', cert.id).eq('status', 'issued')
        if (e) return json({ error: `No se pudo anular: ${e.message}` }, 500)
      }

      // 2 · El servicio de recetas.
      const t0 = Date.now()
      let r: ReturnType<typeof interpretarAnulacion> = { estado: 'error', detalle: null, codigo: null }
      let httpStatus: number | null = null
      // deno-lint-ignore no-explicit-any
      let respuesta: any = null
      if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
        r = { estado: 'error', detalle: 'El servicio de recetas no está configurado en este entorno.', codigo: 'RCTA_NOT_CONFIGURED' }
      } else if (!cert.rcta_hash) {
        r = { estado: 'error', detalle: 'No se encontró el identificador del certificado.', codigo: 'RCTA_SIN_HASH' }
      } else {
        const res = await llamarRcta('DELETE', RCTA_API_URL, RCTA_API_KEY, `${ENDPOINT}/${encodeURIComponent(cert.rcta_hash)}`,
          { clienteAppId: Number(RCTA_CLIENT_APP_ID) })
        if (res.kind === 'network_error') {
          r = { estado: 'error', detalle: 'El servicio de recetas no respondió.', codigo: 'RCTA_SIN_RESPUESTA' }
        } else {
          httpStatus = res.status
          respuesta = res.kind === 'ok' ? res.data : res.json
          r = interpretarAnulacion(res.status, respuesta)
        }
      }

      await supabase.from('clinical_certificates')
        .update({ anulacion_estado: r.estado, anulacion_detalle: r.detalle }).eq('id', cert.id)
      await registrar({
        certificado_id: cert.id,
        consultation_id: cert.consultation_id, encounter_id: cert.encounter_id,
        patient_id: cert.patient_id, professional_id: cert.professional_id,
        endpoint: `DELETE ${ENDPOINT}/${cert.rcta_hash ?? ''}`,
        request: { clienteAppId: RCTA_CLIENT_APP_ID ? Number(RCTA_CLIENT_APP_ID) : null, reintento },
        http_status: httpStatus, response: respuesta, duration_ms: Date.now() - t0,
        id_receta: cert.rcta_numero,
        outcome: r.estado === 'error' ? 'anulacion_error' : 'anulada',
        error_code: r.codigo,
      })
      return json({ estado: r.estado, detalle: r.detalle })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Emitir
    // ═══════════════════════════════════════════════════════════════════════
    const esVistaPrevia = body.accion === 'vista_previa'
    if (body.accion !== 'emitir' && !esVistaPrevia) return json({ error: "accion tiene que ser 'emitir', 'vista_previa' o 'anular'" }, 400)
    if (typeof body.consultationId !== 'string') return json({ error: 'consultationId requerido' }, 400)

    const { data: consulta, error: cErr } = await supabase
      .from('consultations')
      .select('id, patient_id, professional_id, status, scheduled_at, started_at, completed_at, created_at')
      .eq('id', body.consultationId).maybeSingle()
    if (cErr) return json({ error: cErr.message }, 500)
    if (!consulta) return json({ error: 'Consulta no encontrada' }, 404)
    if (!esServicio && consulta.professional_id !== user!.id) {
      return json({ error: 'Sólo el profesional de la consulta puede emitir el certificado.', code: 'RCTA_NO_ES_EL_PRESCRIPTOR' }, 403)
    }
    // Un certificado dice que hubo atención (revisión pre-prod): ver consultaNoCertificable.
    const noCertificable = consultaNoCertificable(consulta, Date.now())
    if (noCertificable) return json(noCertificable, 422)

    const certificado: Certificado = {
      tipo: body.tipo,
      // La atención: cuándo empezó; si no quedó registrado, el turno; si es
      // una inmediata sin turno, cuándo se cerró o se pidió.
      atencionAt: consulta.started_at ?? consulta.scheduled_at ?? consulta.completed_at ?? consulta.created_at,
      dias: conDias(body.tipo) ? Number(body.dias) : null,
      desde: conDias(body.tipo) ? String(body.desde ?? '') : null,
      indicaciones: typeof body.indicaciones === 'string' ? body.indicaciones.trim() || null : null,
      cie10Code: typeof body.cie10Code === 'string' ? body.cie10Code.trim() || null : null,
      cie10Display: typeof body.cie10Display === 'string' ? body.cie10Display.trim() || null : null,
      imprimirDiagnostico: body.imprimirDiagnostico === true,
    }
    if (!TIPOS.includes(body.tipo)) return json({ error: 'Elegí el tipo de certificado.', code: 'CERT_DATOS_INVALIDOS' }, 422)
    const invalido = validarCertificado(certificado, diaAr(certificado.atencionAt!))
    if (invalido) return json({ error: invalido, code: 'CERT_DATOS_INVALIDOS' }, 422)

    const { data: puede, error: permErr } = await supabase
      .rpc('profesional_puede_recetar', { p_professional_id: consulta.professional_id })
    if (permErr) return json({ error: permErr.message }, 500)
    if (!puede) {
      return json({ error: 'Tu especialidad no tiene habilitada la emisión de certificados en Healthier.', code: 'RCTA_ESPECIALIDAD_SIN_PERMISO' }, 403)
    }

    const [{ data: patient }, { data: professional }] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, first_name, last_name, dni, gender, birth_date, phone')
        .eq('id', consulta.patient_id).single(),
      supabase.from('profiles')
        .select(`id, full_name, first_name, last_name, dni, gender, birth_date, phone,
                 professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, license_province, address)`)
        .eq('id', consulta.professional_id).single(),
    ])
    const legajo = Array.isArray(professional?.professional_profiles)
      ? professional.professional_profiles[0] : professional?.professional_profiles
    const especialidadLabel = await etiquetaEspecialidad(supabase, legajo?.specialty)
    const probMatricula = problemaDeMatricula(matriculaDe(legajo))
    if (probMatricula) return json(probMatricula, 422)

    const firmabase64 = await resolverFirma(supabase, consulta.professional_id)
    // La vista previa no necesita firma ni credenciales: no sale nada afuera.
    // Muestra si falta la firma, para que el profesional se entere antes.
    if (!firmabase64 && !esVistaPrevia) {
      return json({
        error: 'Para emitir el certificado necesitás cargar tu firma. Se hace una sola vez y queda para todo.',
        code: 'RCTA_FIRMA_FALTANTE',
      }, 422)
    }
    if (!esVistaPrevia && (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID)) {
      return json({ error: 'La emisión todavía no está habilitada en este entorno.', code: 'RCTA_NOT_CONFIGURED' }, 503)
    }

    const payload = armarPayloadCertificado({
      clienteAppId: Number(RCTA_CLIENT_APP_ID ?? 0), certificado, patient, professional, legajo,
      especialidadLabel, firmabase64,
    })

    // Lo que falta se dice con nombre, no con un QBI.
    const problemas = problemasDelPayload(payload)
    if (esVistaPrevia) {
      return json({
        vistaPrevia: vistaPrevia(payload, diaAr(new Date().toISOString()), // Con un CIE-10 el servicio imprime SU descripción oficial, no la que
        // escribió el profesional: la vista previa muestra sólo el código.
        certificado.imprimirDiagnostico && !certificado.cie10Code ? certificado.cie10Display ?? null : null),
        faltan: problemas,
        sinFirma: !firmabase64,
      })
    }
    if (problemas.length) {
      const faltan = [...new Set(problemas.map(nombreDelProblema))]
      await registrar({
        consultation_id: consulta.id, patient_id: consulta.patient_id, professional_id: consulta.professional_id,
        endpoint: ENDPOINT, request: { ...payload, medico: { ...payload.medico, firmabase64: '(omitida)' } },
        outcome: 'validation_error', error_code: 'CERT_FALTAN_DATOS', errores: problemas,
      })
      return json({ error: `Para emitir el certificado falta ${faltan.join(', ')}.`, code: 'CERT_FALTAN_DATOS', faltan: problemas }, 422)
    }

    // ── La fila, antes de llamar ──────────────────────────────────────────
    // Uno a la vez por consulta y tipo (índice único de la 226): dos clics, o la
    // app y la web juntas, no emiten dos certificados.
    const nuevaFila = () => supabase.from('clinical_certificates').insert({
      patient_id: consulta.patient_id,
      professional_id: consulta.professional_id,
      consultation_id: consulta.id,
      encounter_id: typeof body.encounterId === 'string' ? body.encounterId : null,
      tipo: certificado.tipo,
      atencion_at: certificado.tipo === 'constancia' ? certificado.atencionAt : null,
      dias: certificado.dias,
      desde: certificado.desde,
      indicaciones: certificado.indicaciones,
      cie10_code: certificado.cie10Code,
      cie10_display: certificado.cie10Display,
      imprimir_diagnostico: certificado.imprimirDiagnostico,
      status: 'pending',
    }).select('id').single()
    let { data: fila, error: insErr } = await nuevaFila()
    if (insErr?.code === '23505') {
      // La que choca: si es de hace menos de 5 min, sigue en curso. Si es más
      // vieja, la función se cortó: si el log dice que el servicio la emitió, se
      // recupera (no se emite otra); si no, se cierra como error y se reintenta.
      const { data: previa } = await supabase.from('clinical_certificates')
        .select('id, created_at').eq('consultation_id', consulta.id).eq('tipo', certificado.tipo)
        .eq('status', 'pending').maybeSingle()
      const colgada = previa && Date.parse(previa.created_at) < Date.now() - 5 * 60_000
      if (!colgada) {
        return json({ error: 'Ya hay un certificado de este tipo emitiéndose para esta consulta. Esperá unos segundos y volvé a abrir la consulta.', code: 'CERT_EN_CURSO' }, 409)
      }
      const { data: log } = await supabase.from('rcta_issue_log')
        .select('id_receta, verificador, s3_link, response').eq('certificado_id', previa.id).eq('outcome', 'issued')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (log?.s3_link) {
        const otra = Array.isArray(log.response?.otrasRecetas) ? log.response.otrasRecetas[0] : null
        await supabase.from('clinical_certificates').update({
          status: 'issued', rcta_hash: otra?.id ?? null, rcta_numero: log.id_receta ?? null,
          rcta_verificador: log.verificador ?? null, rcta_pdf_url: log.s3_link,
          rcta_issued_at: new Date().toISOString(), error_detalle: null,
        }).eq('id', previa.id).eq('status', 'pending')
        return json({ error: 'Este certificado ya estaba emitido: ahora aparece en la lista.', code: 'CERT_RECUPERADO' }, 409)
      }
      await supabase.from('clinical_certificates')
        .update({ status: 'error', error_detalle: 'Quedó sin terminar (la emisión se cortó).' })
        .eq('id', previa.id).eq('status', 'pending')
      ;({ data: fila, error: insErr } = await nuevaFila())
      if (insErr?.code === '23505') {
        return json({ error: 'Ya hay un certificado de este tipo emitiéndose para esta consulta. Esperá unos segundos y volvé a abrir la consulta.', code: 'CERT_EN_CURSO' }, 409)
      }
    }
    if (insErr || !fila) return json({ error: `No se pudo registrar el certificado: ${insErr?.message ?? 'sin fila'}` }, 500)

    const t0 = Date.now()
    const base = {
      certificado_id: fila.id, consultation_id: consulta.id, encounter_id: typeof body.encounterId === 'string' ? body.encounterId : null,
      patient_id: consulta.patient_id, professional_id: consulta.professional_id, endpoint: ENDPOINT, con_firma: true,
    }
    const marcarError = (detalle: string) =>
      supabase.from('clinical_certificates').update({ status: 'error', error_detalle: detalle.slice(0, 1000) }).eq('id', fila.id)

    let enviado: Record<string, unknown> = payload
    let res = await llamarRcta('POST', RCTA_API_URL!, RCTA_API_KEY!, ENDPOINT, payload)
    // deno-lint-ignore no-explicit-any
    let reintento: Record<string, any> | null = null

    // Falta la provincia de una MP (QBI62/QBI65): no es la firma, no se
    // reintenta, y el profesional ve qué cargar (igual que rcta-issue).
    if (res.kind === 'rejected' && ['QBI62', 'QBI65'].includes(res.json?.error)) {
      await marcarError('Falta la provincia de tu matrícula provincial.')
      await registrar({ ...base, request: { ...payload, medico: { ...payload.medico, firmabase64: '(omitida)' } }, http_status: res.status,
        response: res.json, outcome: 'api_error', error_code: res.json?.error ?? null, duration_ms: Date.now() - t0 })
      return json({
        error: 'El servicio de recetas pide la provincia de tu matrícula provincial. Cargala en tu perfil (Matrícula → Provincia) y volvé a emitir.',
        code: 'RCTA_MATRICULA_SIN_PROVINCIA',
      }, 422)
    }
    // 429 no es un rechazo del contenido: no se reintenta sin firma.
    if (res.kind === 'rejected' && res.status >= 400 && res.status < 500 && res.status !== 429) {
      // Mismo criterio que la receta: un 4xx prueba que no se creó nada; se
      // prueba UNA vez sin la firma, por si la imagen es lo que no le gustó.
      const { firmabase64: _f, ...medicoSinFirma } = payload.medico
      const sinFirma = { ...payload, medico: medicoSinFirma }
      const otra = await llamarRcta('POST', RCTA_API_URL!, RCTA_API_KEY!, ENDPOINT, sinFirma)
      reintento = { sin_firma: true, rechazo_status: res.status, rechazo_detalle: res.body }
      if (otra.kind === 'ok') { console.error('rcta-certificado: emitido SIN FIRMA tras reintento', res.body); res = otra; enviado = sinFirma }
      else if (otra.kind === 'rejected') reintento.ok = false
    }

    const logRequest = { ...enviado, medico: { ...(enviado.medico as object), ...((enviado.medico as { firmabase64?: string }).firmabase64 ? { firmabase64: '(omitida)' } : {}) } }

    if (res.kind === 'network_error') {
      await marcarError('El servicio de recetas no respondió.')
      await registrar({ ...base, request: logRequest, outcome: 'network_error', error_code: 'RCTA_SIN_RESPUESTA', duration_ms: Date.now() - t0 })
      return json({ error: 'No se pudo contactar al servicio de recetas. Revisá en un momento si el certificado quedó emitido antes de reintentar.', code: 'RCTA_SIN_RESPUESTA' }, 504)
    }
    if (res.kind === 'rejected') {
      const msg = String(res.json?.mensaje ?? res.body ?? '').slice(0, 300)
      await marcarError(msg || `Rechazado (${res.status})`)
      await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.json,
        outcome: 'api_error', error_code: res.json?.error ?? null, duration_ms: Date.now() - t0 })
      return json({ error: `El servicio de recetas rechazó el certificado: ${msg}`, code: res.json?.error ?? 'RCTA_RECHAZADO' }, 502)
    }

    const emitido = Array.isArray(res.data?.otrasRecetas) ? res.data.otrasRecetas[0] : null
    if (!emitido?.s3Link) {
      await marcarError('El servicio no devolvió el PDF.')
      await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.data,
        outcome: 'api_error', error_code: 'CERT_SIN_PDF', duration_ms: Date.now() - t0 })
      return json({ error: 'El servicio de recetas no devolvió el certificado.', code: 'CERT_SIN_PDF' }, 502)
    }

    // El log primero: si la escritura de la fila falla, es lo único que
    // permite recuperar un certificado que ya existe del otro lado.
    await registrar({ ...base, request: logRequest, reintento, http_status: res.status, response: res.data,
      outcome: 'issued', id_receta: emitido.numeroPrescripcion ?? null, verificador: emitido.verificador ?? null,
      s3_link: emitido.s3Link, id_transaccion: res.data?.requestId ?? null, duration_ms: Date.now() - t0 })

    const { data: guardado, error: updErr } = await supabase.from('clinical_certificates').update({
      status: 'issued',
      rcta_hash: emitido.id ?? null,
      rcta_numero: emitido.numeroPrescripcion ?? null,
      rcta_verificador: emitido.verificador ?? null,
      rcta_pdf_url: emitido.s3Link,
      // `fecha` viene sin hora (DD/MM/AAAA): la hora real es ahora.
      rcta_issued_at: new Date().toISOString(),
      error_detalle: null,
    }).eq('id', fila.id).select('*').single()
    if (updErr) {
      console.error('rcta-certificado: emitido pero no guardado', updErr.message, JSON.stringify(emitido))
      return json({
        error: 'El certificado se emitió pero no se pudo guardar en Healthier. Avisá a soporte.',
        code: 'RCTA_EMITIDA_SIN_PERSISTIR', pdfUrl: emitido.s3Link,
      }, 500)
    }

    return json({ certificado: guardado, sinFirma: Boolean(reintento && enviado !== payload) })
  } catch (err) {
    console.error('rcta-certificado error:', err)
    return json({ error: 'Error interno', detail: String(err) }, 500)
  }
})
