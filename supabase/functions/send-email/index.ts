/**
 * send-email — el único emisor de mails transaccionales de Healthier.
 *
 * Recibe `{ tipo, ...ids }` y se encarga de todo: buscar los datos, elegir la
 * plantilla y mandar. Quien la llama (un trigger de la base, un cron o el
 * super admin) sólo dice QUÉ pasó, nunca cómo se ve el mail.
 *
 * Por qué una sola función y no una por mail: la clave de Resend, el remitente,
 * el logueo del error y el armazón HTML son los mismos para todos. Con una
 * función por mail, `supabase functions deploy` tendría que acertar N veces y
 * el día que cambie el `from` habría N lugares donde cambiarlo.
 *
 * Se la llama con la service key (los triggers ya lo hacen así). No es pública:
 * `verify_jwt` queda en true, que es el default — a diferencia de las cuatro de
 * Mercado Pago, esta nunca la invoca un tercero.
 *
 * Si falta `RESEND_API_KEY` devuelve 200 y no manda nada: así se puede deployar
 * antes de tener el dominio verificado sin romper ningún flujo.
 *
 * Con `"preview": true` en el body arma los mails con los datos REALES de esa
 * consulta/pedido y devuelve el asunto y el HTML sin mandar nada. Es la forma
 * de comprobar que el armado contra la base funciona sin escribirle a un
 * paciente — y la única manera de mirar un mail con datos de verdad.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarTodos, hayClave, type Contexto } from '../_shared/email/send.ts'
import * as T from '../_shared/email/templates.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Perfil = { full_name: string | null; email: string | null; avatar_url: string | null }

// ── Lecturas ────────────────────────────────────────────────────────────────

/**
 * Todo lo que las plantillas de consulta necesitan, en una sola consulta.
 * `professional:profiles!professional_id(...)` es el join aliaseado obligatorio
 * de PostgREST — el directo da 400 (ver CLAUDE.md).
 */
async function leerConsulta(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from('consultations')
    .select(`
      id, scheduled_at, completed_at, modality, is_on_demand, vertical,
      price_at_booking, payment_status, closing_notes, status, cancel_reason, cancelled_by,
      patient_id, professional_id,
      patient:profiles!patient_id(full_name, email, avatar_url),
      professional:profiles!professional_id(
        full_name, email, avatar_url,
        professional_profiles!professional_profiles_user_id_fkey(specialty, address)
      )
    `)
    .eq('id', id)
    .single()
  if (error || !data) return null

  const patient = data.patient as unknown as Perfil | null
  const professional = data.professional as unknown as (Perfil & {
    professional_profiles: { specialty: string | null; address: string | null } | null
  }) | null
  // Especialidad y dirección del consultorio viven en professional_profiles.
  const pp = professional?.professional_profiles ?? null

  const base: T.ConsultaBase = {
    id: data.id,
    scheduledAt: data.scheduled_at,
    modality: data.modality,
    isOnDemand: Boolean(data.is_on_demand),
    vertical: data.vertical,
    priceAtBooking: data.price_at_booking,
    paymentStatus: data.payment_status,
    patientName: primerNombre(patient?.full_name) ?? 'Paciente',
    patientFullName: patient?.full_name ?? 'Paciente',
    professionalName: professional?.full_name ?? 'Profesional',
    professionalSpecialty: pp?.specialty ?? null,
    professionalAvatar: professional?.avatar_url ?? null,
    address: pp?.address ?? null,
  }

  return { base, row: data, patientEmail: patient?.email, professionalEmail: professional?.email }
}

/** "Sofía Ramírez López" → "Sofía". Un mail que saluda con el nombre completo suena a formulario. */
function primerNombre(nombre: string | null | undefined) {
  const n = (nombre ?? '').trim()
  return n ? n.split(/\s+/)[0] : null
}

