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
      price_at_booking, closing_notes, status, cancel_reason, cancelled_by,
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
  const { data } = await sb.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  return data as { full_name: string | null; email: string | null } | null
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

  const porUsuario = async (construir: (u: { full_name: string | null; email: string | null }) => T.Sent) => {
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
        return await porUsuario(u => T.bienvenidaPaciente({ name: primerNombre(u.full_name) ?? 'qué tal' }))

      case 'pro-verificado':
        return await porUsuario(u => T.profesionalVerificado({ name: u.full_name ?? 'profesional' }))

      case 'pro-observado':
        return await porUsuario(u => T.profesionalObservado({ name: u.full_name ?? 'profesional', motivo: body.motivo ?? null }))

      default:
        return json({ error: `Tipo desconocido: ${tipo}` }, 400)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`send-email ${tipo}: ${msg}`)
    return json({ error: msg }, 500)
  }
})

async function requiereConsulta(sb: SupabaseClient, id: string | undefined) {
  if (!id) return null
  return await leerConsulta(sb, id)
}
