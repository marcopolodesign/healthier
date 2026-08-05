// ── RCTA Issue — Innovamed QBI2 "Receta" API ──────────────────────────────────
// Issues a digital prescription (receta electrónica) via POST /apirecipe/Receta.
// Requires institutional credentials: RCTA_API_URL + RCTA_API_KEY + RCTA_CLIENT_APP_ID
// Full API reference: website/docs/rcta-integration.md
// Apply for production access: https://innovamed.com.ar/rcta-institucional
// Pricing: ~$50.000 ARS/mes por médico (institucional)
//
// Request body (una de las dos formas):
//   medicationId   – UUID de una fila de clinical_medications
//   medicationIds  – array de UUIDs: TODOS van en la MISMA receta
//   purpose        – 'produccion' (default) | 'certificacion'
//
// Una receta puede llevar varios medicamentos: `medicamentos` es un array en el
// contrato de Innovamed. Todas las filas tienen que ser del mismo encuentro (y
// por lo tanto del mismo paciente y profesional): una receta es un acto medico
// unico y firmado por un solo profesional.
//
// On success: updates clinical_medications.rcta_prescription_id + rcta_transaction_id
//             + rcta_verificador + rcta_pdf_url + rcta_status + rcta_issued_at
// On error: sets rcta_status = 'error'
//
// TODO intento — exitoso o no — deja una fila en `rcta_issue_log` con el request
// y el response crudos (migracion 092). No es telemetria opcional: Innovamed
// certifica la integracion pidiendo el `idTransaccion` de cada prueba, y ese
// campo vive al tope de la respuesta, fuera de `recetas[]`. Guardar solo el
// resumen ya costo una vez tener que reconstruir las pruebas a mano.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    // `medicationIds` es la forma nueva (varios medicamentos en una receta);
    // `medicationId` se mantiene porque hay clientes desplegados que la usan.
    const ids: string[] = Array.isArray(body.medicationIds) && body.medicationIds.length
      ? body.medicationIds
      : (body.medicationId ? [body.medicationId] : [])
    if (!ids.length) return json({ error: 'medicationId o medicationIds requerido' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Marca el estado de TODAS las filas de la receta de una sola vez. Sin esto,
    // una receta de tres medicamentos que falla dejaba dos en 'pending' para
    // siempre.
    //
    // Devuelve el error en vez de tragarselo: el 2026-07-31 una emision quedo en
    // `pending` con la UI cantando exito, porque este update fallaba y nadie lo
    // miraba. Ver `persistirEmision`.
    // deno-lint-ignore no-explicit-any
    const setStatus = (status: string, extra: Record<string, any> = {}) =>
      supabase.from('clinical_medications').update({ rcta_status: status, ...extra }).in('id', ids)

    // ── Log de la emision (migracion 092) ─────────────────────────────────────
    // `ctx` se va completando a medida que la funcion avanza; se declara aca
    // arriba para que un corte temprano igual deje un renglon utilizable.
    const t0 = Date.now()
    // deno-lint-ignore no-explicit-any
    const ctx: Record<string, any> = {
      medication_ids: ids,
      purpose: body.purpose === 'certificacion' ? 'certificacion' : 'produccion',
    }

    // Escribir el log NUNCA puede tumbar una emision: perder el renglon de
    // auditoria es malo, perder la receta es peor. Por eso se traga el error y
    // lo deja en consola.
    // deno-lint-ignore no-explicit-any
    const registrar = async (outcome: string, extra: Record<string, any> = {}) => {
      try {
        const { error } = await supabase
          .from('rcta_issue_log')
          .insert({ ...ctx, ...extra, outcome, duration_ms: Date.now() - t0 })
        if (error) console.error('rcta-issue: no se pudo escribir rcta_issue_log:', error.message)
      } catch (err) {
        console.error('rcta-issue: no se pudo escribir rcta_issue_log:', String(err))
      }
    }

    // Registra y responde en un solo paso. Separado en dos, el proximo `return`
    // que alguien agregue se olvida del log — que es exactamente como se llego a
    // no tener los idTransaccion de las pruebas de certificacion.
    // deno-lint-ignore no-explicit-any
    const fallar = async (outcome: string, cuerpo: Record<string, any>, status: number, extra: Record<string, any> = {}) => {
      await registrar(outcome, { error_code: cuerpo.code ?? null, ...extra })
      return json(cuerpo, status)
    }

    // ── Load medications + patient + professional ─────────────────────────────
    const { data: meds, error: medErr } = await supabase
      .from('clinical_medications')
      .select(`
        *,
        patient:profiles!patient_id(id, full_name, dni, gender, birth_date, phone),
        professional:profiles!professional_id(
          id, full_name, dni, gender, birth_date, phone,
          professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, address)
        ),
        encounter:clinical_encounters!encounter_id(
          consultation:consultations!consultation_id(id, coverage_type, financiador_id, obra_social_name, affiliate_number)
        )
      `)
      .in('id', ids)
      .order('created_at', { ascending: true })

    if (medErr || !meds?.length) return await fallar('validation_error', { error: 'Medication not found' }, 404)
    if (meds.length !== ids.length) return await fallar('validation_error', { error: 'Alguna de las medicaciones no existe' }, 404)

    ctx.patient_id      = meds[0].patient_id ?? null
    ctx.professional_id = meds[0].professional_id ?? null
    ctx.encounter_id    = meds[0].encounter_id ?? null

    // Una receta es un acto medico unico: mismo encuentro, mismo profesional,
    // mismo paciente. Mezclarlos produciria una receta firmada por alguien que
    // no prescribio uno de los medicamentos.
    if (new Set(meds.map((m: { encounter_id: string }) => m.encounter_id)).size > 1) {
      return await fallar('validation_error', {
        error: 'Todos los medicamentos de una receta tienen que ser de la misma consulta.',
        code: 'RCTA_ENCUENTROS_MEZCLADOS',
      }, 422)
    }

    const yaEmitida = meds.find((m: { rcta_status: string }) => m.rcta_status === 'issued')
    if (yaEmitida) return await fallar('validation_error', { error: 'Already issued', code: 'RCTA_YA_EMITIDA' }, 409)

    // El primer medicamento aporta los datos comunes de la receta (paciente,
    // profesional, cobertura, diagnostico general).
    const med = meds[0]

    // Sin codigo de catalogo la API rechaza con QBI105. Se corta antes con un
    // mensaje que dice que hacer, en vez de propagar el error criptico.
    // La cobertura viaja solo si la consulta declara financiador CON id de
    // catalogo. Una obra social cargada a mano (sin idFinanciador) no sirve:
    // Innovamed no acepta nombres.
    const consulta = med.encounter?.consultation ?? null
    ctx.consultation_id = consulta?.id ?? null
    const cobertura = consulta?.coverage_type === 'financiador' && consulta?.financiador_id
      ? {
          idFinanciador: String(consulta.financiador_id),
          numero: String(consulta.affiliate_number ?? '').trim(),
        }
      : null

    if (consulta?.coverage_type === 'financiador' && !consulta?.financiador_id) {
      return await fallar('validation_error', {
        error: 'La consulta tiene una obra social cargada a mano. Seleccionala del catálogo de Innovamed en "Cobertura médica" para poder emitir la receta.',
        code: 'RCTA_FINANCIADOR_SIN_CODIGO',
      }, 422)
    }

    // QBI25 "EL AFILIADO ES REQUERIDO SI SE INFORMA EL FINANCIADOR": informar
    // cobertura con `numero` vacio es rechazo seguro de la API. Igual que con
    // la cobertura entera, mandar el campo vacio no es lo mismo que omitirlo.
    if (cobertura && !cobertura.numero) {
      return await fallar('validation_error', {
        error: 'La consulta tiene obra social pero falta el número de afiliado del paciente. Cargalo en "Cobertura médica" para poder emitir la receta.',
        code: 'RCTA_AFILIADO_FALTANTE',
      }, 422)
    }

    // deno-lint-ignore no-explicit-any
    const sinCodigo = meds.filter((m: any) => !m.reg_no)
    if (sinCodigo.length) {
      return await fallar('validation_error', {
        error: sinCodigo.length === meds.length
          ? 'Esta medicación no se puede emitir como receta electrónica porque no fue elegida del vademécum. Editala y seleccioná el producto del buscador.'
          // deno-lint-ignore no-explicit-any
          : `No se puede emitir: ${sinCodigo.map((m: any) => m.medication_name).join(', ')} no se eligió del vademécum.`,
        code: 'RCTA_SIN_CODIGO',
      }, 422)
    }

    // ── Mark as pending ───────────────────────────────────────────────────────
    await setStatus('pending')

    // ── Check credentials ─────────────────────────────────────────────────────
    const RCTA_API_URL = Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = Deno.env.get('RCTA_CLIENT_APP_ID')

    if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
      // Credentials not yet configured — return structured error so UI can show correct message
      await setStatus('error')

      return await fallar('validation_error', {
        error: 'RCTA credentials not configured',
        code: 'RCTA_NOT_CONFIGURED',
        instructions: 'Solicitar acceso institucional en innovamed.com.ar/rcta-institucional y configurar RCTA_API_URL + RCTA_API_KEY + RCTA_CLIENT_APP_ID en Supabase secrets.',
      }, 503)
    }

    ctx.api_base_url   = RCTA_API_URL
    ctx.cliente_app_id = Number(RCTA_CLIENT_APP_ID)

    // ── Build QBI2 "Receta" request payload ───────────────────────────────────
    // Real contract: POST /apirecipe/Receta — see website/docs/rcta-integration.md
    const prof = med.professional?.professional_profiles ?? {}
    const { nombre: pacienteNombre, apellido: pacienteApellido } = splitName(med.patient?.full_name)
    const { nombre: medicoNombre, apellido: medicoApellido } = splitName(med.professional?.full_name)
    const nombreConsultorio = medicoApellido ? `Consultorio Dr. ${medicoApellido}` : null

    const payload = {
      clienteAppId: Number(RCTA_CLIENT_APP_ID),
      diagnostico: med.cie10_display ?? med.cie10_code ?? null,
      // Una receta, N medicamentos. Innovamed puede repartirlos en mas de una
      // receta segun sus propias reglas (lo informa en `accionPDF`), por eso
      // abajo se guarda el idReceta que efectivamente devolvio.
      // deno-lint-ignore no-explicit-any
      medicamentos: meds.map((m: any) => ({
        // `regNo` es el codigo del catalogo de Innovamed. Sin el, la API responde
        // QBI105 "CODIGO INFORMADO INEXISTENTE" — por eso se valida arriba antes
        // de llegar aca.
        regNo: m.reg_no,
        nombreProducto: m.medication_name,
        nombreDroga: m.nombre_droga ?? m.medication_name,
        presentacion: m.presentacion ?? ([m.presentation, m.concentration].filter(Boolean).join(' ') || null),
        cantidad: parseInt(String(m.quantity ?? '').replace(/\D/g, ''), 10) || 1,
        permiteSustitucion: null,
        tratamiento: m.is_chronic ? 1 : 0,
        diagnostico: m.cie10_display ?? null,
        codigoDiagnostico: m.cie10_code ?? null,
        posologia: [m.dosage_text, m.frequency].filter(Boolean).join(' — ') || null,
        observaciones: m.notes ?? null,
      })),
      paciente: {
        nombre: pacienteNombre,
        apellido: pacienteApellido,
        // Cobertura: se OMITE cuando el paciente es particular. Innovamed lo
        // contempla explicitamente — la cuarta prueba de certificacion es
        // justamente una receta sin datos de financiador. Mandar el campo vacio
        // o con un id inventado NO es lo mismo que omitirlo.
        ...(cobertura ? { cobertura } : {}),
        tipoDoc: 'DNI',
        nroDoc: med.patient?.dni ?? '',
        sexo: mapSexo(med.patient?.gender),
        fechaNacimiento: med.patient?.birth_date ?? null,
        telefono: med.patient?.phone ?? null,
      },
      medico: {
        nombre: medicoNombre,
        apellido: medicoApellido,
        tipoDoc: 'DNI',
        nroDoc: med.professional?.dni ?? '',
        especialidad: prof.specialty ?? '',
        sexo: mapSexo(med.professional?.gender),
        fechaNacimiento: med.professional?.birth_date ?? null,
        telefono: med.professional?.phone ?? null,
        matricula: {
          tipo: med.professional_license_type ?? prof.license_type ?? 'MN',
          numero: med.professional_license_number ?? prof.license_number ?? '',
          especialidad: prof.specialty ?? '',
        },
        lugarAtencion: prof.address ?? null,
      },
      // deno-lint-ignore no-explicit-any
      indicaciones: meds.map((m: any) => m.notes).filter(Boolean).join(' · ') || null,
      // QBI248 ("DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN") requires the
      // consultation address — sent on every plausible field since Innovamed's swagger
      // doesn't document which one is actually checked.
      direccionConsultorio: prof.address ?? null,
      nombreConsultorio: nombreConsultorio,
      lugarAtencion: prof.address ? {
        nombreConsultorio,
        domicilio: { ...parseAddress(prof.address), direccion: prof.address },
      } : undefined,
    }

    // ── Call QBI2 API ─────────────────────────────────────────────────────────
    // La red se atrapa aca y no en el catch de afuera, que no alcanza a
    // `registrar`: un timeout contra Innovamed tiene que dejar rastro igual que
    // un rechazo suyo — si no, el caso mas dificil de diagnosticar es el unico
    // que no queda escrito.
    let rctaRes: Response
    try {
      rctaRes = await fetch(`${RCTA_API_URL}/apirecipe/Receta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RCTA_API_KEY}`,
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      console.error('rcta-issue: no se pudo contactar a Innovamed:', String(err))
      await setStatus('error')
      ctx.request = payload
      return await fallar('network_error', {
        error: 'No se pudo contactar al servicio de recetas. Reintentá en un momento.',
        code: 'RCTA_SIN_RESPUESTA',
        detail: String(err),
      }, 504)
    }

    ctx.request     = payload
    ctx.http_status = rctaRes.status

    if (!rctaRes.ok) {
      const errBody = await rctaRes.text()
      console.error('RCTA API error:', rctaRes.status, errBody)
      await setStatus('error')
      // Innovamed manda su codigo (QBI212, QBI105...) tambien en los 4xx, pero
      // como `MensajeInvalidoResponse` y no como `errores[]`. Se rescata para
      // que el log se pueda filtrar por codigo sin abrir el JSON a mano.
      // deno-lint-ignore no-explicit-any
      let errJson: any = null
      try { errJson = JSON.parse(errBody) } catch { /* no siempre es JSON */ }
      return await fallar('api_error', { error: 'RCTA API error', status: rctaRes.status, detail: errBody }, 502,
        { response: errJson ?? { raw: errBody }, error_code: errJson?.error ?? null })
    }

    const rctaData = await rctaRes.json()
    // La respuesta entera, no el resumen: `idTransaccion` vive al tope, fuera de
    // `recetas[]`, y es el campo que Innovamed pide para certificar.
    ctx.response       = rctaData
    ctx.id_transaccion = rctaData.idTransaccion ?? null

    // RecetaPdfResponse: { recetas: [{ idReceta, s3Link, fecha, verificador }], errores: [...] }
    if (rctaData.errores?.length) {
      console.error('RCTA API returned errores:', rctaData.errores)
      await setStatus('error')
      return await fallar('api_error', { error: 'RCTA API error', detail: rctaData.errores }, 502,
        { errores: rctaData.errores, error_code: rctaData.errores[0]?.error ?? null })
    }

    const receta = rctaData.recetas?.[0]
    if (!receta) {
      await setStatus('error')
      return await fallar('api_error', { error: 'RCTA API returned no receta', detail: rctaData }, 502)
    }

    const prescriptionId = receta.idReceta ?? receta.id
    const pdfUrl = receta.s3Link ?? null
    const issuedAt = aIso(receta.fecha)

    ctx.id_receta   = prescriptionId ?? null
    ctx.verificador = receta.verificador ?? null
    ctx.nro_cuir    = Array.isArray(receta.nroCUIR) ? receta.nroCUIR : null
    ctx.s3_link     = pdfUrl

    // Queda registrado que devolvio Innovamed: cuando la persistencia falla, esto
    // es lo unico que permite recuperar una receta que ya existe del otro lado.
    console.log('rcta-issue: receta recibida', JSON.stringify(receta))

    // ── Persist result ────────────────────────────────────────────────────────
    // Todas las filas de la receta comparten idReceta y PDF: es un unico
    // documento con varios medicamentos.
    //
    // Esta escritura NO puede fallar en silencio. El 2026-07-31 fallo con
    // `22008 date/time field value out of range` porque `receta.fecha` venia en
    // formato de Innovamed (DD/MM/AAAA) y la columna es `timestamptz`: Postgres
    // rechaza el UPDATE entero, la fila queda en `pending` con todo en NULL, y la
    // funcion igual devolvia 200. El profesional veia "receta emitida" y un
    // renglon clavado en "Emitiendo...".
    const { error: persistErr } = await setStatus('issued', {
      rcta_prescription_id: prescriptionId,
      rcta_transaction_id:  rctaData.idTransaccion ?? null,
      rcta_verificador:     receta.verificador ?? null,
      rcta_pdf_url:         pdfUrl,
      rcta_issued_at:       issuedAt,
    })

    if (persistErr) {
      console.error('rcta-issue: la receta se emitio pero no se pudo guardar:', persistErr.message)

      // Segundo intento sin la fecha, que es el campo con formato ajeno. Se
      // prefiere guardar el idReceta y el PDF sin fecha antes que perder el
      // vinculo con una receta que YA existe en Innovamed.
      const { error: reintentoErr } = await setStatus('issued', {
        rcta_prescription_id: prescriptionId,
        rcta_transaction_id:  rctaData.idTransaccion ?? null,
        rcta_verificador:     receta.verificador ?? null,
        rcta_pdf_url:         pdfUrl,
      })

      if (reintentoErr) {
        console.error('rcta-issue: reintento sin fecha tambien fallo:', reintentoErr.message)
        // Sacar la fila de `pending`: un renglon en "Emitiendo..." para siempre es
        // peor que uno en error, porque no invita a revisar.
        await setStatus('error')
        // El log igual queda con idReceta y idTransaccion: es lo unico que
        // permite recuperar una receta que YA existe del lado de Innovamed.
        return await fallar('persist_error', {
          error: 'La receta se emitió en Innovamed pero no se pudo guardar en Healthier. Anotá el número y avisá a soporte.',
          code: 'RCTA_EMITIDA_SIN_PERSISTIR',
          prescriptionId,
          pdfUrl,
          detail: persistErr.message,
        }, 500)
      }
    }

    // ── Pharmacy stock match + patient notification (best-effort — a failure here
    // must never fail the RCTA response, the prescription was already issued) ──
    // deno-lint-ignore no-explicit-any
    for (const m of meds as any[]) {
      await notifyPharmacyMatch(supabase, m).catch(err => console.error('pharmacy match failed:', err))
    }

    await registrar('issued')

    return json({
      prescriptionId,
      transactionId: rctaData.idTransaccion ?? null,
      verificador: receta.verificador ?? null,
      pdfUrl,
      issuedAt,
      medicationIds: ids,
    })

  } catch (err) {
    console.error('rcta-issue error:', err)
    return json({ error: 'Internal error', detail: String(err) }, 500)
  }
})

