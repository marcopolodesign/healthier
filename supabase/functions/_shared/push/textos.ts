/**
 * El catálogo de avisos push. **Es la única fuente del copy.**
 *
 * Hasta acá cada texto vivía escrito a mano adentro de un trigger, repartido
 * en cuatro migraciones (091, 097, 149, 150). Eso tenía dos consecuencias
 * feas: nadie podía leer de corrido lo que la plataforma le dice al usuario, y
 * cambiar una palabra era escribir una migración.
 *
 * Ahora el trigger dice **qué pasó** (`tipo` + los ids), y el texto se arma
 * acá. Lo mismo que ya hacen los mails con `_shared/email/templates.ts`.
 *
 * `scripts/push-textos.ts` genera la página de revisión desde este mismo
 * archivo, así que lo que el equipo lee es exactamente lo que se manda.
 */

export type Destinatario = 'paciente' | 'profesional'

export type Aviso = {
  title: string
  body: string
  /** A dónde lleva al tocarla. */
  url: string
}

/** Lo que el aviso necesita saber, ya buscado en la base por quien lo manda. */
export type Datos = {
  scheduledAt?: string | null
  isOnDemand?: boolean
  consultationId?: string
  hasRoom?: boolean
  /** Farmacia */
  orderId?: string
  pharmacyName?: string | null
  /** Recetas */
  medicamentos?: string[]
  /** Verificación */
  motivo?: string | null
  permanente?: boolean
  /** Post-consulta */
  professionalName?: string | null
  tieneReceta?: boolean
}

const TZ = 'America/Argentina/Buenos_Aires'

function fechaHora(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: TZ }) +
    ' a las ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
}

const corto = (id?: string) => `#${(id ?? '').slice(0, 8).toUpperCase()}`

/**
 * Cada entrada: para quién es, cuándo se dispara (se muestra en la página de
 * revisión) y cómo se arma el texto.
 */
