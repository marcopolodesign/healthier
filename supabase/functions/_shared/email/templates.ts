/**
 * Las plantillas. Cada una devuelve `{ subject, html }` y NO habla con la base:
 * recibe datos ya masticados. Así el mismo archivo sirve para mandar de verdad
 * y para el script de previsualización (`scripts/preview-emails.ts`).
 */
import { APP_URL, C, type Accent } from './theme.ts'
import {
  button, codeBlock, divider, esc, itemList, link, note, p, panel, personCard, quote,
  renderEmail, sectionLabel, type EmailDoc,
} from './layout.ts'

export type Sent = { subject: string; html: string }

const TZ = 'America/Argentina/Buenos_Aires'

export function fechaLarga(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })
}
export function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
  })
}
export function hora(iso: string) {
  // `hour12: false` es obligatorio: sin él, el ICU de Deno devuelve
  // "05:10 p. m." y con el sufijo queda el sinsentido "05:10 p. m. h".
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  }) + ' h'
}
/** Para los asuntos: corta, sin año y sin el sufijo " h". */
export function fechaCortaConHora(iso: string) {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ })
  const h = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  return `${dia.replace(/\.$/, '')}, ${h}`
}

export function fechaYHora(iso: string) {
  const f = fechaLarga(iso)
  return `${f.charAt(0).toUpperCase()}${f.slice(1)} · ${hora(iso)}`
}
export function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

/** "videoconsulta" / "consulta presencial" / "consulta inmediata". */
export function modalidad(modality: string | null, onDemand = false) {
  if (onDemand) return 'consulta inmediata'
  return modality === 'presencial' ? 'consulta presencial' : 'videoconsulta'
}

/** Las filas que describen un turno. Las comparten la confirmación y el recordatorio. */
function filasDeConsulta(c: ConsultaBase) {
  const presencial = c.modality === 'presencial'
  return [
    { label: 'Cuándo', value: esc(c.scheduledAt ? fechaYHora(c.scheduledAt) : 'A confirmar') },
    { label: 'Con quién', value: esc(c.professionalName) },
    { label: 'Modalidad', value: presencial ? 'Consulta presencial' : 'Videoconsulta' },
    ...(presencial && c.address ? [{ label: 'Dónde', value: esc(c.address) }] : []),
  ]
}

/**
 * Las filas de plata. Antes decía sólo "Valor: $X", que deja al paciente sin
 * saber si eso ya se lo cobraron o se lo van a cobrar — justo lo contrario de
 * lo que promete el modelo (sin sorpresas). Ahora el monto viene con el estado
 * real del pago.
 */
function filasDePago(c: ConsultaBase) {
  if (!c.priceAtBooking) return []
  const estado: Record<string, string> = {
    paid: 'Abonado',
    exempt: 'Sin cargo',
    pending_payment: 'Pendiente de cobro',
    in_process: 'Procesándose',
    rejected: 'Rechazado',
    refunded: 'Devuelto',
  }
  const texto = estado[c.paymentStatus ?? ''] ?? null
  return [
    { label: 'Monto', value: esc(money(c.priceAtBooking)) },
    ...(texto ? [{ label: 'Estado del pago', value: esc(texto) }] : []),
  ]
}