/** Lo clínico de la consulta: diagnósticos, indicaciones y recetas emitidas. */
async function leerClinico(sb: SupabaseClient, consultationId: string) {
  const { data: enc } = await sb
    .from('clinical_encounters')
    .select('id')
    .eq('consultation_id', consultationId)
  const ids = (enc ?? []).map((e: { id: string }) => e.id)

  if (!ids.length) return { diagnosticos: [], indicaciones: [], recetas: [] as T.Receta[] }

  const [{ data: conds }, { data: meds }] = await Promise.all([
    sb.from('clinical_conditions')
      .select('icd10_display, snomed_display, notes').in('encounter_id', ids),
    sb.from('clinical_medications')
      .select('medication_name, nombre_droga, dosage_text, frequency, notes, rcta_status, rcta_pdf_url, rcta_prescription_id')
      .in('encounter_id', ids),
  ])

  const diagnosticos = (conds ?? []).map((c: Record<string, string | null>) => ({
    titulo: c.icd10_display || c.snomed_display || 'Diagnóstico',
    nota: c.notes,
  }))

  // Misma definición que `ConsultationSummary.jsx`: lo que salió por receta
  // electrónica se lista como receta (con su PDF) y NO se repite en
  // indicaciones. Repetirlo hace que el paciente crea que son dos cosas.
  const emitidas = (meds ?? []).filter((m: Record<string, string | null>) => m.rcta_status === 'issued')
  const otras = (meds ?? []).filter((m: Record<string, string | null>) => m.rcta_status !== 'issued')

  const indicaciones: T.Indicacion[] = otras.map((m: Record<string, string | null>) => ({
    titulo: m.medication_name || m.nombre_droga || 'Indicación',
    detalle: [m.dosage_text, m.frequency].filter(Boolean).join(' · ') || null,
    nota: m.notes,
  }))

  const porReceta = new Map<string, T.Receta>()
  for (const m of emitidas as Array<Record<string, string | null>>) {
    const key = m.rcta_prescription_id ?? 'sin-id'
    const nombre = m.medication_name || m.nombre_droga || 'Medicamento'
    const actual = porReceta.get(key)
    if (actual) actual.medicamentos.push(nombre)
    else porReceta.set(key, { id: key, medicamentos: [nombre], pdfUrl: m.rcta_pdf_url ?? null })
  }

  return { diagnosticos, indicaciones, recetas: [...porReceta.values()] }
}

async function leerPedido(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from('medication_orders')
    .select(`
      id, delivery_address, total, created_at, status,
      patient:profiles!patient_id(full_name, email),
      pharmacy:pharmacies!pharmacy_id(name),
      items:medication_order_items(medication_name, presentation, quantity, unit_price)
    `)
    .eq('id', id)
    .single()
  if (error || !data) return null

  const patient = data.patient as unknown as Perfil | null
  const pharmacy = data.pharmacy as unknown as { name: string | null } | null

  const pedido: T.PedidoFarmacia = {
    id: data.id,
    patientName: primerNombre(patient?.full_name) ?? 'Paciente',
    patientFullName: patient?.full_name ?? 'Paciente',
    pharmacyName: pharmacy?.name ?? 'la farmacia',
    deliveryAddress: data.delivery_address,
    total: data.total,
    createdAt: data.created_at,
    items: (data.items as Array<Record<string, unknown>> ?? []).map(i => ({
      nombre: [i.medication_name, i.presentation].filter(Boolean).join(' — ') as string,
      cantidad: Number(i.quantity ?? 1),
      precio: i.unit_price === null || i.unit_price === undefined ? null : Number(i.unit_price),
    })),
  }
  return { pedido, email: patient?.email, status: data.status as string }
}

async function leerPerfil(sb: SupabaseClient, userId: string) {
  // `referred_by_professional_id` → quién lo invitó. Las invitaciones son el
  // link del profesional (`/r/<codigo>`), no un mail: el único lugar donde ese
  // nombre puede aparecer escrito es la bienvenida.
  const { data } = await sb
    .from('profiles')
    .select('full_name, email, referred_by_professional_id')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null

  let invitadoPor: string | null = null
  if (data.referred_by_professional_id) {
    const { data: pro } = await sb
      .from('profiles').select('full_name')
      .eq('id', data.referred_by_professional_id).maybeSingle()
    invitadoPor = pro?.full_name ?? null
  }

  return { ...data, invitadoPor } as {
    full_name: string | null
    email: string | null
    invitadoPor: string | null
  }
}