export const AVISOS = {
  // ── Al paciente ───────────────────────────────────────────────────────────
  'turno-agendado': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional le agenda un turno desde su agenda (si lo reservó el paciente, no se manda: ya lo sabe).',
    build: (d: Datos): Aviso => ({
      title: 'Te agendaron un turno',
      body: d.scheduledAt
        ? `Tu profesional agendó una consulta para el ${fechaHora(d.scheduledAt)}.`
        : 'Tu profesional agendó una consulta de seguimiento.',
      url: '/paciente/consultas',
    }),
  },

  'turno-confirmado': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional confirma el turno.',
    build: (): Aviso => ({
      title: 'Turno confirmado',
      body: 'Tu consulta fue confirmada por el profesional.',
      url: '/paciente/consultas',
    }),
  },

  'profesional-listo': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional entra a la sala. Es el aviso que hace que una videoconsulta empiece.',
    build: (d: Datos): Aviso => ({
      title: '¡El profesional está listo!',
      body: 'Tu consulta comenzó. Entrá a la sala ahora.',
      url: d.hasRoom
        ? `/paciente/videollamada/${d.consultationId}`
        : `/paciente/sala-espera/${d.consultationId}`,
    }),
  },

  'recordatorio-manana': {
    para: 'paciente' as Destinatario,
    cuando: 'La noche anterior al turno (lo manda el cron, no un trigger).',
    build: (d: Datos): Aviso => ({
      title: 'Recordatorio de turno',
      body: d.scheduledAt
        ? `Mañana tenés una consulta con ${d.professionalName ?? 'tu profesional'} a las ${hora(d.scheduledAt)}.`
        : `Mañana tenés una consulta con ${d.professionalName ?? 'tu profesional'}.`,
      url: '/paciente/consultas',
    }),
  },

  'recordatorio-pronto': {
    para: 'paciente' as Destinatario,
    cuando: 'Media hora antes del turno (cron).',
    build: (d: Datos): Aviso => ({
      title: 'Tu consulta comienza pronto',
      body: d.scheduledAt
        ? `Tu consulta con ${d.professionalName ?? 'tu profesional'} es a las ${hora(d.scheduledAt)}. ¡Preparate!`
        : `Tu consulta con ${d.professionalName ?? 'tu profesional'} empieza en un rato.`,
      url: '/paciente/consultas',
    }),
  },

  'consulta-cancelada': {
    para: 'paciente' as Destinatario,
    cuando: 'Se cancela el turno, y no lo canceló el paciente.',
    build: (): Aviso => ({
      title: 'Consulta cancelada',
      body: 'Tu consulta fue cancelada. Podés reservar un nuevo turno.',
      url: '/paciente/consultas',
    }),
  },

  // ── NUEVOS: acompañan a los mails que ya existían ─────────────────────────
  'post-consulta': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional cierra la consulta. Recién ahí existen el resumen, el diagnóstico y las recetas.',
    build: (d: Datos): Aviso => ({
      title: 'Tu resumen ya está listo',
      body: d.tieneReceta
        ? `${d.professionalName ?? 'Tu profesional'} dejó el resumen de la consulta y tu receta.`
        : `${d.professionalName ?? 'Tu profesional'} dejó el resumen de la consulta y las indicaciones.`,
      url: `/paciente/consulta/resumen/${d.consultationId}`,
    }),
  },

  'receta-emitida': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional emite una receta electrónica.',
    build: (d: Datos): Aviso => ({
      title: 'Tu receta ya está disponible',
      body: d.medicamentos?.length
        ? `${d.medicamentos.join(' · ')}. Presentala desde el celular en cualquier farmacia.`
        : 'Presentala desde el celular en cualquier farmacia.',
      url: '/paciente/recetas',
    }),
  },

  'pedido-confirmado': {
    para: 'paciente' as Destinatario,
    cuando: 'Se acredita el pago del pedido de farmacia.',
    build: (d: Datos): Aviso => ({
      title: 'Pedido confirmado',
      body: `${d.pharmacyName ?? 'La farmacia'} ya está preparando tu pedido ${corto(d.orderId)}.`,
      url: `/paciente/farmacia/pedido/${d.orderId}`,
    }),
  },

  'pedido-enviado': {
    para: 'paciente' as Destinatario,
    cuando: 'La farmacia marca el pedido como enviado.',
    build: (d: Datos): Aviso => ({
      title: 'Tu pedido salió',
      body: 'Está en viaje a tu domicilio. Tené a mano tu DNI para recibirlo.',
      url: `/paciente/farmacia/pedido/${d.orderId}`,
    }),
  },

  'pedido-entregado': {
    para: 'paciente' as Destinatario,
    cuando: 'La farmacia marca el pedido como entregado.',
    build: (d: Datos): Aviso => ({
      title: 'Pedido entregado',
      body: 'Listo. Cualquier cosa, escribinos desde la app.',
      url: `/paciente/farmacia/pedido/${d.orderId}`,
    }),
  },

  'pedido-cancelado': {
    para: 'paciente' as Destinatario,
    cuando: 'La farmacia cancela el pedido.',
    build: (d: Datos): Aviso => ({
      title: 'Tu pedido se canceló',
      body: d.motivo
        ? `${d.motivo}. Si ya lo pagaste, la devolución sale automáticamente.`
        : 'Si ya lo pagaste, la devolución sale automáticamente.',
      url: `/paciente/farmacia/pedido/${d.orderId}`,
    }),
  },

  // ── Al profesional ────────────────────────────────────────────────────────
  'pro-consulta-nueva': {
    para: 'profesional' as Destinatario,
    cuando: 'Un paciente le reserva un turno o le pide una consulta inmediata.',
    build: (d: Datos): Aviso => ({
      title: d.isOnDemand ? 'Consulta inmediata disponible' : 'Nueva consulta reservada',
      body: d.isOnDemand
        ? 'Un paciente está buscando atención ahora.'
        : 'Un paciente reservó un turno con vos.',
      url: '/profesional/dashboard',
    }),
  },

  'pro-pago-recibido': {
    para: 'profesional' as Destinatario,
    cuando: 'El paciente paga la consulta.',
    build: (): Aviso => ({
      title: 'Te pagaron la consulta',
      body: 'El paciente ya abonó. El turno queda confirmado.',
      url: '/profesional/dashboard',
    }),
  },

  'pro-paciente-esperando': {
    para: 'profesional' as Destinatario,
    cuando: 'El paciente entra a la sala de espera.',
    build: (d: Datos): Aviso => ({
      title: d.isOnDemand ? 'Consulta inmediata — paciente listo' : 'Tenés un paciente esperando',
      body: 'Entrá a la sala para atenderlo.',
      url: `/profesional/videollamada/${d.consultationId}`,
    }),
  },

  'pro-consulta-cancelada': {
    para: 'profesional' as Destinatario,
    cuando: 'El paciente cancela el turno.',
    build: (): Aviso => ({
      title: 'Un paciente canceló',
      body: 'Se liberó el turno en tu agenda.',
      url: '/profesional/agenda',
    }),
  },

  'pro-recordatorio-1h': {
    para: 'profesional' as Destinatario,
    cuando: 'Una hora antes del turno (cron).',
    build: (d: Datos): Aviso => ({
      title: 'Tenés una consulta en una hora',
      body: d.scheduledAt ? `Tu próxima consulta es a las ${hora(d.scheduledAt)}.` : 'Tenés una consulta pronto.',
      url: '/profesional/agenda',
    }),
  },

  'pro-verificado': {
    para: 'profesional' as Destinatario,
    cuando: 'El equipo aprueba su documentación.',
    build: (): Aviso => ({
      title: '¡Tu perfil fue verificado!',
      body: 'Ya podés recibir consultas en Healthier.',
      url: '/profesional/dashboard',
    }),
  },

  'pro-observado': {
    para: 'profesional' as Destinatario,
    cuando: 'El equipo le devuelve la documentación con observaciones.',
    build: (d: Datos): Aviso => ({
      title: d.permanente ? 'Tu perfil fue rechazado' : 'Tu perfil necesita revisión',
      body: d.motivo ?? 'Revisá el detalle en tu panel.',
      url: '/profesional/dashboard',
    }),
  },

  // ── Emergencias ───────────────────────────────────────────────────────────
  'pro-emergencia-asignada': {
    para: 'profesional' as Destinatario,
    cuando: 'Se le asigna una emergencia.',
    build: (): Aviso => ({
      title: 'Emergencia asignada',
      body: 'Te asignaron una emergencia. Entrá para ver la dirección.',
      url: '/profesional/emergencias',
    }),
  },

  'emergencia-en-camino': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional sale hacia el domicilio.',
    build: (): Aviso => ({
      title: 'El médico está en camino',
      body: 'Ya salió hacia tu domicilio. Podés seguirlo desde la app.',
      url: '/paciente/sos',
    }),
  },

  'emergencia-llego': {
    para: 'paciente' as Destinatario,
    cuando: 'El profesional llega al domicilio.',
    build: (): Aviso => ({
      title: 'El médico llegó',
      body: 'Está en la puerta de tu domicilio.',
      url: '/paciente/sos',
    }),
  },

  'emergencia-cancelada': {
    para: 'paciente' as Destinatario,
    cuando: 'Se cancela la emergencia; se avisa siempre al otro lado, nunca a quien la canceló.',
    build: (): Aviso => ({
      title: 'Emergencia cancelada',
      body: 'La emergencia fue cancelada.',
      url: '/paciente/sos',
    }),
  },
} as const

export type Tipo = keyof typeof AVISOS

export function construir(tipo: Tipo, datos: Datos = {}): Aviso | null {
  const a = AVISOS[tipo]
  if (!a) return null
  return (a.build as (d: Datos) => Aviso)(datos)
}
