/**
 * Grilla de turnos de un profesional, en hora de Buenos Aires.
 *
 * Salió de `ReservarConsulta.jsx` (2026-09-30) para que el mapa del inicio
 * pueda mostrar el primer turno libre con la MISMA cuenta que después usa el
 * wizard de reserva: si cada uno calculara por su lado, el mapa podría
 * prometer un horario que la agenda no ofrece.
 */
// Duración por defecto del slot, en minutos — 4 patients/hour with margin for
// delays, per Nacho Arteaga (2026-07-08). Configurable desde
// /super-admin/settings (platform_settings.slot_duration_minutes, migración
// 100); esto es sólo el fallback mientras esa config carga o si no hay fila
// (no debería pasar, pero `buildTimeSlots` no puede quedarse sin duración).
export const DEFAULT_SLOT_DURATION_MINUTES = 15
export const ACTIVE_CONSULTATION_STATUSES = ['pending', 'confirmed', 'in_progress']

export function addMinutes(hhmmss, minutes) {
  const [h, m] = hhmmss.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}:00`
}

// Splits each schedule range ("franja") for the selected day into slots of
// `slotMinutes`, skipping any that already have an active consultation
// booked. Este es el ÚNICO lugar del código que genera la grilla horaria
// contra `professional_schedules` — ver comentario en ProfessionalProfile.jsx.
export function buildTimeSlots(franjasForDay, bookedTimes, slotMinutes, minStartTime = null) {
  const slots = []
  franjasForDay.forEach(fr => {
    let cursor = fr.startTime
    while (cursor < fr.endTime) {
      const end = addMinutes(cursor, slotMinutes)
      if (end > fr.endTime) break
      const yaPaso = minStartTime != null && cursor < minStartTime
      if (!yaPaso && !bookedTimes.has(cursor.slice(0, 5))) {
        slots.push({ id: `${fr.id}-${cursor}`, startTime: cursor, endTime: end })
      }
      cursor = end
    }
  })
  return slots
}

/**
 * 🔴 Toda esta pantalla razona en hora de **Buenos Aires**, nunca en la del
 * equipo del paciente.
 *
 * `professional_schedules` guarda "09:00–13:00" sin zona: son las horas del
 * consultorio, o sea hora argentina. Si el reloj de referencia es el del
 * dispositivo, un paciente con el huso corrido ve la grilla de otro día y con
 * otro corte — le podemos ofrecer las 9:00 de una mañana que ya pasó, o
 * esconderle horas que todavía están libres. Es el mismo error que ya nos pasó
 * al crear el turno (arreglado el 2026-09-07: el `scheduledAt` sale con
 * `-03:00` explícito) y que se veía en el emulador de Android, que corre en GMT.
 *
 * Argentina no tiene horario de verano desde 2009, así que el offset es fijo:
 * se corre el instante 3 horas y se leen los campos en UTC, que es la forma más
 * corta de tener el reloj de pared de Buenos Aires sin depender del ICU del
 * dispositivo.
 */
export const OFFSET_BUENOS_AIRES_MS = 3 * 60 * 60 * 1000

export function relojBuenosAires(instanteMs = Date.now()) {
  return new Date(instanteMs - OFFSET_BUENOS_AIRES_MS)
}

const dosDigitos = (n) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` del reloj de Buenos Aires. */
export function fechaISOBuenosAires(d) {
  return `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`
}

/** `HH:MM` del reloj de Buenos Aires. */
export function horaHHMMBuenosAires(d) {
  return `${dosDigitos(d.getUTCHours())}:${dosDigitos(d.getUTCMinutes())}`
}

/**
 * La hora a partir de la cual se puede reservar HOY.
 *
 * Sin esto, un profesional con franja de 9 a 18 ofrecía las 9:00 a las seis de
 * la tarde: la grilla salía de `professional_schedules` sin mirar el reloj. Se
 * pide además un margen de una hora — nadie reserva un turno que empieza en
 * cinco minutos, y el profesional necesita verlo llegar.
 */
export const MARGEN_MINIMO_HOY_MIN = 60

export function horaMinimaParaHoy(fechaISO) {
  if (fechaISO !== fechaISOBuenosAires(relojBuenosAires())) return null
  const desde = relojBuenosAires(Date.now() + MARGEN_MINIMO_HOY_MIN * 60 * 1000)
  return `${horaHHMMBuenosAires(desde)}:00`
}