// ── Cuentas de prueba (migración 186) ─────────────────────────────────────
//
// Una cuenta de prueba sólo se cruza con cuentas de prueba. La base ya impide
// crear una consulta que junte una de prueba con una real; esto es la segunda
// red, para las filas cruzadas que quedaron de antes (2026-10-05: una médica
// real recibió la cancelación de una consulta que pidió el paciente demo).
async function cruzaMundos(sb: SupabaseClient, body: Body): Promise<boolean> {
  try {
    if (body.consultationId) {
      const { data } = await sb.rpc('consulta_cruza_mundos', { p_consultation_id: body.consultationId })
      return data === true
    }
    if (body.prescriptionId) {
      const { data: med } = await sb
        .from('clinical_medications')
        .select('patient_id, professional_id')
        .eq('rcta_prescription_id', body.prescriptionId)
        .limit(1)
        .maybeSingle()
      if (!med?.patient_id || !med?.professional_id) return false
      const { data } = await sb.rpc('cuentas_compatibles', { p_a: med.patient_id, p_b: med.professional_id })
      return data === false
    }
  } catch (e) {
    // Si el chequeo falla, el mail sale: no se puede dejar sin avisar a un
    // paciente real por un error de esta red, que es la segunda.
    console.error('send-email cruzaMundos:', e instanceof Error ? e.message : e)
  }
  return false
}

// ── Despacho ────────────────────────────────────────────────────────────────