/**
 * La fecha que devuelve Innovamed a algo que Postgres acepte en `timestamptz`.
 *
 * Su API trabaja en DD/MM/AAAA (asi estan documentadas las `recetasPostadatas`),
 * y eso mandado crudo a una columna `timestamptz` revienta el UPDATE con 22008.
 * Ante cualquier duda se usa la hora del servidor: la fecha exacta de emision es
 * un dato util, pero perder el vinculo con la receta por un formato no lo es.
 */
function aIso(fecha: unknown): string {
  if (typeof fecha === 'string') {
    const ddmmaaaa = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/)
    if (ddmmaaaa) {
      const [, d, m, a, hh = '00', mm = '00'] = ddmmaaaa
      const iso = new Date(`${a}-${m}-${d}T${hh}:${mm}:00Z`)
      if (!isNaN(iso.getTime())) return iso.toISOString()
    }
    const directa = new Date(fecha)
    if (!isNaN(directa.getTime())) return directa.toISOString()
  }
  return new Date().toISOString()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Farmacia — matches the just-issued prescription's medication against
// pharmacy_products.medication_match (comma-separated keywords, ILIKE) and
// notifies the patient if there's in-stock coverage. Requested by Nacho
// Arteaga (2026-07-08): "webhook al confirmar medicamento en RCTA → match
// con stock de farmacia → notificación al paciente".
// deno-lint-ignore no-explicit-any
async function notifyPharmacyMatch(supabase: any, med: any) {
  const medicationName = (med.medication_name ?? '').trim()
  const patientId = med.patient?.id
  if (!medicationName || !patientId) return

  const { data: products, error } = await supabase
    .from('pharmacy_products')
    .select('id, name, medication_match')
    .eq('in_stock', true)
    .not('medication_match', 'is', null)

  if (error || !products?.length) return

  const needle = medicationName.toLowerCase()
  const match = products.find((p: { medication_match: string }) =>
    p.medication_match.split(',').some(kw => needle.includes(kw.trim().toLowerCase()))
  )
  if (!match) return

  await supabase.functions.invoke('send-push-notification', {
    body: {
      userId: patientId,
      title:  'Tu receta ya está disponible en farmacia',
      body:   `${match.name} — retirá o pedí delivery desde la sección Farmacia.`,
      url:    '/paciente/farmacia',
    },
  })
}

