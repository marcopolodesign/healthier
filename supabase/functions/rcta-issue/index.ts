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
//   simulacion     – true: emision de PRACTICA. Ver el bloque de abajo.
//
// ── Modo practica (`simulacion: true`) ───────────────────────────────────────
// La simulacion de videollamada (`src/lib/simulacion.js`) deja al profesional
// recorrer el recetario entero y recibir un PDF de verdad. Se emite SIEMPRE
// contra homologacion, aun corriendo en produccion: en homologacion la receta
// no es un acto medico valido —es el ambiente donde se certifico, con
// matriculas inventadas— y en produccion si lo seria.
//
// Que cambia respecto de una emision real, y nada mas que eso:
//   · los medicamentos vienen EN EL BODY (`medicamentos`), no de
//     `clinical_medications`: la practica no escribe ninguna fila;
//   · el paciente es el fijo de la practica, definido aca abajo;
//   · las credenciales salen de RCTA_HML_*, y si no estan cargadas se CORTA
//     con 503 en vez de caer en las de produccion;
//   · no se escribe `clinical_medications` ni `rcta_issue_log`.
// Todo lo demas —validaciones, armado del payload, llamada, reintento sin
// firma— es el MISMO codigo, que es justamente lo que hace que la practica
// sirva: si difiriera, ensenaria un flujo que no existe.
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