type Body = {
  tipo?: string
  /** Arma los mails y los devuelve, sin mandarlos. */
  preview?: boolean
  consultationId?: string
  orderId?: string
  userId?: string
  /** recordatorio */
  cuando?: 'manana' | 'pronto'
  /** pedido-estado */
  estado?: 'en_preparacion' | 'enviado' | 'entregado' | 'cancelado'
  motivo?: string | null
  /** receta */
  prescriptionId?: string
  /** derivacion */
  derivacionId?: string
  /** cambio-correo */
  requestId?: string
  destino?: 'actual' | 'nuevo'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Deployable sin clave: no manda, pero tampoco rompe el flujo que lo llamó.
  let body: Body
  try { body = await req.json() } catch { return json({ error: 'Body inválido' }, 400) }

  if (!hayClave() && !body.preview) return json({ skipped: true, reason: 'RESEND_API_KEY not set' })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // En preview no se manda ni se registra: se devuelve lo que se habría mandado.
  const salida = (
    ctx: Omit<Contexto, 'tipo'>,
    envios: Array<{ to: string | null | undefined; subject: string; html: string }>,
  ) =>
    body.preview
      ? json({ preview: envios.map(e => ({ to: e.to, subject: e.subject, html: e.html })) })
      : enviarTodos(sb, { tipo, ...ctx }, envios).then(sent => json({ sent }))

  // Compatibilidad con `send-booking-email`: un body con sólo `consultationId`
  // es la reserva de un turno. Lo usan las filas viejas de pg_net en vuelo.
  const tipo = body.tipo ?? (body.consultationId ? 'reserva' : null)
  if (!tipo) return json({ error: 'Falta `tipo`' }, 400)

  if (!body.preview && await cruzaMundos(sb, body)) {
    console.warn(`send-email ${tipo}: no sale — junta una cuenta de prueba con una real`)
    return json({ skipped: true, reason: 'cuenta de prueba con cuenta real' })
  }

  const porUsuario = async (construir: (u: { full_name: string | null; email: string | null; invitadoPor: string | null }) => T.Sent) => {
    if (!body.userId) return json({ error: 'Falta userId' }, 400)
    const u = await leerPerfil(sb, body.userId)
    if (!u) return json({ error: 'Usuario no encontrado' }, 404)
    return await salida({ usuarioId: body.userId }, [{ to: u.email, ...construir(u) }])
  }

  try {
    switch (tipo) {
      // ── Consultas ──────────────────────────────────────────────────────────
      case 'reserva': {
        const c = await requiereConsulta(sb, body.consultationId)
        if (!c) return json({ error: 'Consulta no encontrada' }, 404)
        const paciente = T.turnoConfirmadoPaciente(c.base)
        const pro = T.turnoConfirmadoProfesional(c.base)
        return await salida({ consultationId: c.base.id }, [
          { to: c.patientEmail, ...paciente },
          { to: c.professionalEmail, ...pro },
        ])
      }

      case 'ondemand': {
        const c = await requiereConsulta(sb, body.consultationId)
        if (!c) return json({ error: 'Consulta no encontrada' }, 404)
        const mail = T.ondemandConfirmadaPaciente({ ...c.base, isOnDemand: true })
        return await salida({ consultationId: c.base.id, usuarioId: c.row.patient_id }, [{ to: c.patientEmail, ...mail }])
      }

      case 'post-consulta': {
        const c = await requiereConsulta(sb, body.consultationId)
        if (!c) return json({ error: 'Consulta no encontrada' }, 404)
        const [clinico, { count }] = await Promise.all([
          leerClinico(sb, c.base.id),
          sb.from('reviews').select('id', { count: 'exact', head: true })
            .eq('consultation_id', c.base.id),
        ])
        const mail = T.postConsultaPaciente({
          ...c.base,
          completedAt: c.row.completed_at,
          closingNotes: c.row.closing_notes,
          ...clinico,
          yaCalificada: (count ?? 0) > 0,
        })
        return await salida({ consultationId: c.base.id, usuarioId: c.row.patient_id }, [{ to: c.patientEmail, ...mail }])
      }

      case 'recordatorio': {
        const c = await requiereConsulta(sb, body.consultationId)
        if (!c) return json({ error: 'Consulta no encontrada' }, 404)
        const mail = T.recordatorioTurno({ ...c.base, cuando: body.cuando ?? 'manana' })
        return await salida({ consultationId: c.base.id, usuarioId: c.row.patient_id }, [{ to: c.patientEmail, ...mail }])
      }

      case 'cancelada': {
        const c = await requiereConsulta(sb, body.consultationId)
        if (!c) return json({ error: 'Consulta no encontrada' }, 404)
        const motivo = body.motivo ?? c.row.cancel_reason ?? null
        // Quién canceló decide el copy: al que apretó el botón no se le informa
        // como novedad algo que acaba de hacer.
        const canceloPaciente = c.row.cancelled_by === c.row.patient_id
        return await salida({ consultationId: c.base.id }, [
          { to: c.patientEmail, ...T.consultaCancelada({ ...c.base, paraQuien: 'paciente', motivo, canceladaPorMi: canceloPaciente }) },
          { to: c.professionalEmail, ...T.consultaCancelada({ ...c.base, paraQuien: 'profesional', motivo, canceladaPorMi: !canceloPaciente }) },
        ])
      }

      // ── Farmacia ───────────────────────────────────────────────────────────
      case 'pedido-confirmado': {
        if (!body.orderId) return json({ error: 'Falta orderId' }, 400)
        const o = await leerPedido(sb, body.orderId)
        if (!o) return json({ error: 'Pedido no encontrado' }, 404)
        const mail = T.pedidoFarmaciaConfirmado(o.pedido)
        return await salida({ orderId: o.pedido.id }, [{ to: o.email, ...mail }])
      }

      case 'pedido-estado': {
        if (!body.orderId || !body.estado) return json({ error: 'Falta orderId o estado' }, 400)
        const o = await leerPedido(sb, body.orderId)
        if (!o) return json({ error: 'Pedido no encontrado' }, 404)
        const mail = T.pedidoFarmaciaEstado({ ...o.pedido, estado: body.estado, motivo: body.motivo ?? null })
        return await salida({ orderId: o.pedido.id }, [{ to: o.email, ...mail }])
      }

      // ── Recetas ────────────────────────────────────────────────────────────
      case 'receta': {
        if (!body.prescriptionId) return json({ error: 'Falta prescriptionId' }, 400)
        const { data: meds } = await sb
          .from('clinical_medications')
          .select('medication_name, nombre_droga, rcta_pdf_url, patient_id, professional_id')
          .eq('rcta_prescription_id', body.prescriptionId)
        if (!meds?.length) return json({ error: 'Receta no encontrada' }, 404)

        const [paciente, profesional] = await Promise.all([
          leerPerfil(sb, meds[0].patient_id as string),
          leerPerfil(sb, meds[0].professional_id as string),
        ])
        const mail = T.recetaEmitida({
          patientName: primerNombre(paciente?.full_name) ?? 'Paciente',
          professionalName: profesional?.full_name ?? 'tu profesional',
          medicamentos: meds.map((m: Record<string, string | null>) => m.medication_name || m.nombre_droga || 'Medicamento'),
          pdfUrl: (meds.find((m: Record<string, string | null>) => m.rcta_pdf_url)?.rcta_pdf_url as string) ?? null,
          prescriptionId: body.prescriptionId,
        })
        return await salida({ usuarioId: meds[0].patient_id as string }, [{ to: paciente?.email, ...mail }])
      }

      // ── Cuentas ────────────────────────────────────────────────────────────
      // Los tres que sólo necesitan el perfil de una persona comparten la
      // misma forma; lo único que cambia es qué plantilla se arma.
      case 'bienvenida':
        return await porUsuario(u => T.bienvenidaPaciente({
          name: primerNombre(u.full_name) ?? 'qué tal',
          invitadoPor: u.invitadoPor,
        }))

      // Los dos códigos del cambio de correo (migración 161). El código NO
      // viaja en el payload del trigger: se lee acá, con service role, de una
      // tabla que no tiene una sola policy de lectura.
      case 'cambio-correo': {
        if (!body.requestId) return json({ error: 'Falta requestId' }, 400)
        const { data: req } = await sb
          .from('email_change_requests')
          .select('user_id, new_email, code_current, code_new')
          .eq('id', body.requestId)
          .maybeSingle()
        if (!req) return json({ error: 'Pedido no encontrado' }, 404)
        const u = await leerPerfil(sb, req.user_id)
        if (!u?.email) return json({ error: 'Usuario sin correo' }, 404)

        const alActual = body.destino !== 'nuevo'
        const sent = T.cambioDeCorreoCodigo({
          name: primerNombre(u.full_name) ?? 'qué tal',
          destino: alActual ? 'actual' : 'nuevo',
          codigo: alActual ? req.code_current : req.code_new,
          emailActual: u.email,
          emailNuevo: req.new_email,
        })
        return await salida(
          { usuarioId: req.user_id },
          [{ to: alActual ? u.email : req.new_email, ...sent }],
        )
      }

      // Recuperar una cuenta dada de baja (migración 188). El mail va al
      // correo ORIGINAL guardado en `bajas_de_usuarios` (el perfil tiene el
      // alias), y el token se lee acá con service role: la tabla no tiene una
      // sola policy, igual que email_change_requests.
      case 'reactivar-cuenta': {
        if (!body.userId) return json({ error: 'Falta userId' }, 400)
        const { data: baja } = await sb
          .from('bajas_de_usuarios')
          .select('email_original, reactivacion_token')
          .eq('user_id', body.userId)
          .is('reactivado_at', null)
          .maybeSingle()
        if (!baja?.reactivacion_token) return json({ error: 'No hay un pedido de recuperación vigente' }, 404)
        const u = await leerPerfil(sb, body.userId)
        const sent = T.reactivarCuenta({
          name: primerNombre(u?.full_name) ?? 'qué tal',
          token: baja.reactivacion_token,
        })
        return await salida({ usuarioId: body.userId }, [{ to: baja.email_original, ...sent }])
      }

      // ── Derivaciones (migración 195) ───────────────────────────────────────
      case 'derivacion': {
        const d = await leerDerivacion(sb, body.derivacionId)
        if (!d) return json({ error: 'Derivación no encontrada' }, 404)
        const envios = [{ to: d.patientEmail, ...T.derivacionPaciente(d.base) }]
        if (d.base.destinoNombre && d.destinoEmail) {
          envios.push({ to: d.destinoEmail, ...T.derivacionProfesional({ ...d.base, destinoNombre: d.base.destinoNombre }) })
        }
        return await salida({ usuarioId: d.patientId }, envios)
      }

      case 'pro-verificado':
        return await porUsuario(u => T.profesionalVerificado({ name: u.full_name ?? 'profesional' }))

      case 'pro-observado':
        return await porUsuario(u => T.profesionalObservado({ name: u.full_name ?? 'profesional', motivo: body.motivo ?? null }))

      case 'precio-pendiente':
        return await porUsuario(u => T.profesionalSinPrecio({ name: u.full_name ?? 'profesional' }))

      default:
        return json({ error: `Tipo desconocido: ${tipo}` }, 400)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`send-email ${tipo}: ${msg}`)
    return json({ error: msg }, 500)
  }
})

