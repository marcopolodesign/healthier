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
// Para emitir hace falta que el profesional tenga cargada su firma olografa
// (`professional_signatures`, migracion 154). Sin ella se corta con 422
// `RCTA_FIRMA_FALTANTE` — ver el bloque donde se resuelve.
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
import {
  accionPdfAviso, armarMedico, armarPaciente, asignarRecetas, domicilioDe, etiquetaEspecialidad,
  leerEmision, llamarRcta, matriculaDe, problemaDeMatricula, resolverFirma,
  type Autorizacion, type RecetaEmitida,
} from '../_shared/rcta/mod.ts'

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
    // Tratamiento prolongado (Mateo, 2026-10-22): cuántas recetas en total, 1 a
    // 3 — la primera vale desde hoy y cada posdatada 30 días después de la
    // anterior. Ver el bloque "Recetas posdatadas" más abajo.
    const recetasTotales = Math.min(3, Math.max(1, Number.parseInt(String(body.recetas ?? 1), 10) || 1))
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
        .select(`id, full_name, first_name, last_name, dni, gender, birth_date, phone,
                 professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, license_province, address)`)
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
      // La firma entra en la misma lista que el DNI y la matricula: es
      // obligatoria para emitir, y la practica existe justamente para que el
      // profesional se entere de lo que le falta ANTES de tener un paciente
      // adelante.
      const tieneFirma = !!(await resolverFirma(supabase, quien.id))
      const faltan = [
        !quien.dni && 'tu DNI',
        !legajo?.license_number && 'tu número de matrícula',
        !legajo?.address && 'la dirección de tu consultorio',
        !tieneFirma && 'tu firma',
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
          id, full_name, first_name, last_name, dni, gender, birth_date, phone,
          coverage_type, financiador_id, insurance_name, insurance_num
        ),
        professional:profiles!professional_id(
          id, full_name, first_name, last_name, dni, gender, birth_date, phone,
          professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, license_province, address)
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

    // 🔴 Sólo emite el profesional que prescribió (2026-10-22). Antes la función
    // cargaba los medicamentos con la service key y emitía sin mirar quién
    // llamaba: cualquier sesión —un paciente leyendo sus propias filas sin
    // emitir— podía disparar una receta real con la matrícula y la firma del
    // médico, y después comprarla en la farmacia. El único que la llama es
    // PrescriptionCreator, con la sesión del profesional.
    // La service key también pasa: la usa scripts/rcta-certificacion.mjs. Se
    // mira el claim `role` del JWT, que ya verificó la firma el gateway
    // (verify_jwt = true para esta función): comparar contra la variable de
    // entorno no sirve, porque la que inyecta Supabase no es la misma cadena.
    const jwtLlamada = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const rolLlamada = (() => {
      try { return JSON.parse(atob(jwtLlamada.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return null }
    })()
    if (!esPractica && rolLlamada !== 'service_role') {
      const { data: { user: quienLlama } } = await supabase.auth.getUser(jwtLlamada)
      const prescriptores = new Set(meds.map((m: { professional_id: string }) => m.professional_id))
      if (!quienLlama || prescriptores.size !== 1 || !prescriptores.has(quienLlama.id)) {
        return await fallar('validation_error', {
          error: 'Sólo el profesional que hizo la receta puede emitirla.',
          code: 'RCTA_NO_ES_EL_PRESCRIPTOR',
        }, 403)
      }
    }

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
    // Una receta anulada (migración 216) o una medicación suspendida no se
    // vuelve a emitir desde la misma fila: si el tratamiento sigue, es una
    // prescripción nueva.
    if (!esPractica && meds.some((m: { rcta_status: string; status: string }) => m.rcta_status === 'anulada' || m.status !== 'active')) {
      return await fallar('validation_error', {
        error: 'Esta medicación está anulada o suspendida. Cargala de nuevo para emitir otra receta.',
        code: 'RCTA_ANULADA',
      }, 409)
    }

    // ── Recetas posdatadas ───────────────────────────────────────────────────
    // Sólo para tratamiento prolongado y NUNCA para un controlado: psicotrópicos
    // y antimicrobianos van con receta archivada, una por dispensa (Ley 19.303
    // art. 14, Ley 27.680). La lista de controlados es la misma que usa la
    // farmacia (`farmacia_drogas_bajo_receta`, migración 214).
    const fechasPosdatadas: string[] = []   // DD/MM/AAAA, hora argentina
    if (recetasTotales > 1) {
      // deno-lint-ignore no-explicit-any
      const noCronicos = meds.filter((m: any) => !m.is_chronic)
      if (noCronicos.length) {
        return await fallar('validation_error', {
          error: 'Las recetas posdatadas son sólo para medicación crónica.',
          code: 'RCTA_POSDATADAS_NO_CRONICA',
        }, 422)
      }
      // De a un medicamento: con varios, Innovamed puede repartirlos en más de
      // una receta por fecha y no habría forma segura de saber cuál es cuál.
      if (meds.length !== 1) {
        return await fallar('validation_error', {
          error: 'Las recetas posdatadas se emiten de a un medicamento.',
          code: 'RCTA_POSDATADAS_UN_MEDICAMENTO',
        }, 422)
      }
      // El mismo "¿es controlado?" que usa la farmacia (migración 214).
      const m0 = meds[0]
      const { data: esControlado, error: ctrlErr } = await supabase.rpc('farmacia_texto_es_controlado', {
        p_texto: [m0.medication_name, m0.nombre_droga, m0.presentacion, m0.presentation, m0.concentration].filter(Boolean).join(' '),
      })
      if (ctrlErr) return await fallar('server_error', { error: ctrlErr.message }, 500)
      const controlado = esControlado ? m0 : null
      if (controlado) {
        return await fallar('validation_error', {
          error: `${controlado.medication_name} es controlado: no admite recetas posdatadas.`,
          code: 'RCTA_POSDATADAS_CONTROLADO',
        }, 422)
      }
      // Hoy en Argentina, +30 y +60 días.
      const hoyAr = new Date(Date.now() - 3 * 3600 * 1000)
      for (let k = 1; k < recetasTotales; k++) {
        const d = new Date(Date.UTC(hoyAr.getUTCFullYear(), hoyAr.getUTCMonth(), hoyAr.getUTCDate() + 30 * k))
        fechasPosdatadas.push(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`)
      }
    }

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

    // ── La matrícula ──────────────────────────────────────────────────────────
    // La provincia de una MP vive en el legajo (`license_province`, migración
    // 223) y se manda si está; si falta se emite igual (Mateo, 2026-11-02: se
    // pide sin bloquear). Tipo y número, de la foto guardada con la medicación.
    const legajo = med.professional?.professional_profiles ?? {}
    const matricula = matriculaDe(legajo, { tipo: med.professional_license_type, numero: med.professional_license_number })
    const faltaMatricula = problemaDeMatricula(matricula)
    if (faltaMatricula) return await fallar('validation_error', faltaMatricula, 422)

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
    // `POST /admin/v1/logo` — ver `scripts/registrar-logo-receta.mjs`.
    // Verificado emitiendo contra homologacion: el logo sale arriba al centro,
    // a color, sin `subemisor` en el payload.

    // ── La firma olografa del profesional (migracion 154) ────────────────────
    // OBLIGATORIA desde el 2026-09-11 (Mateo): sin firma cargada no se emite.
    // Arranco siendo opcional ese mismo dia y lo cambio.
    //
    // El corte va ACA y no mas abajo por dos motivos. Uno: si se dejara pasar,
    // la receta saldria con el renglon de puno vacio y eso es justamente lo que
    // se quiso arreglar. Dos: es un 422 con un mensaje que dice que hacer, en
    // vez de un rechazo de Innovamed que el profesional no puede interpretar.
    //
    // El front tambien apaga el boton (`useFirmaDelProfesional`), pero eso es
    // cortesia: un cliente viejo desplegado, o la pestana abierta desde antes,
    // llegan igual hasta aca.
    //
    // `resolverFirma` nunca tira: ante un error de lectura devuelve `null`, o
    // sea que un fallo de la base se presenta como "te falta la firma". Es el
    // lado seguro para equivocarse — la alternativa seria emitir una receta sin
    // firma por un error nuestro, y una receta emitida no se deshace.
    const firmabase64 = await resolverFirma(supabase, meds[0].professional_id)
    ctx.con_firma = !!firmabase64
    if (!firmabase64) {
      await setStatus('error')
      return await fallar('validation_error', {
        error: 'Para emitir la receta necesitás cargar tu firma. Se hace una sola vez y queda para todas: entrá a Configuración → Firma, o firmá desde el mismo recetario.',
        code: 'RCTA_FIRMA_FALTANTE',
      }, 422)
    }

    // El bloque `medico` sale del módulo compartido (`_shared/rcta`), igual que
    // para las Otras Prescripciones: matrícula con provincia si es MP,
    // `profesion` y la especialidad con su nombre legible ("Medicina General",
    // no `medicina_general`, que el PDF imprimía tal cual).
    const especialidadLabel = await etiquetaEspecialidad(supabase, legajo.specialty)
    const medico = armarMedico(med.professional, legajo, especialidadLabel, firmabase64, { matricula })
    // El consultorio: `calle` + `numero` reales, o `direccion` sola (QBI240 /
    // QBI241). Ver `domicilioDe` — el parseo viejo mandaba "3709" como calle.
    const domicilio = domicilioDe(legajo.address)
    const nombreConsultorio = medico.apellido ? `Consultorio Dr. ${medico.apellido}`.slice(0, 100) : null

    const payload = {
      clienteAppId: Number(RCTA_CLIENT_APP_ID),
      // Las posdatadas: además de la de hoy, una receta por cada fecha.
      ...(fechasPosdatadas.length ? {
        recetasPostadatas: { cantidad: fechasPosdatadas.length, diasAPosdatar: 30, fechas: fechasPosdatadas },
      } : {}),
      diagnostico: med.cie10_display ?? med.cie10_code ?? null,
      // Una receta, N medicamentos. Innovamed puede repartirlos en mas de una
      // receta segun sus propias reglas (lo informa en `accionPDF`): abajo cada
      // medicación se guarda con la receta que efectivamente la contiene.
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
      paciente: armarPaciente(med.patient, cobertura),
      medico,
      // deno-lint-ignore no-explicit-any
      indicaciones: meds.map((m: any) => m.notes).filter(Boolean).join(' · ') || null,
      // QBI248 ("DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN").
      // `nombreConsultorio` no se imprime (wiki) pero el contrato lo acepta.
      ...(domicilio ? { lugarAtencion: { ...(nombreConsultorio ? { nombreConsultorio } : {}), domicilio } } : {}),
      // Sin `subemisor`: el logo de Healthier se registra una vez por ambiente
      // contra /admin/v1/logo, no se manda en cada receta. Ver el bloque de arriba.
    }

    // ── Call QBI2 API ─────────────────────────────────────────────────────────
    // La red se atrapa dentro de `llamarRcta` y no en el catch de afuera, que
    // no alcanza a `registrar`: un timeout contra Innovamed tiene que dejar
    // rastro igual que un rechazo suyo — si no, el caso mas dificil de
    // diagnosticar es el unico que no queda escrito.
    ctx.request = payload
    let result = await llamarRcta('POST', RCTA_API_URL, RCTA_API_KEY, '/apirecipe/Receta', payload)

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
      // (el logo se registra aparte, contra /admin/v1/logo). Una receta sin la
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
        const retryResult = await llamarRcta('POST', RCTA_API_URL, RCTA_API_KEY, '/apirecipe/Receta', payloadSinFirma)

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
    ctx.response = rctaData
    const emision = leerEmision(rctaData)
    ctx.id_transaccion = emision.idTransaccion

    // Con posdatadas vienen varias: la de hoy y una por fecha. Se ubica cada una
    // por su fecha, sin adivinar por orden: guardar la receta de hoy como la de
    // dentro de 60 días haría vender con una receta vencida.
    const posdatadasDevueltas = fechasPosdatadas.map((f) => {
      const conEsaFecha = emision.recetas.filter(r => fechaArgentina(r.fecha) === f)
      return conEsaFecha.length === 1 ? conEsaFecha[0] : null
    })
    const principales = emision.recetas.filter(r => !posdatadasDevueltas.includes(r))
    const motivos = emision.errores.map(e => e.mensaje).filter(Boolean).join(' · ')

    // Nada salió: es un rechazo, aunque haya venido con 200.
    if (!principales.length) {
      console.error('rcta-issue: el servicio no devolvió ninguna receta', JSON.stringify(rctaData))
      await setStatus('error', { rcta_error_detalle: motivos || null })
      return await fallar('api_error', {
        error: motivos ? `El servicio de recetas no emitió la receta: ${motivos}` : 'El servicio de recetas no devolvió ninguna receta.',
        code: 'RCTA_SIN_RECETAS',
        detail: rctaData?.errores ?? rctaData,
      }, 502, { errores: rctaData?.errores ?? null, error_code: emision.errores[0]?.error ?? null })
    }

    // ── Errores parciales (wiki, "split de prescripciones") ───────────────────
    // Cada receta del lote sale o falla por separado. Lo que salió se guarda y
    // queda emitido —reintentarlo la duplicaría—; lo que falló queda en error con
    // su motivo. Con posdatadas hay un solo medicamento y ya salió la de hoy: los
    // errores son de las posdatadas y se cuentan abajo como faltantes.
    // deno-lint-ignore no-explicit-any
    const asignacion = asignarRecetas({ ...emision, recetas: principales, errores: fechasPosdatadas.length ? [] : emision.errores }, meds as any[])
    if (emision.errores.length) {
      console.error('rcta-issue: lote con errores parciales', JSON.stringify(emision.errores))
      ctx.errores = rctaData?.errores ?? null
      ctx.error_code = emision.errores[0]?.error ?? null
    }

    const primera = principales[0]
    const prescriptionId = primera.idReceta
    const pdfUrl = primera.s3Link
    const issuedAt = aIso(primera.fecha)
    ctx.id_receta   = prescriptionId
    ctx.verificador = primera.verificador
    ctx.nro_cuir    = primera.nroCUIR
    ctx.s3_link     = pdfUrl
    // Queda registrado que devolvio Innovamed: cuando la persistencia falla, esto
    // es lo unico que permite recuperar una receta que ya existe del otro lado.
    console.log('rcta-issue: recetas recibidas', JSON.stringify(principales))

    // ── Persist result ────────────────────────────────────────────────────────
    // Cada medicación con SU receta (normalmente la misma para todas). Esta
    // escritura NO puede fallar en silencio: el 2026-07-31 falló con 22008 por
    // la fecha en DD/MM/AAAA y la función igual devolvía 200. Si falla se
    // reintenta sin la fecha, que es el campo con formato ajeno.
    const persistirEmitida = async (medId: string, recetas: RecetaEmitida[]) => {
      if (esPractica) return null
      const r0 = recetas[0]
      const datos = {
        rcta_status:          'issued',
        // La original vale desde hoy: nada de fechas de inicio heredadas.
        vigencia_desde:       null,
        posdatada_de:         null,
        rcta_prescription_id: r0.idReceta,
        rcta_transaction_id:  emision.idTransaccion,
        rcta_verificador:     r0.verificador,
        rcta_pdf_url:         r0.s3Link,
        rcta_issued_at:       aIso(r0.fecha),
        // El identificador con el que se anula (migración 216): el `id`, no el idReceta.
        rcta_hash:            r0.id,
        // Migración 223: todas las recetas que contienen esta medicación (cada
        // una se anula por separado) y si alguna quedó pendiente de autorización.
        rcta_recetas:         recetas.map(resumenReceta),
        rcta_autorizacion:    autorizacionDeLasRecetas(recetas),
        rcta_error_detalle:   null,
      }
      const { error } = await supabase.from('clinical_medications').update(datos).eq('id', medId)
      if (!error) return null
      console.error('rcta-issue: la receta se emitio pero no se pudo guardar:', error.message)
      const { rcta_issued_at: _f, vigencia_desde: _v, posdatada_de: _p, ...sinFecha } = datos
      const { error: reintentoErr } = await supabase.from('clinical_medications').update(sinFecha).eq('id', medId)
      if (reintentoErr) console.error('rcta-issue: reintento sin fecha tambien fallo:', reintentoErr.message)
      return reintentoErr ? error.message : null
    }

    const sinPersistir: { medicationId: string; detalle: string }[] = []
    for (const [medId, recetas] of asignacion.recetasDe) {
      const fallo = await persistirEmitida(medId, recetas)
      if (fallo) sinPersistir.push({ medicationId: medId, detalle: fallo })
    }
    // Lo que no salió, con su motivo. Lo que no se sabe si salió, con un motivo
    // que dice que NO se reemita a ciegas.
    const SIN_UBICAR = 'El servicio de recetas informó un error en el lote y no se pudo confirmar si este medicamento salió. Revisá las recetas emitidas antes de volver a emitirlo.'
    if (!esPractica) {
      for (const [medId, err] of asignacion.fallidas) {
        await supabase.from('clinical_medications')
          .update({ rcta_status: 'error', rcta_error_detalle: err.mensaje ?? err.error ?? 'No se emitió.' }).eq('id', medId)
      }
      if (asignacion.sinUbicar.length) {
        await supabase.from('clinical_medications')
          .update({ rcta_status: 'error', rcta_error_detalle: SIN_UBICAR }).in('id', asignacion.sinUbicar)
      }
    }

    if (sinPersistir.length) {
      // Sacar la fila de `pending`: un renglon en "Emitiendo..." para siempre es
      // peor que uno en error, porque no invita a revisar. El log igual queda con
      // idReceta e idTransaccion para recuperar la receta del otro lado.
      await supabase.from('clinical_medications').update({ rcta_status: 'error' }).in('id', sinPersistir.map(s => s.medicationId))
      return await fallar('persist_error', {
        error: 'La receta se emitió pero no se pudo guardar en Healthier. Anotá el número y avisá a soporte.',
        code: 'RCTA_EMITIDA_SIN_PERSISTIR',
        prescriptionId,
        pdfUrl,
        detail: sinPersistir.map(s => s.detalle).join(' · '),
      }, 500)
    }

    // ── Recetas posdatadas: una fila por medicamento y por fecha ───────────────
    // Cada posdatada es una receta propia (su idReceta, PDF y verificador) que
    // la farmacia habilita recién desde su fecha. Se guardan como filas nuevas
    // de `clinical_medications` apuntando a la original (`posdatada_de`), con
    // la service key: el trigger de la 214 no deja que nadie más las escriba.
    // Si Innovamed devolvió menos recetas que las pedidas, se guarda lo que
    // vino y se avisa: las que faltan no existen y no se inventan.
    const posdatadasGuardadas: { fecha: string; prescriptionId: string | null; pdfUrl: string | null; autorizacion: string | null }[] = []
    const posdatadasSinGuardar: { fecha: string; idReceta: string | null; motivo: string }[] = []
    if (fechasPosdatadas.length) {
      for (let k = 0; k < fechasPosdatadas.length; k++) {
        const r = posdatadasDevueltas[k]
        if (!r) {
          console.error(`rcta-issue: no se pudo ubicar la posdatada del ${fechasPosdatadas[k]} en la respuesta`, JSON.stringify(emision.recetas))
          posdatadasSinGuardar.push({ fecha: fechasPosdatadas[k], idReceta: null, motivo: motivos || 'no_ubicada' })
          continue
        }
        const [dd, mm, aaaa] = fechasPosdatadas[k].split('/')
        const guardada = { fecha: fechasPosdatadas[k], prescriptionId: r.idReceta, pdfUrl: r.s3Link, autorizacion: r.autorizacion }
        if (esPractica) { posdatadasGuardadas.push(guardada); continue }
        // deno-lint-ignore no-explicit-any
        const filas = (meds as any[]).map(({ id, created_at, patient: _p, professional: _pr, encounter: _e,
          rcta_status: _s, rcta_prescription_id: _rp, rcta_transaction_id: _rt, rcta_verificador: _rv,
          rcta_pdf_url: _ru, rcta_issued_at: _ri, rcta_recetas: _rr, rcta_autorizacion: _ra, rcta_error_detalle: _re,
          ...resto }) => ({
          ...resto,
          posdatada_de: id,
          vigencia_desde: `${aaaa}-${mm}-${dd}`,
          rcta_status: 'issued',
          rcta_prescription_id: r.idReceta,
          rcta_transaction_id: emision.idTransaccion,
          rcta_verificador: r.verificador,
          rcta_pdf_url: r.s3Link,
          rcta_issued_at: issuedAt,
          rcta_hash: r.id,
          rcta_recetas: [resumenReceta(r)],
          rcta_autorizacion: autorizacionDeLasRecetas([r]),
          aviso_habilitada_at: null,
        }))
        const { error: posErr } = await supabase.from('clinical_medications').insert(filas)
        if (posErr) {
          console.error(`rcta-issue: la posdatada del ${fechasPosdatadas[k]} se emitió pero no se pudo guardar:`, posErr.message, JSON.stringify(r))
          posdatadasSinGuardar.push({ fecha: fechasPosdatadas[k], idReceta: guardada.prescriptionId, motivo: posErr.message })
        } else {
          posdatadasGuardadas.push(guardada)
        }
      }
      if (posdatadasSinGuardar.length) ctx.response = { ...rctaData, healthier_posdatadas_sin_guardar: posdatadasSinGuardar }
    }

    // ── Pharmacy stock match + patient notification (best-effort — a failure here
    // must never fail the RCTA response, the prescription was already issued) ──
    // En practica no: le avisaria a una farmacia que hay un pedido posible para
    // un paciente que no existe. Tampoco con una pendiente de autorización: la
    // farmacia todavía no la puede vender.
    if (!esPractica) {
      // deno-lint-ignore no-explicit-any
      for (const m of meds as any[]) {
        const suyas = asignacion.recetasDe.get(m.id)
        if (!suyas || autorizacionDeLasRecetas(suyas) === 'pendiente') continue
        await notifyPharmacyMatch(supabase, m).catch(err => console.error('pharmacy match failed:', err))
      }
    }

    // deno-lint-ignore no-explicit-any
    const nombreDe = (id: string) => (meds as any[]).find(m => m.id === id)?.medication_name ?? null
    const fallidas = [...asignacion.fallidas].map(([medicationId, err]) => ({
      medicationId, nombre: nombreDe(medicationId), mensaje: err.mensaje ?? err.error ?? null,
    }))
    const parcial = fallidas.length > 0 || asignacion.sinUbicar.length > 0
    await registrar(parcial ? 'issued_partial' : 'issued')

    return json({
      prescriptionId,
      transactionId: emision.idTransaccion,
      verificador: primera.verificador,
      pdfUrl,
      issuedAt,
      medicationIds: ids,
      // Lo nuevo (2026-11-02): el detalle del lote.
      emitidas: [...asignacion.recetasDe.keys()],
      recetas: principales.map(r => ({ prescriptionId: r.idReceta, pdfUrl: r.s3Link, autorizacion: r.autorizacion })),
      fallidas,
      sinUbicar: asignacion.sinUbicar.map(id => ({ medicationId: id, nombre: nombreDe(id) })),
      pendientesDeAutorizacion: principales.filter(r => r.autorizacion === 'pendiente').length
        + posdatadasGuardadas.filter(p => p.autorizacion === 'pendiente').length,
      avisoDelServicio: accionPdfAviso(emision),
      posdatadas: posdatadasGuardadas,
      posdatadasFaltantes: posdatadasSinGuardar.length,
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
/**
 * La fecha de una receta de Innovamed como DD/MM/AAAA (día argentino), venga
 * como "DD/MM/AAAA[ hh:mm]", "D/M/AAAA" o ISO. '' si no se puede leer.
 */
function fechaArgentina(fecha: unknown): string {
  const t = String(fecha ?? '').trim()
  const dma = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dma) return `${dma[1].padStart(2, '0')}/${dma[2].padStart(2, '0')}/${dma[3]}`
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(T.*)?$/)
  if (iso) {
    if (!iso[4]) return `${iso[3]}/${iso[2]}/${iso[1]}`
    const d = new Date(t)
    if (isNaN(d.getTime())) return ''
    const ar = new Date(d.getTime() - 3 * 3600 * 1000)
    return `${String(ar.getUTCDate()).padStart(2, '0')}/${String(ar.getUTCMonth() + 1).padStart(2, '0')}/${ar.getUTCFullYear()}`
  }
  return ''
}

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

/** Lo que se guarda de cada receta en `clinical_medications.rcta_recetas` (migración 223). */
function resumenReceta(r: RecetaEmitida) {
  return { id: r.id, idReceta: r.idReceta, fecha: r.fecha, s3Link: r.s3Link, verificador: r.verificador, autorizacion: r.autorizacion }
}

/** Pendiente si alguna de las recetas lo está; ok si todas dijeron Ok; si no, null (no informó). */
function autorizacionDeLasRecetas(recetas: RecetaEmitida[]): Autorizacion {
  if (recetas.some(r => r.autorizacion === 'pendiente')) return 'pendiente'
  return recetas.length && recetas.every(r => r.autorizacion === 'ok') ? 'ok' : null
}