// ── Date helpers ─────────────────────────────────────────────
export function buildDateOptions(n = 14) {
  const days   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  // El "hoy" del calendario es el de Buenos Aires: cerca de medianoche, el
  // equipo del paciente puede estar en otro día que el del consultorio.
  const hoyBA = relojBuenosAires()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoyBA)
    d.setUTCDate(hoyBA.getUTCDate() + i)
    return {
      // Las partes van sueltas: la tarjeta de fecha las apila (día grande, mes
      // abajo), igual que la columna de fecha de un turno en Agenda.
      encabezado: i === 0 ? 'Hoy' : days[d.getUTCDay()],
      diaDelMes:  String(d.getUTCDate()).padStart(2, '0'),
      mesCorto:   months[d.getUTCMonth()],
      value:      fechaISOBuenosAires(d),
      dayOfWeek:  d.getUTCDay(),
    }
  })
}

/**
 * El primer turno que el wizard de reserva le va a ofrecer al paciente, o
 * `null` si no hay ninguno en los próximos `dias`. Devuelve
 * `{ fecha: 'YYYY-MM-DD', encabezado, diaDelMes, mesCorto, startTime }`.
 *
 * Mismas entradas que el paso de fecha del wizard: la agenda semanal
 * (`availabilityService.getSchedule`) y las consultas del profesional que el
 * paciente puede leer.
 */
export function primerTurnoLibre({ schedule = [], consultations = [], slotMinutes = DEFAULT_SLOT_DURATION_MINUTES, dias = 14 } = {}) {
  if (!schedule.length) return null
  const tomados = new Set(
    consultations
      .filter(c => ACTIVE_CONSULTATION_STATUSES.includes(c.status) && c.scheduledAt)
      .map(c => {
        const d = relojBuenosAires(new Date(c.scheduledAt).getTime())
        return `${fechaISOBuenosAires(d)} ${horaHHMMBuenosAires(d)}`
      })
  )
  for (const dia of buildDateOptions(dias)) {
    const franjas = schedule
      .filter(e => e.dayOfWeek === dia.dayOfWeek)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (!franjas.length) continue
    const ocupados = new Set([...tomados].filter(t => t.startsWith(dia.value)).map(t => t.slice(11)))
    const slots = buildTimeSlots(franjas, ocupados, slotMinutes, horaMinimaParaHoy(dia.value))
    if (slots.length) {
      const primero = slots.sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
      return { fecha: dia.value, encabezado: dia.encabezado, diaDelMes: dia.diaDelMes, mesCorto: dia.mesCorto, startTime: primero.startTime }
    }
  }
  return null
}

/**
 * Horas (con un decimal) desde ahora hasta un horario de pared de Buenos Aires
 * (`fechaISO` + `HH:MM[:SS]`). Para la analítica del embudo de reserva.
 */
export function horasHasta(fechaISO, hhmm, ahoraMs = Date.now()) {
  if (!fechaISO || !hhmm) return null
  const [y, mo, d] = fechaISO.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const instante = Date.UTC(y, mo - 1, d, h, mi) + OFFSET_BUENOS_AIRES_MS
  return Math.round(((instante - ahoraMs) / 3600000) * 10) / 10
}

/**
 * Resumen de lo que el paso de fecha le ofrece al paciente en los próximos
 * `dias`, con la misma cuenta que la grilla (agenda semanal menos consultas
 * activas, menos lo que ya pasó hoy). Sólo números: va a la analítica
 * (`booking_slots_view`), nunca datos del paciente.
 */
export function resumenDeAgenda({ schedule = [], consultations = [], slotMinutes = DEFAULT_SLOT_DURATION_MINUTES, dias = 14, ahoraMs = Date.now() } = {}) {
  const tomados = consultations
    .filter(c => ACTIVE_CONSULTATION_STATUSES.includes(c.status) && c.scheduledAt)
    .map(c => {
      const d = relojBuenosAires(new Date(c.scheduledAt).getTime())
      return `${fechaISOBuenosAires(d)} ${horaHHMMBuenosAires(d)}`
    })
  let daysAvailable = 0
  let slotsTotal = 0
  let primero = null
  for (const dia of buildDateOptions(dias)) {
    const franjas = schedule.filter(e => e.dayOfWeek === dia.dayOfWeek)
    if (!franjas.length) continue
    const ocupados = new Set(tomados.filter(t => t.startsWith(dia.value)).map(t => t.slice(11)))
    const slots = buildTimeSlots(franjas, ocupados, slotMinutes, horaMinimaParaHoy(dia.value))
    if (!slots.length) continue
    daysAvailable += 1
    slotsTotal += slots.length
    if (!primero) {
      const s = slots.map(x => x.startTime).sort()[0]
      primero = { fecha: dia.value, startTime: s }
    }
  }
  return {
    daysAvailable,
    slotsTotal,
    firstSlotDate: primero?.fecha ?? null,
    hoursUntilFirstSlot: primero ? horasHasta(primero.fecha, primero.startTime, ahoraMs) : null,
  }
}