const NOMBRE_VERTICAL: Record<string, string> = {
  clinica: 'Clínica', pediatria: 'Pediatría', nutricion: 'Nutrición', mente: 'Psicología',
  fisico: 'Kinesiología', veterinaria: 'Veterinaria', preparador: 'Preparador físico',
}

async function leerDerivacion(sb: SupabaseClient, id: string | undefined) {
  if (!id) return null
  const { data } = await sb
    .from('derivaciones')
    .select(`id, patient_id, motivo, vertical_destino, especialidad_destino, derivado_por, profesional_destino_id,
      paciente:profiles!patient_id(full_name, email),
      derivado:profiles!derivado_por(full_name),
      destino:profiles!profesional_destino_id(full_name, email)`)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null

  const uno = <X,>(x: unknown) => (Array.isArray(x) ? x[0] : x) as X | null
  const paciente = uno<{ full_name: string | null; email: string | null }>(data.paciente)
  const derivado = uno<{ full_name: string | null }>(data.derivado)
  const destino = uno<{ full_name: string | null; email: string | null }>(data.destino)

  const slugs = [data.especialidad_destino].filter(Boolean) as string[]
  const pros = [data.derivado_por, data.profesional_destino_id].filter(Boolean) as string[]
  const { data: pps } = await sb.from('professional_profiles').select('user_id, specialty').in('user_id', pros)
  for (const pp of pps ?? []) if (pp.specialty) slugs.push(pp.specialty)
  const { data: esp } = slugs.length
    ? await sb.from('specialties').select('slug, label').in('slug', slugs)
    : { data: [] }
  const label = (slug: string | null | undefined) =>
    slug ? ((esp ?? []).find((e: { slug: string }) => e.slug === slug)?.label ?? slug) : null
  const especialidadDe = (userId: string | null) =>
    label((pps ?? []).find((pp: { user_id: string }) => pp.user_id === userId)?.specialty)

  return {
    patientId: data.patient_id as string,
    patientEmail: paciente?.email ?? null,
    destinoEmail: destino?.email ?? null,
    base: {
      id: data.id as string,
      patientName: primerNombre(paciente?.full_name) ?? 'qué tal',
      patientFullName: paciente?.full_name ?? 'un paciente',
      derivadoPor: derivado?.full_name ?? 'Tu profesional',
      derivadoPorEspecialidad: especialidadDe(data.derivado_por),
      destinoNombre: destino?.full_name ?? null,
      destinoEspecialidad: especialidadDe(data.profesional_destino_id),
      especialidad: data.profesional_destino_id
        ? null
        : (label(data.especialidad_destino) ?? NOMBRE_VERTICAL[data.vertical_destino] ?? data.vertical_destino),
      motivo: data.motivo as string,
    } satisfies T.Derivacion,
  }
}

async function requiereConsulta(sb: SupabaseClient, id: string | undefined) {
  if (!id) return null
  return await leerConsulta(sb, id)
}