// RCTA wants separate nombre/apellido — Healthier only stores full_name.
// Best-effort split: last word = apellido, everything before it = nombre.
function splitName(fullName: string | null | undefined) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: '', apellido: '' }
  if (parts.length === 1) return { nombre: parts[0], apellido: '' }
  return { nombre: parts.slice(0, -1).join(' '), apellido: parts[parts.length - 1] }
}

// profiles.gender uses Spanish values; RCTA wants F/M/X.
function mapSexo(gender: string | null | undefined): 'F' | 'M' | 'X' {
  if (gender === 'femenino') return 'F'
  if (gender === 'masculino') return 'M'
  return 'X'
}

// professional_profiles.address is one free-text string (e.g. "Av. Santa Fe 1900, Recoleta, Buenos Aires").
// RCTA's DomicilioDto wants calle/numero/localidad/provincia split out — best-effort parse.
function parseAddress(address: string) {
  const [streetPart, localidad, provincia] = address.split(',').map(s => s.trim())
  const match = streetPart?.match(/^(.*\S)\s+(\d+)$/)
  return {
    calle: match ? match[1] : streetPart ?? null,
    numero: match ? match[2] : null,
    localidad: localidad ?? null,
    provincia: provincia ?? null,
    pais: 'Argentina',
  }
}