// El paciente de la practica. Espejo de `PACIENTE` en `src/lib/simulacion.js`
// (el front lo muestra, esta funcion lo imprime en el PDF). El DNI arranca con
// 99 —rango que no se asigna— para que nadie lo confunda con una persona.
const PACIENTE_DE_PRACTICA = {
  id: 'simulacion-paciente',
  full_name: 'Paciente de practica',
  dni: '99000001',
  gender: 'femenino',
  birth_date: '1985-03-14',
  phone: '+5491100000000',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const esPractica = body.simulacion === true
    // `medicationIds` es la forma nueva (varios medicamentos en una receta);
    // `medicationId` se mantiene porque hay clientes desplegados que la usan.
    const ids: string[] = Array.isArray(body.medicationIds) && body.medicationIds.length
      ? body.medicationIds
      : (body.medicationId ? [body.medicationId] : [])
    if (!esPractica && !ids.length) return json({ error: 'medicationId o medicationIds requerido' }, 400)
    if (esPractica && !Array.isArray(body.medicamentos)) {
      return json({ error: 'medicamentos requerido en modo practica' }, 400)
    }

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
      esPractica
        // La practica no tiene fila que marcar. Devuelve la misma forma
        // (`{ error }`) que el update real porque el camino de exito la lee.
        ? Promise.resolve({ error: null })
        : supabase.from('clinical_medications').update({ rcta_status: status, ...extra }).in('id', ids)

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
      // La practica no deja rastro en la auditoria: `rcta_issue_log` es el
      // registro de los actos medicos reales y mezclarlo con ensayos volveria
      // inutil justamente el uso que motivo la tabla (rearmar las pruebas de
      // certificacion). El profesional ve el error en pantalla igual.
      if (esPractica) return
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
    // En practica los medicamentos vienen en el body y el paciente es fijo; lo
    // unico que se lee de la base es el legajo REAL de quien practica, porque su
    // matricula y su especialidad son lo que sale impreso en el PDF y verlas ahi
    // es medio punto del ejercicio.
    const armarPractica = async () => {
      const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
      const { data: { user } } = await supabase.auth.getUser(jwt)
      if (!user) return { data: null, error: { message: 'Sesion invalida' } }

      const { data: quien, error: errQuien } = await supabase
        .from('profiles')
        .select(`id, full_name, dni, gender, birth_date, phone,
                 professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, address)`)
        .eq('id', user.id)
        .single()
      if (errQuien || !quien) return { data: null, error: errQuien ?? { message: 'Profesional no encontrado' } }

      const legajo = Array.isArray(quien.professional_profiles)
        ? quien.professional_profiles[0]
        : quien.professional_profiles

      // Los tres datos propios sin los cuales Innovamed rechaza. Se chequean
      // ACA y con nombre para que la practica no muera en un `QBI156 DEBE
      // INGRESAR EL NUMERO DE DOCUMENTO`, que no le dice a nadie que le falta
      // cargar su DNI. Es ademas el momento util para enterarse: mejor
      // descubrirlo practicando que con un paciente esperando.
      const faltan = [
        !quien.dni && 'tu DNI',
        !legajo?.license_number && 'tu número de matrícula',
        !legajo?.address && 'la dirección de tu consultorio',
      ].filter(Boolean)
      if (faltan.length) {
        return { data: null, error: {
          message: `Para emitir una receta te falta cargar ${faltan.join(', ')}. Completalo en tu perfil y volvé a probar.`,
          code: 'RCTA_PRACTICA_FALTAN_DATOS',
        } }
      }

      // Mismas claves que una fila de `clinical_medications` con sus joins: de
      // ahi para abajo el codigo es el mismo que el de una receta real.
      // deno-lint-ignore no-explicit-any
      const filas = body.medicamentos.map((m: any, i: number) => ({
        id: `practica-${i}`,
        rcta_status: 'draft',
        encounter_id: 'practica',
        patient_id: PACIENTE_DE_PRACTICA.id,
        professional_id: quien.id,
        reg_no: m.reg_no ?? m.regNo ?? null,
        medication_name: m.medication_name ?? m.nombreProducto ?? null,
        nombre_droga: m.nombre_droga ?? null,
        presentacion: m.presentacion ?? null,
        presentation: m.presentation ?? null,
        concentration: m.concentration ?? null,
        quantity: m.quantity ?? 1,
        is_chronic: !!m.is_chronic,
        dosage_text: m.dosage_text ?? null,
        frequency: m.frequency ?? null,
        notes: m.notes ?? null,
        cie10_code: m.cie10_code ?? null,
        cie10_display: m.cie10_display ?? null,
        professional_license_type: legajo?.license_type ?? null,
        professional_license_number: legajo?.license_number ?? null,
        patient: PACIENTE_DE_PRACTICA,
        professional: { ...quien, professional_profiles: legajo },
        // Particular: sin cobertura el payload omite `cobertura`, que es el
        // caso mas simple y el que ademas cubre la cuarta prueba de
        // certificacion de Innovamed.
        encounter: { consultation: { id: 'practica', coverage_type: 'particular', financiador_id: null, obra_social_name: null, affiliate_number: null } },
      }))
      return { data: filas, error: null }
    }

    const { data: meds, error: medErr } = esPractica ? await armarPractica() : await supabase
      .from('clinical_medications')
      .select(`
        *,
        patient:profiles!patient_id(
          id, full_name, dni, gender, birth_date, phone,
          coverage_type, financiador_id, insurance_name, insurance_num
        ),
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

    if (esPractica && medErr) {
      return await fallar('validation_error',
        { error: medErr.message, code: (medErr as { code?: string }).code ?? 'RCTA_PRACTICA_ERROR' }, 422)
    }
    if (medErr || !meds?.length) return await fallar('validation_error', { error: 'Medication not found' }, 404)
    if (!esPractica && meds.length !== ids.length) return await fallar('validation_error', { error: 'Alguna de las medicaciones no existe' }, 404)

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

    // Sólo recetan las especialidades marcadas en el catálogo (migración 116).
    // El trigger sobre `clinical_medications` ya frena la carga, pero esto se
    // chequea igual: las filas cargadas ANTES de la 116 siguen existiendo, y sin
    // este guard un profesional sin permiso podría emitirlas ahora.
    const { data: puedeRecetar, error: permErr } = await supabase
      .rpc('profesional_puede_recetar', { p_professional_id: meds[0].professional_id })
    if (permErr) return await fallar('server_error', { error: permErr.message }, 500)
    if (!puedeRecetar) {
      return await fallar('validation_error', {
        error: 'Tu especialidad no tiene habilitada la emisión de recetas en Healthier.',
        code: 'RCTA_ESPECIALIDAD_SIN_PERMISO',
      }, 403)
    }

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

    // La cobertura de la CONSULTA es la decisión del profesional para este acto:
    // si está cargada, manda. Cuando está en blanco no quiere decir "particular"
    // sino "nadie la tocó", y ahí vale la del paciente — que es justo lo que la
    // pantalla de recetario le viene mostrando al profesional ("OSDE · afiliado
    // …", precargado del perfil). Sin este respaldo esa precarga vivía sólo en
    // el estado del componente y se perdía salvo que el profesional abriera
    // "Cambiar" y guardara: la receta salía "Particulares / PLAN: No posee" para
    // un afiliado, contradiciendo lo que la pantalla decía. Pasó en vivo el
    // 2026-09-10 con un paciente de OSDE.
    //
    // El respaldo se toma sólo si está COMPLETO (id de catálogo + afiliado): un
    // perfil a medias tiene que seguir emitiendo como hasta ahora en vez de
    // frenar la receta con los guards de acá abajo.
    const perfilCompleto = med.patient?.coverage_type === 'financiador'
      && med.patient?.financiador_id
      && String(med.patient?.insurance_num ?? '').trim()
    const cob = consulta?.coverage_type == null && perfilCompleto
      ? {
          coverage_type: 'financiador',
          financiador_id: med.patient.financiador_id,
          affiliate_number: med.patient.insurance_num,
        }
      : consulta

    const cobertura = cob?.coverage_type === 'financiador' && cob?.financiador_id
      ? {
          idFinanciador: String(cob.financiador_id),
          numero: String(cob.affiliate_number ?? '').trim(),
        }
      : null

    if (cob?.coverage_type === 'financiador' && !cob?.financiador_id) {
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
    // En practica se emite SIEMPRE contra homologacion. Si este deployment ya
    // ES homologacion (staging), las de siempre sirven; si no —produccion— hacen
    // falta las RCTA_HML_*, y si no estan se corta. Nunca se cae a las de
    // produccion: seria emitir una receta legalmente valida en un ensayo.
    const esHomologacion = (Deno.env.get('RCTA_API_URL') ?? '').includes('hml.')
    const RCTA_API_URL = esPractica && !esHomologacion
      ? Deno.env.get('RCTA_HML_API_URL')
      : Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = esPractica && !esHomologacion
      ? Deno.env.get('RCTA_HML_API_KEY')
      : Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = esPractica && !esHomologacion
      ? Deno.env.get('RCTA_HML_CLIENT_APP_ID')
      : Deno.env.get('RCTA_CLIENT_APP_ID')

    if (esPractica && !esHomologacion && !(RCTA_API_URL && RCTA_API_KEY && RCTA_CLIENT_APP_ID)) {
      return await fallar('validation_error', {
        error: 'La receta de práctica todavía no está habilitada. Contactá al equipo de Healthier.',
        code: 'RCTA_PRACTICA_NO_CONFIGURADA',
        instructions: 'Cargar RCTA_HML_API_URL + RCTA_HML_API_KEY + RCTA_HML_CLIENT_APP_ID en los secrets de este proyecto (las de homologación, nunca las de producción).',
      }, 503)
    }

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

    // ── El logo YA NO VIAJA EN EL PAYLOAD (2026-09-11) ────────────────────────
    // Hasta hoy se mandaba en `subemisor.logoBase64`, y NUNCA se imprimio:
    // Innovamed contestaba `400 QBI147 DEBE INGRESAR NOMBRE, CUIT Y DIRECCION
    // DEL SUBEMISOR` —mandabamos el subemisor con el logo y sin identificarlo—
    // y el reintento de abajo salvaba la emision sacandolo. O sea que el logo
    // se rechazaba en silencio en todas las recetas. No se vio nunca porque
    // hasta el 2026-09-11 no se habia emitido ninguna receta real.
    //
    // `subemisor` ademas nunca fue el campo correcto: el contrato dice que es
    // "una organizacion que esta usando el cliente app para prescribir, por ej.
    // una sucursal de una cadena de clinicas". Healthier ES el cliente app.
    //
    // El mecanismo correcto es registrar el logo UNA vez por ambiente contra
    // `POST /apirecipe/admin/Logo` — ver `scripts/registrar-logo-receta.mjs`.
    // Verificado emitiendo contra homologacion: el logo sale arriba al centro,
    // a color, sin `subemisor` en el payload.

    // La firma olografa del profesional (migracion 154). Se resuelve con el
    // mismo criterio que el logo: si no la cargo, o si leerla falla, la clave se
    // OMITE y la receta sale igual que antes, con la linea de puno vacia. Mateo
    // la definio OPCIONAL el 2026-09-11 — no bloquea la emision.
    const firmabase64 = await resolverFirma(supabase, meds[0].professional_id)
    ctx.con_firma = !!firmabase64

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
        // La firma se imprime sobre la linea de puno del bloque "FIRMA Y SELLO".
        // Va el base64 CRUDO: con un `data:image/png;base64,` adelante Innovamed
        // contesta 200 y no imprime nada — falla en silencio, que es peor que
        // fallar. `firmalink` (la variante por URL del mismo contrato) tampoco
        // funciona: se probo contra el preview el 2026-09-11 y no dibuja nada.
        // El sello (las tres lineas de abajo: nombre, especialidad y matricula)
        // NO se manda a proposito — la plantilla ya las imprime sola con los
        // datos que van en `medico`, y mandar `sello` las PISA, o sea que seria
        // una segunda fuente de verdad para lo mismo.
        ...(firmabase64 ? { firmabase64 } : {}),
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
      // Sin `subemisor`: el logo de Healthier se registra una vez por ambiente
      // contra /admin/Logo, no se manda en cada receta. Ver el bloque de arriba.
    }

    // ── Call QBI2 API ─────────────────────────────────────────────────────────
    // La red se atrapa dentro de `postReceta` y no en el catch de afuera, que
    // no alcanza a `registrar`: un timeout contra Innovamed tiene que dejar
    // rastro igual que un rechazo suyo — si no, el caso mas dificil de
    // diagnosticar es el unico que no queda escrito.
    ctx.request = payload
    let result = await postReceta(RCTA_API_URL, RCTA_API_KEY, payload)

    if (result.kind === 'network_error') {
      // Ambiguo: no sabemos si Innovamed llego a recibir este request.
      // NUNCA se reintenta a partir de un error de red — reintentar podria
      // duplicar una receta electronica ya creada del otro lado, que es un
      // acto medico legal. Se propaga el error tal cual, como antes.
      console.error('rcta-issue: no se pudo contactar a Innovamed:', String(result.err))
      await setStatus('error')
      return await fallar('network_error', {
        error: 'No se pudo contactar al servicio de recetas. Reintentá en un momento.',
        code: 'RCTA_SIN_RESPUESTA',
        detail: String(result.err),
      }, 504)
    }

    if (result.kind === 'rejected') {
      console.error('RCTA API error:', result.status, result.body)

      // Reintento UNICO sin la firma, y SOLO ante esto: un rechazo
      // definitivo de Innovamed, acotado a 4xx. Un 4xx es una negativa a
      // PROCESAR el request (validacion/contrato/payload) — prueba
      // razonable de que no se creo nada. Un 5xx es un fallo del LADO DE
      // ELLOS con resultado desconocido: pudo fallar validando (nada
      // creado) o pudo fallar recien al armar la respuesta DESPUES de
      // crear la receta — reintentar ahi arriesga exactamente lo mismo que
      // un network_error (emitir una segunda receta legalmente valida), asi
      // que un 5xx se propaga sin reintentar, igual que un network_error.
      // Encaja ademas con la causa que motiva el reintento: si a Innovamed no
      // le gusta una imagen que le mandamos, contesta 400, no 500.
      //
      // La unica imagen que viaja en el payload es la firma del profesional
      // (el logo se registra aparte, contra /admin/Logo). Una receta sin la
      // firma dibujada le sirve al paciente infinitamente mas que un 502: es
      // valida igual, la firma electronica la aplica Innovamed.
      //
      // 🔴 Este reintento NO es una red de seguridad de la que se pueda vivir.
      // Entre agosto y el 2026-09-11 tapo que el logo se rechazaba SIEMPRE
      // (`QBI147`, subemisor sin nombre/cuit/direccion) y nadie se entero,
      // porque la emision terminaba bien. Si `reintento` empieza a aparecer
      // seguido en `rcta_issue_log`, hay algo roto que hay que arreglar — no
      // es ruido.
      const esRechazoDe4xx = result.status >= 400 && result.status < 500
      if (firmabase64 && esRechazoDe4xx) {
        console.error(`rcta-issue: rechazo con la firma puesta (status ${result.status}), reintentando UNA vez sin firma`)
        const { firmabase64: _sinFirma, ...medicoSinFirma } = payload.medico
        const payloadSinFirma = { ...payload, medico: medicoSinFirma }
        ctx.reintento = { sin_firma: true }
        const retryResult = await postReceta(RCTA_API_URL, RCTA_API_KEY, payloadSinFirma)

        if (retryResult.kind === 'ok') {
          console.error(`rcta-issue: receta emitida SIN FIRMA tras reintento — Innovamed rechazó "medico.firmabase64" (status original ${result.status}: ${result.body}). Revisar el formato antes de que se vuelva la norma.`)
          // Se guarda el rechazo original completo en el log de la emision
          // EXITOSA: es la unica fila que va a quedar escrita para este
          // intento (el rechazo con logo nunca se registra por separado), y
          // es justamente el dato que hace falta para diagnosticar sin
          // adivinar.
          ctx.reintento = {
            ...ctx.reintento,
            firma_rechazada: true,
            rechazo_status: result.status,
            rechazo_detalle: result.body,
          }
          ctx.request = payloadSinFirma
          result = retryResult
          // sigue mas abajo — a esta altura `result.kind === 'ok'`
        } else if (retryResult.kind === 'network_error') {
          // Tambien ambiguo — no hay un tercer intento. Se propaga el
          // rechazo ORIGINAL (con logo), que es la unica certeza real: esa
          // receta puntual, sabemos con seguridad, no se creo.
          console.error('rcta-issue: reintento sin firma tambien fallo de red, no se reintenta de nuevo:', String(retryResult.err))
          await setStatus('error')
          ctx.reintento = { ...ctx.reintento, error_de_red: String(retryResult.err) }
          return await fallar('api_error', { error: 'RCTA API error', status: result.status, detail: result.body }, 502,
            { response: result.json ?? { raw: result.body }, error_code: result.json?.error ?? null })
        } else {
          // Rechazado tambien sin la firma — no era la causa real.
          console.error('RCTA API error (reintento sin firma tambien rechazado):', retryResult.status, retryResult.body)
          await setStatus('error')
          ctx.reintento = { ...ctx.reintento, rechazo_status: retryResult.status, rechazo_detalle: retryResult.body }
          return await fallar('api_error', { error: 'RCTA API error', status: result.status, detail: result.body }, 502,
            { response: result.json ?? { raw: result.body }, error_code: result.json?.error ?? null })
        }
      } else {
        // Aca caen dos casos, sin reintento en ninguno: (1) no habia firma
        // en el payload, nada que sacar; (2) SI habia pero el rechazo fue
        // 5xx — resultado desconocido del lado de Innovamed, no se reintenta
        // (ver el comentario de arriba).
        await setStatus('error')
        // Innovamed manda su codigo (QBI212, QBI105...) tambien en los 4xx, pero
        // como `MensajeInvalidoResponse` y no como `errores[]`. Se rescata para
        // que el log se pueda filtrar por codigo sin abrir el JSON a mano.
        return await fallar('api_error', { error: 'RCTA API error', status: result.status, detail: result.body }, 502,
          { response: result.json ?? { raw: result.body }, error_code: result.json?.error ?? null })
      }
    }

    // Defensivo: a esta altura `result.kind` tiene que ser 'ok' — exito
    // directo, o exito del reintento sin logo reasignado arriba. Cualquier
    // otro caso ya devolvio la respuesta antes de llegar aca.
    if (result.kind !== 'ok') {
      console.error('rcta-issue: estado inesperado post-reintento', result)
      await setStatus('error')
      return await fallar('api_error', { error: 'RCTA API error inesperado' }, 502)
    }

    ctx.http_status = result.status
    const rctaData = result.data
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
    // En practica no: le avisaria a una farmacia que hay un pedido posible para
    // un paciente que no existe.
    if (!esPractica) {
      // deno-lint-ignore no-explicit-any
      for (const m of meds as any[]) {
        await notifyPharmacyMatch(supabase, m).catch(err => console.error('pharmacy match failed:', err))
      }
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

// Firma olografa del profesional (migracion 154), para `medico.firmabase64`.
//
// NUNCA puede tumbar una emision: si el profesional no cargo firma, si la
// lectura falla o si lo guardado esta truncado, devuelve `null` y quien la
// llama omite la clave del payload — la receta sale
// como salia antes, con la linea de puno vacia. Mateo la definio opcional a
// proposito (2026-09-11): bloquear la emision por una firma faltante dejaria a
// un paciente sin su receta en medio de la consulta.
//
// Se lee con el cliente de service role, que se saltea la RLS: la unica policy
// de `professional_signatures` es "sos vos mismo", y aca no hay sesion del
// profesional sino la de la funcion.
//
// El `replace` del prefijo `data:` es defensivo y NO redundante: el front ya
// guarda el base64 pelado, pero si alguna vez se cuela el data-URL Innovamed
// contesta 200 y no dibuja nada — una receta sin firma y sin error, que es la
// falla mas cara de encontrar.
async function resolverFirma(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  professionalId: string | null | undefined,
): Promise<string | null> {
  try {
    if (!professionalId) return null
    const { data, error } = await supabase
      .from('professional_signatures')
      .select('firma_png')
      .eq('user_id', professionalId)
      .maybeSingle()
    if (error) {
      console.error('rcta-issue: firma omitida del payload — error al leerla:', error.message)
      return null
    }
    const crudo = String(data?.firma_png ?? '').replace(/^data:image\/\w+;base64,/, '').trim()
    if (crudo.length < 100) {
      if (crudo.length) console.error('rcta-issue: firma omitida del payload — guardada vacía o truncada')
      return null
    }
    return crudo
  } catch (err) {
    console.error('rcta-issue: firma omitida del payload — error al resolverla:', String(err))
    return null
  }
}

// Resultado tipado de una llamada a POST /apirecipe/Receta. Un solo tipo
// para el intento original y el reintento sin firma (ver el bloque de
// reintento en el handler principal): evita que las dos llamadas diverjan en
// como arman el request o parsean la respuesta.
type RctaCallResult =
  | { kind: 'network_error'; err: unknown }
  // deno-lint-ignore no-explicit-any
  | { kind: 'rejected'; status: number; body: string; json: any }
  // deno-lint-ignore no-explicit-any
  | { kind: 'ok'; status: number; data: any }

async function postReceta(url: string, apiKey: string, body: Record<string, unknown>): Promise<RctaCallResult> {
  let res: Response
  try {
    res = await fetch(`${url}/apirecipe/Receta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Ambiguo: no sabemos si Innovamed llego a recibir el request. El
    // llamador NUNCA reintenta a partir de esto — ver el bloque de
    // reintento en el handler principal.
    return { kind: 'network_error', err }
  }
  if (!res.ok) {
    const text = await res.text()
    // deno-lint-ignore no-explicit-any
    let errJson: any = null
    try { errJson = JSON.parse(text) } catch { /* no siempre es JSON */ }
    return { kind: 'rejected', status: res.status, body: text, json: errJson }
  }
  const data = await res.json()
  return { kind: 'ok', status: res.status, data }
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