/** El color de la familia de mails según de qué se trate. */
export const ACCENT_POR_VERTICAL: Record<string, Accent> = {
  clinica: 'sage', nutricion: 'amber', mente: 'lavender', fisico: 'sage', veterinaria: 'coral',
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Reserva de turno agendado — al paciente
// ═══════════════════════════════════════════════════════════════════════════
export type ConsultaBase = {
  id: string
  scheduledAt: string | null
  modality: string | null
  isOnDemand: boolean
  vertical: string | null
  priceAtBooking: number | null
  /**
   * `consultations.payment_status`. El mail de reserva sale en el `insert`, o
   * sea **antes** de que Mercado Pago confirme: por eso el monto nunca se
   * anuncia como "abonado" a secas — se dice el estado real, que es lo que
   * evita la duda de "¿me lo cobraron o me lo van a cobrar?".
   */
  paymentStatus?: string | null
  /** Nombre de pila — es con el que se saluda en el cuerpo del mail. */
  patientName: string
  /** Nombre completo — es el que necesita el profesional para identificarlo. */
  patientFullName: string
  professionalName: string
  professionalSpecialty: string | null
  professionalAvatar: string | null
  /** Dirección del consultorio — sólo presencial. */
  address: string | null
}

export function turnoConfirmadoPaciente(c: ConsultaBase): Sent {
  const accent = ACCENT_POR_VERTICAL[c.vertical ?? ''] ?? 'sage'
  const presencial = c.modality === 'presencial'
  const cuando = c.scheduledAt ? fechaYHora(c.scheduledAt) : 'A confirmar'

  const rows = [...filasDeConsulta(c), ...filasDePago(c)]

  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(c.patientName)}</strong>, tu turno quedó reservado.`),
    panel(rows, accent),
    presencial
      ? note('Llegá <strong>10 minutos antes</strong>. Si no vas a poder ir, cancelá desde la app para liberarle el horario a otra persona.', accent)
      : note('Entrá a la sala <strong>5 minutos antes</strong> desde la app. Vas a necesitar cámara y micrófono.', accent),
    button(`${APP_URL}/paciente/turno-confirmado/${c.id}`, 'Ver mi turno', accent),
    link(`${APP_URL}/paciente/consultas`, 'Ver todos mis turnos'),
  ].join('')

  return {
    subject: `Turno confirmado · ${c.professionalName}${c.scheduledAt ? ` — ${fechaCortaConHora(c.scheduledAt)}` : ''}`,
    html: renderEmail({
      preheader: `${cuando} · ${modalidad(c.modality)} con ${c.professionalName}`,
      eyebrow: 'Turno confirmado', accent,
      title: 'Tu turno está reservado',
      body,
      footnote: 'Podés reprogramarlo o cancelarlo desde la app hasta el horario del turno. Conviene hacerlo con al menos 30 minutos de anticipación, para que el horario le quede libre a otra persona.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Reserva de turno agendado — al profesional
// ═══════════════════════════════════════════════════════════════════════════
export function turnoConfirmadoProfesional(c: ConsultaBase): Sent {
  const cuando = c.scheduledAt ? fechaYHora(c.scheduledAt) : 'A confirmar'
  const rows = [
    { label: 'Paciente', value: esc(c.patientFullName) },
    { label: 'Cuándo', value: esc(cuando) },
    { label: 'Modalidad', value: c.modality === 'presencial' ? 'Consulta presencial' : 'Videoconsulta' },
    ...filasDePago(c),
  ]

  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(c.professionalName)}</strong>, tenés una consulta nueva en tu agenda.`),
    panel(rows, 'sage'),
    ...(c.priceAtBooking ? [note('El pago se te acredita cuando <strong>cerrás la consulta</strong>, no al reservarse el turno.', 'sage')] : []),
    button(`${APP_URL}/profesional/agenda`, 'Ver mi agenda', 'sage'),
  ].join('')

  return {
    subject: `Nueva reserva · ${c.patientFullName}${c.scheduledAt ? ` — ${fechaCortaConHora(c.scheduledAt)}` : ''}`,
    html: renderEmail({
      preheader: `${c.patientFullName} · ${cuando}`,
      eyebrow: 'Nueva reserva', accent: 'sage',
      title: 'Te reservaron un turno',
      body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Consulta inmediata (on-demand) confirmada — al paciente
// ═══════════════════════════════════════════════════════════════════════════
// El copy es distinto a propósito: acá no hay "llegá 10 minutos antes", el
// paciente tiene que ir a la sala AHORA y el profesional lo está esperando.
export function ondemandConfirmadaPaciente(c: ConsultaBase & { waitMinutes?: number | null }): Sent {
  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(c.patientName)}</strong>, ya tenés profesional asignado. Te está esperando en la sala.`),
    // El nombre y la especialidad viven en la tarjeta de la persona; el panel
    // sólo lleva lo que ella no dice, para no repetir el mismo dato dos veces.
    personCard({
      name: c.professionalName, subtitle: c.professionalSpecialty,
      avatarUrl: c.professionalAvatar, note: 'Disponible ahora', accent: 'coral',
    }),
    panel([
      { label: 'Modalidad', value: 'Videoconsulta · empieza ahora' },
      ...filasDePago(c),
    ], 'coral'),
    // Decía "suele tardar N minutos" y no se entendía si era la espera o la
    // consulta entera. Lo que hay que transmitir es inmediatez, no una duración.
    note('Entrá a la sala: <strong>la consulta comienza en instantes</strong>.', 'coral'),
    button(`${APP_URL}/paciente/sala-espera/${c.id}`, 'Entrar a la sala', 'coral'),
    link(`${APP_URL}/paciente/consultas`, 'Ver mis consultas'),
  ].join('')

  return {
    subject: `Tu consulta inmediata con ${c.professionalName} está lista`,
    html: renderEmail({
      preheader: `${c.professionalName} te está esperando en la sala.`,
      eyebrow: 'Consulta inmediata', accent: 'coral',
      title: 'Tu profesional te está esperando',
      body,
      footnote: 'Si no podés entrar ahora, cancelá desde la app: no se te cobra la consulta que no se hizo.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Post-consulta — al paciente (3 variantes: video / presencial / inmediata)
// ═══════════════════════════════════════════════════════════════════════════
export type Receta = { id: string; medicamentos: string[]; pdfUrl: string | null }
export type Indicacion = { titulo: string; detalle?: string | null; nota?: string | null }

export type PostConsulta = ConsultaBase & {
  completedAt: string | null
  closingNotes: string | null
  diagnosticos: Array<{ titulo: string; nota?: string | null }>
  indicaciones: Indicacion[]
  recetas: Receta[]
  yaCalificada: boolean
}

export function postConsultaPaciente(c: PostConsulta): Sent {
  const accent = ACCENT_POR_VERTICAL[c.vertical ?? ''] ?? 'sage'
  const tipo = modalidad(c.modality, c.isOnDemand)
  const cuando = c.completedAt ?? c.scheduledAt

  // El encabezado cambia según cómo fue la consulta. El resto del mail —
  // resumen, diagnóstico, indicaciones, recetas — es igual en las tres, porque
  // lo que el paciente se lleva no depende de por dónde lo atendieron.
  const intro = c.isOnDemand
    ? `terminó tu consulta inmediata con <strong style="color:${C.ink}">${esc(c.professionalName)}</strong>. Acá quedó todo lo que necesitás.`
    : c.modality === 'presencial'
      ? `gracias por venir. Acá está el resumen de tu consulta con <strong style="color:${C.ink}">${esc(c.professionalName)}</strong>.`
      : `terminó tu videoconsulta con <strong style="color:${C.ink}">${esc(c.professionalName)}</strong>. Acá está todo lo que hablaron.`

  const partes: string[] = [
    p(`Hola <strong style="color:${C.ink}">${esc(c.patientName)}</strong>, ${intro}`),
    personCard({
      name: c.professionalName,
      subtitle: c.professionalSpecialty,
      avatarUrl: c.professionalAvatar,
      note: cuando ? `${tipo.charAt(0).toUpperCase()}${tipo.slice(1)} · ${fechaCorta(cuando)}` : null,
      accent,
    }),
  ]

  if (c.closingNotes?.trim()) {
    partes.push(sectionLabel('Lo que anotó el profesional'))
    partes.push(quote(c.closingNotes.trim()))
  }

  if (c.diagnosticos.length) {
    partes.push(itemList(
      c.diagnosticos.length > 1 ? 'Diagnósticos' : 'Diagnóstico',
      c.diagnosticos.map(d => ({ title: d.titulo, detail: d.nota ?? null })),
      accent,
    ))
  }

  if (c.indicaciones.length) {
    partes.push(itemList('Indicaciones', c.indicaciones.map(i => ({
      title: i.titulo, detail: i.detalle ?? null, note: i.nota ?? null,
    })), accent))
  }

  if (c.recetas.length) {
    partes.push(itemList('Recetas electrónicas', c.recetas.map(r => ({
      title: r.medicamentos.join(' · ') || 'Receta',
      detail: 'Presentala en la farmacia desde el celular o descargala en PDF.',
      href: r.pdfUrl ?? `${APP_URL}/paciente/recetas`,
      hrefLabel: r.pdfUrl ? 'Descargar receta' : 'Ver mis recetas',
    })), accent))
    partes.push(note('Con la receta electrónica podés <strong>pedir los medicamentos por la app</strong> y que te lleguen a tu casa.', accent))
  }

  partes.push(divider())
  partes.push(button(`${APP_URL}/paciente/consulta/resumen/${c.id}`, 'Ver el resumen completo', accent))
  if (c.recetas.length) partes.push(link(`${APP_URL}/paciente/recetas`, 'Ver todas mis recetas'))
  if (!c.yaCalificada) partes.push(link(`${APP_URL}/paciente/consulta/review/${c.id}`, `Calificar la atención de ${c.professionalName}`))

  return {
    subject: `Resumen de tu consulta con ${c.professionalName}`,
    html: renderEmail({
      preheader: c.recetas.length
        ? `Tu resumen, las indicaciones y ${c.recetas.length > 1 ? 'tus recetas' : 'tu receta'} ya están en la app.`
        : 'Tu resumen y las indicaciones ya están en la app.',
      eyebrow: 'Consulta finalizada', accent,
      title: 'El resumen de tu consulta',
      body: partes.join(''),
      footnote: 'Todo esto queda guardado para siempre en tu historia clínica de Healthier.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Pedido de farmacia confirmado — al paciente
// ═══════════════════════════════════════════════════════════════════════════
export type PedidoFarmacia = {
  id: string
  patientName: string
  pharmacyName: string
  deliveryAddress: string | null
  total: number | null
  createdAt: string | null
  items: Array<{ nombre: string; cantidad: number; precio: number | null }>
}

export function pedidoFarmaciaConfirmado(o: PedidoFarmacia): Sent {
  const rows = [
    { label: 'Farmacia', value: esc(o.pharmacyName) },
    ...(o.deliveryAddress ? [{ label: 'Se entrega en', value: esc(o.deliveryAddress) }] : []),
    ...(o.total !== null ? [{ label: 'Total pagado', value: esc(money(o.total)) }] : []),
    { label: 'Número de pedido', value: esc(`#${o.id.slice(0, 8).toUpperCase()}`) },
  ]

  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(o.patientName)}</strong>, tu pedido está confirmado y la farmacia ya lo está preparando.`),
    panel(rows, 'lavender'),
    itemList('Lo que pediste', o.items.map(i => ({
      title: i.nombre,
      detail: `${i.cantidad} ${i.cantidad === 1 ? 'unidad' : 'unidades'}${i.precio !== null ? ` · ${money(i.precio)}` : ''}`,
    })), 'lavender'),
    note('Te avisamos por acá y por la app cuando el pedido salga para tu domicilio.', 'lavender'),
    button(`${APP_URL}/paciente/farmacia/pedido/${o.id}`, 'Seguir mi pedido', 'lavender'),
    link(`${APP_URL}/paciente/farmacia/pedidos`, 'Ver todos mis pedidos'),
  ].join('')

  return {
    subject: `Pedido confirmado · ${o.pharmacyName}`,
    html: renderEmail({
      preheader: `Tu pedido #${o.id.slice(0, 8).toUpperCase()} está en preparación en ${o.pharmacyName}.`,
      eyebrow: 'Pedido confirmado', accent: 'lavender',
      title: 'Tu pedido está en camino',
      body,
      footnote: 'Los medicamentos con receta se entregan contra la receta electrónica que ya está asociada a tu pedido.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Cambios de estado del pedido de farmacia
// ═══════════════════════════════════════════════════════════════════════════
export function pedidoFarmaciaEstado(o: PedidoFarmacia & { estado: 'en_preparacion' | 'enviado' | 'entregado' | 'cancelado'; motivo?: string | null }): Sent {
  const M = {
    en_preparacion: { eyebrow: 'En preparación', title: 'La farmacia está preparando tu pedido', line: 'ya lo tienen y lo están armando.', accent: 'lavender' as Accent },
    enviado:        { eyebrow: 'En camino',      title: 'Tu pedido está en camino', line: 'está en viaje a tu domicilio. Abrí el pedido en la app: adentro está el código de 4 dígitos que tenés que darle a quien te lo entregue.', accent: 'lavender' as Accent },
    entregado:      { eyebrow: 'Entregado',      title: 'Tu pedido fue entregado',           line: 'listo. Cualquier cosa, escribinos desde la app.', accent: 'sage' as Accent },
    cancelado:      { eyebrow: 'Pedido cancelado', title: 'Tu pedido se canceló',            line: 'si ya lo habías pagado, la devolución sale automáticamente por Mercado Pago.', accent: 'coral' as Accent },
  }[o.estado]

  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(o.patientName)}</strong>, ${M.line}`),
    panel([
      { label: 'Farmacia', value: esc(o.pharmacyName) },
      { label: 'Número de pedido', value: esc(`#${o.id.slice(0, 8).toUpperCase()}`) },
      ...(o.deliveryAddress ? [{ label: 'Se entrega en', value: esc(o.deliveryAddress) }] : []),
    ], M.accent),
    ...(o.motivo ? [note(`Motivo: ${esc(o.motivo)}`, M.accent)] : []),
    // El código NO viaja por mail a propósito: un mail se reenvía y se lee en
    // pantallas ajenas. Vive sólo en la app, que es donde prueba algo.
    ...(o.estado === 'enviado'
      ? [note('El código de entrega está en la app, en el seguimiento del pedido — por seguridad no lo mandamos por mail.', M.accent)]
      : []),
    button(`${APP_URL}/paciente/farmacia/pedido/${o.id}`, 'Ver el pedido', M.accent),
  ].join('')

  return {
    subject: `${M.eyebrow} · pedido #${o.id.slice(0, 8).toUpperCase()}`,
    html: renderEmail({
      preheader: M.title, eyebrow: M.eyebrow, accent: M.accent, title: M.title, body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Recordatorio de turno
// ═══════════════════════════════════════════════════════════════════════════
export function recordatorioTurno(c: ConsultaBase & { cuando: 'manana' | 'pronto' }): Sent {
  const accent = ACCENT_POR_VERTICAL[c.vertical ?? ''] ?? 'sage'
  const presencial = c.modality === 'presencial'
  const esManana = c.cuando === 'manana'
  const rows = filasDeConsulta(c)

  const body = [
    p(esManana
      ? `Hola <strong style="color:${C.ink}">${esc(c.patientName)}</strong>, te recordamos que mañana tenés turno.`
      : `Hola <strong style="color:${C.ink}">${esc(c.patientName)}</strong>, tu turno empieza en media hora.`),
    panel(rows, accent),
    presencial
      ? note('Salí con tiempo y llevá tu DNI. Si no vas a poder ir, cancelá ahora desde la app.', accent)
      : note('Probá cámara y micrófono antes de entrar. La sala se abre 5 minutos antes.', accent),
    presencial
      ? button(`${APP_URL}/paciente/turno-confirmado/${c.id}`, 'Ver mi turno', accent)
      : button(`${APP_URL}/paciente/sala-espera/${c.id}`, 'Entrar a la sala', accent),
  ].join('')

  return {
    subject: esManana
      ? `Mañana tenés turno con ${c.professionalName}`
      : `Tu turno con ${c.professionalName} empieza en 30 minutos`,
    html: renderEmail({
      preheader: c.scheduledAt ? fechaYHora(c.scheduledAt) : `Turno con ${c.professionalName}`,
      eyebrow: esManana ? 'Recordatorio' : 'Empieza pronto', accent,
      title: esManana ? 'Mañana tenés turno' : 'Tu turno empieza en 30 minutos',
      body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Consulta cancelada
// ═══════════════════════════════════════════════════════════════════════════
export function consultaCancelada(c: ConsultaBase & { paraQuien: 'paciente' | 'profesional'; motivo: string | null; canceladaPorMi: boolean }): Sent {
  const esPaciente = c.paraQuien === 'paciente'
  const quien = esPaciente ? c.patientName : c.professionalName
  // Al profesional el paciente le llega con nombre completo: es como lo tiene
  // en su agenda y es lo que le sirve para identificarlo.
  const otro = esPaciente ? c.professionalName : c.patientFullName

  const body = [
    p(c.canceladaPorMi
      ? `Hola <strong style="color:${C.ink}">${esc(quien)}</strong>, cancelamos el turno como pediste.`
      : `Hola <strong style="color:${C.ink}">${esc(quien)}</strong>, se canceló el turno que tenías con <strong style="color:${C.ink}">${esc(otro)}</strong>.`),
    panel([
      { label: 'Turno cancelado', value: esc(c.scheduledAt ? fechaYHora(c.scheduledAt) : 'Sin fecha') },
      { label: esPaciente ? 'Con quién era' : 'Paciente', value: esc(otro) },
      ...(c.motivo ? [{ label: 'Motivo', value: esc(c.motivo) }] : []),
    ], 'coral'),
    ...(esPaciente && c.priceAtBooking
      ? [note('Si ya habías pagado, la devolución sale automáticamente por Mercado Pago y se acredita en tu medio de pago <strong>entre 5 y 10 días hábiles</strong>.', 'coral')]
      : []),
    esPaciente
      ? button(`${APP_URL}/paciente/buscar`, 'Reservar otro turno', 'sage')
      : button(`${APP_URL}/profesional/agenda`, 'Ver mi agenda', 'sage'),
  ].join('')

  return {
    subject: `Turno cancelado · ${otro}`,
    html: renderEmail({
      preheader: `${c.scheduledAt ? fechaYHora(c.scheduledAt) : 'El turno'} con ${otro} se canceló.`,
      eyebrow: 'Turno cancelado', accent: 'coral',
      title: 'Se canceló el turno', body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Bienvenida — al paciente recién registrado
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `invitadoPor` es el profesional cuyo link de referido usó el paciente. Las
 * invitaciones de Healthier son ese link (`/r/<codigo>`), no un mail, así que
 * este es el único mail donde ese nombre puede aparecer — y verlo escrito es lo
 * que convierte "otra app de salud" en "la app de mi médico".
 */
export function bienvenidaPaciente(u: { name: string; invitadoPor?: string | null }): Sent {
  const body = [
    u.invitadoPor
      ? p(`Hola <strong style="color:${C.ink}">${esc(u.name)}</strong>, <strong style="color:${C.ink}">${esc(u.invitadoPor)}</strong> te invitó a Healthier y tu cuenta ya está lista. Acá tenés en un solo lugar a tus profesionales, tus consultas, tus recetas y tu historia clínica.`)
      : p(`Hola <strong style="color:${C.ink}">${esc(u.name)}</strong>, tu cuenta ya está lista. Healthier une en un solo lugar a los profesionales, tus consultas, tus recetas y tu historia clínica.`),
    itemList('Cómo podés empezar', [
      { title: 'Atendete ahora', detail: 'Consulta inmediata con un profesional disponible, sin sacar turno.' },
      { title: 'Sacá un turno', detail: 'Elegí especialidad, profesional y horario. Presencial o en línea.' },
      { title: 'Tus recetas digitales', detail: 'Se emiten en la consulta y las presentás en la farmacia desde la app.' },
      { title: 'Tu bóveda clínica', detail: 'Historia clínica interdisciplinaria: diagnósticos, indicaciones y estudios, en un solo lugar.' },
    ], 'sage'),
    button(`${APP_URL}/paciente/buscar`, 'Buscar un profesional', 'sage'),
    link(`${APP_URL}/paciente/dashboard`, 'Ir a mi inicio'),
  ].join('')

  return {
    subject: u.invitadoPor ? `${u.invitadoPor} te invitó a Healthier` : 'Bienvenido a Healthier',
    html: renderEmail({
      preheader: 'Tu cuenta ya está lista. Así podés empezar a usarla.',
      eyebrow: 'Bienvenido', accent: 'sage',
      title: 'Tu salud, en un solo lugar', body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9bis · Cambio de correo de acceso — un código a cada dirección
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Salen dos mails por pedido: uno al correo **actual** y otro al **nuevo**, con
 * códigos distintos, y hacen falta los dos para que el cambio se aplique
 * (migración 156). El del correo actual es además el aviso: si el cambio no lo
 * pediste vos, es el mail que te entera.
 */
export function cambioDeCorreoCodigo(d: {
  name: string
  destino: 'actual' | 'nuevo'
  codigo: string
  emailActual: string
  emailNuevo: string
}): Sent {
  const alActual = d.destino === 'actual'
  const body = [
    p(alActual
      ? `Hola <strong style="color:${C.ink}">${esc(d.name)}</strong>, pediste cambiar el correo de tu cuenta de Healthier de <strong style="color:${C.ink}">${esc(d.emailActual)}</strong> a <strong style="color:${C.ink}">${esc(d.emailNuevo)}</strong>. Este es <strong>tu código</strong>:`
      : `Hola <strong style="color:${C.ink}">${esc(d.name)}</strong>, este correo va a pasar a ser el de acceso a tu cuenta de Healthier. Este es <strong>tu código</strong>:`),
    codeBlock(d.codigo),
    note(alActual
      ? 'Hace falta <strong>este código y el que le llegó a la dirección nueva</strong>: los dos se escriben en la misma pantalla desde la que pediste el cambio.'
      : 'Hace falta <strong>este código y el que le llegó a la dirección anterior</strong>: los dos se escriben en la misma pantalla desde la que se pidió el cambio.',
      'amber'),
  ].join('')

  return {
    subject: `Tu código para cambiar el correo · ${d.codigo}`,
    html: renderEmail({
      preheader: `Código ${d.codigo} — vence en 30 minutos.`,
      eyebrow: 'Cambio de correo', accent: 'amber',
      title: 'Confirmá el cambio de correo',
      body,
      footnote: alActual
        ? 'Si no pediste este cambio, ignorá el mail y avisanos: sin los dos códigos tu correo no se modifica, y tu cuenta sigue funcionando igual.'
        : 'El código vence en 30 minutos. Nunca te lo vamos a pedir por teléfono ni por WhatsApp.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Profesional verificado / con observaciones
// ═══════════════════════════════════════════════════════════════════════════
export function profesionalVerificado(pr: { name: string }): Sent {
  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(pr.name)}</strong>, revisamos tu documentación y tu perfil ya está <strong style="color:${C.ink}">verificado</strong>. Desde ahora aparecés en las búsquedas y podés recibir consultas.`),
    itemList('Lo que conviene dejar listo hoy', [
      { title: 'Tu disponibilidad', detail: 'Sin horarios cargados no te pueden reservar.' },
      { title: 'Mercado Pago', detail: 'Vinculá tu cuenta para cobrar las consultas.' },
      { title: 'Tus tarifas y modalidad', detail: 'Presencial, por video, o las dos.' },
    ], 'sage'),
    button(`${APP_URL}/profesional/dashboard`, 'Ir a mi panel', 'sage'),
    link(`${APP_URL}/profesional/configuracion`, 'Configurar disponibilidad y cobros'),
  ].join('')

  return {
    subject: 'Tu perfil de Healthier está verificado',
    html: renderEmail({
      preheader: 'Ya aparecés en las búsquedas y podés recibir consultas.',
      eyebrow: 'Perfil verificado', accent: 'sage',
      title: 'Listo: ya podés atender', body,
    }),
  }
}

export function profesionalObservado(pr: { name: string; motivo: string | null }): Sent {
  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(pr.name)}</strong>, revisamos tu documentación y necesitamos que corrijas algo antes de activarte.`),
    ...(pr.motivo ? [quote(pr.motivo)] : []),
    p('Cargá de nuevo lo que falta desde tu panel y lo revisamos en el día.'),
    button(`${APP_URL}/profesional/onboarding`, 'Corregir mi documentación', 'amber'),
  ].join('')

  return {
    subject: 'Falta un dato para activar tu perfil',
    html: renderEmail({
      preheader: 'Revisamos tu documentación y hay algo para corregir.',
      eyebrow: 'Documentación', accent: 'amber',
      title: 'Nos falta un dato tuyo', body,
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 11 · Receta electrónica emitida
// ═══════════════════════════════════════════════════════════════════════════
export function recetaEmitida(r: { patientName: string; professionalName: string; medicamentos: string[]; pdfUrl: string | null; prescriptionId: string }): Sent {
  const body = [
    p(`Hola <strong style="color:${C.ink}">${esc(r.patientName)}</strong>, <strong style="color:${C.ink}">${esc(r.professionalName)}</strong> te emitió una receta electrónica. Ya está en tu cuenta.`),
    itemList('Medicamentos recetados', r.medicamentos.map(m => ({ title: m })), 'sage'),
    note('La receta se presenta <strong>desde el celular</strong> en cualquier farmacia. También podés pedir los medicamentos por la app y que te los lleven.', 'sage'),
    button(r.pdfUrl ?? `${APP_URL}/paciente/recetas`, r.pdfUrl ? 'Ver mi receta' : 'Ver mis recetas', 'sage'),
    link(`${APP_URL}/paciente/farmacia`, 'Pedir los medicamentos a una farmacia'),
  ].join('')

  return {
    subject: `Tu receta de ${r.professionalName} ya está disponible`,
    html: renderEmail({
      preheader: r.medicamentos.join(' · ') || 'Tu receta electrónica ya está en la app.',
      eyebrow: 'Receta electrónica', accent: 'sage',
      title: 'Tu receta está lista', body,
      footnote: 'La receta electrónica tiene la misma validez legal que la de papel.',
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12 · Auth — las plantillas que usa Supabase Auth
// ═══════════════════════════════════════════════════════════════════════════
// No se mandan desde acá: se cargan como `mailer_templates_*` en la config de
// Auth, que las rellena con sus propias variables Go (`{{ .ConfirmationURL }}`,
// `{{ .Token }}`, `{{ .Email }}`). Por eso el HTML sale con esos marcadores
// intactos y no se escapan.
function authDoc(doc: EmailDoc) { return renderEmail(doc) }

const fallbackLink = `<span style="font-size:13px;color:#A8A29E">Si el botón no funciona, copiá y pegá esta dirección en tu navegador:<br><span style="word-break:break-all">{{ .ConfirmationURL }}</span></span>`

export function authConfirmacion(): string {
  return authDoc({
    preheader: 'Confirmá tu correo para activar tu cuenta de Healthier.',
    eyebrow: 'Verificá tu cuenta', accent: 'sage',
    title: 'Confirmá tu correo',
    body: [
      p('Ya casi está. Tocá el botón para confirmar que este correo es tuyo y terminar de activar tu cuenta de Healthier.'),
      button('{{ .ConfirmationURL }}', 'Confirmar mi correo', 'sage'),
      p(fallbackLink),
    ].join(''),
    footnote: 'El enlace vence en una hora. Si no creaste una cuenta en Healthier, ignorá este mail: no se activa nada.',
  })
}

export function authMagicLink(): string {
  return authDoc({
    preheader: 'Tu enlace para entrar a Healthier, sin contraseña.',
    eyebrow: 'Iniciar sesión', accent: 'sage',
    title: 'Entrá a tu cuenta',
    body: [
      p('Tocá el botón y entrás directo a Healthier. No hace falta contraseña.'),
      button('{{ .ConfirmationURL }}', 'Entrar a Healthier', 'sage'),
      p(fallbackLink),
    ].join(''),
    footnote: 'El enlace vence en una hora y sirve una sola vez. Si no lo pediste vos, ignorá este mail — tu cuenta sigue segura.',
  })
}

export function authRecuperacion(): string {
  return authDoc({
    preheader: 'Elegí una contraseña nueva para tu cuenta de Healthier.',
    eyebrow: 'Contraseña', accent: 'sage',
    title: 'Cambiá tu contraseña',
    body: [
      p('Pediste recuperar el acceso a tu cuenta. Tocá el botón para elegir una contraseña nueva.'),
      button('{{ .ConfirmationURL }}', 'Elegir contraseña nueva', 'sage'),
      p(fallbackLink),
    ].join(''),
    footnote: 'El enlace vence en una hora. Si no pediste el cambio, ignorá este mail: tu contraseña actual sigue funcionando.',
  })
}

export function authCambioDeMail(): string {
  return authDoc({
    preheader: 'Confirmá tu dirección de correo nueva.',
    eyebrow: 'Cambio de correo', accent: 'amber',
    title: 'Confirmá tu correo nuevo',
    body: [
      // Ojo: comillas simples, así que nada de `${...}` acá adentro — el color
      // va escrito, no interpolado (estaba saliendo literal en el HTML).
      p(`Pediste cambiar el correo de tu cuenta de <strong style="color:${C.ink}">{{ .Email }}</strong> a <strong style="color:${C.ink}">{{ .NewEmail }}</strong>.`),
      button('{{ .ConfirmationURL }}', 'Confirmar el cambio', 'amber'),
      p(fallbackLink),
    ].join(''),
    footnote: 'Si no pediste este cambio, ignorá el mail y avisanos: tu correo actual no se modifica.',
  })
}

export function authCodigo(): string {
  return authDoc({
    preheader: 'Tu código de verificación de Healthier.',
    eyebrow: 'Código de verificación', accent: 'sage',
    title: 'Tu código',
    body: [
      p('Ingresá este código en Healthier para confirmar que sos vos:'),
      codeBlock('{{ .Token }}'),
    ].join(''),
    footnote: 'El código vence en una hora. Nunca te lo vamos a pedir por teléfono ni por WhatsApp.',
  })
}

/**
 * Ojo: **esta NO es la invitación que usan los profesionales.** Ellos invitan
 * con su link de referido (`/r/<codigo>`), que abre una landing con su cara y
 * su nombre, y el nombre de quien invitó aparece después en la bienvenida. Este
 * mail es el `inviteUserByEmail` de Supabase, que hoy sólo puede disparar el
 * equipo. El nombre sale de la metadata de la invitación, si quien la manda la
 * carga — y si no, el saludo sigue teniendo sentido sin él.
 */
export function authInvitacion(): string {
  return authDoc({
    preheader: 'Te invitaron a crear tu cuenta en Healthier.',
    eyebrow: 'Invitación', accent: 'sage',
    title: '{{ if .Data.invited_by_name }}{{ .Data.invited_by_name }} te invitó a Healthier{{ else }}Te invitaron a Healthier{{ end }}',
    body: [
      p('Creá tu cuenta para empezar a usar Healthier: consultas, recetas e historia clínica en un solo lugar.'),
      button('{{ .ConfirmationURL }}', 'Crear mi cuenta', 'sage'),
      p(fallbackLink),
    ].join(''),
    footnote: 'Si no esperabas esta invitación, podés ignorar el mail.',
  })
}
