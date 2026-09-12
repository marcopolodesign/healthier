import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Despacho de emergencias — la entidad, sus ambulancias y su tripulación.
 *
 * Migración 156. Lo que decide quién ve y quién escribe es la RLS, no este
 * archivo: acá no hay un solo chequeo de permisos que se pueda saltear desde
 * el cliente. Si una consulta vuelve vacía cuando no debería, el problema está
 * en la policy, no acá.
 */

/** Estado operativo del móvil — NO es el estado del traslado. */
export const ESTADOS_AMBULANCIA = [
  { id: 'disponible',       label: 'Disponible',       tono: 'verde' },
  { id: 'en_servicio',      label: 'En servicio',      tono: 'ambar' },
  { id: 'fuera_de_servicio', label: 'Fuera de servicio', tono: 'gris' },
]

export const TIPOS_AMBULANCIA = [
  { id: 'uti_movil',    label: 'UTI móvil' },
  { id: 'movil_medico', label: 'Móvil médico' },
  { id: 'traslado',     label: 'Traslado' },
]

export const ROLES_TRIPULACION = [
  { id: 'medico',    label: 'Médico/a' },
  { id: 'enfermero', label: 'Enfermero/a' },
  { id: 'chofer',    label: 'Chofer' },
]

/**
 * Pasados estos minutos sin novedades, el punto del móvil dejó de ser "en
 * vivo". Mismo criterio y mismo número que `emergencyTrackingService`: un
 * marcador quieto que parece actual es peor que decir que no sabemos dónde
 * está, y acá encima alguien decide a quién manda mirándolo.
 */
export const FRESCURA_MINUTOS = 2

export function ubicacionEsReciente(ubicacion, ahora = Date.now()) {
  if (!ubicacion?.updatedAt) return false
  return ahora - new Date(ubicacion.updatedAt).getTime() < FRESCURA_MINUTOS * 60 * 1000
}

export const dispatchService = {
  // ── La entidad ────────────────────────────────────────────────────────

  /** La entidad del usuario logueado (operador o admin de despacho). */
  async miEntidad() {
    const { data: staff, error: staffError } = await supabase
      .from('emergency_provider_staff')
      .select('provider_id, provider:emergency_providers(*)')
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (staffError) throw staffError
    return staff?.provider ? toCamelCase(staff.provider) : null
  },

  async listarEntidades() {
    const { data, error } = await supabase
      .from('emergency_providers')
      .select('*')
      .order('name')
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  async actualizarEntidad(id, campos) {
    const { data, error } = await supabase
      .from('emergency_providers')
      .update(campos)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Quién trabaja en la entidad — /despacho/configuracion. */
  async listarStaff(providerId) {
    const { data, error } = await supabase
      .from('emergency_provider_staff')
      .select('*, profile:profiles!profile_id(full_name, email, role, avatar_url)')
      .eq('provider_id', providerId)
      .eq('active', true)
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  // ── Las ambulancias ───────────────────────────────────────────────────

  /**
   * La flota, con su tripulación y su última posición. Un solo viaje: el mapa
   * necesita las tres cosas juntas y pedirlas por separado dejaba el punto y
   * el móvil desfasados medio segundo en cada refresco.
   */
  async listarAmbulancias(providerId) {
    let q = supabase
      .from('ambulances')
      .select(`
        *,
        ubicacion:ambulance_locations(*),
        tripulacion:ambulance_crew(
          id, crew_role, active,
          profile:profiles!profile_id(id, full_name, avatar_url, phone)
        )
      `)
      .eq('active', true)
      .order('label')
    if (providerId) q = q.eq('provider_id', providerId)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map(fila => {
      const amb = toCamelCase(fila)
      // El embed de una relación 1-1 vuelve como array — aplanarlo acá y no en
      // cada pantalla.
      amb.ubicacion = Array.isArray(amb.ubicacion) ? (amb.ubicacion[0] ?? null) : (amb.ubicacion ?? null)
      amb.tripulacion = (amb.tripulacion ?? []).filter(t => t.active)
      return amb
    })
  },

  async crearAmbulancia({ providerId, label, plate, unitType, notes }) {
    const { data, error } = await supabase
      .from('ambulances')
      .insert({
        provider_id: providerId,
        label,
        plate: plate || null,
        unit_type: unitType || 'movil_medico',
        notes: notes || null,
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async actualizarAmbulancia(id, campos) {
    const { data, error } = await supabase
      .from('ambulances')
      .update(campos)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Baja lógica: el histórico de traslados apunta a esta fila. */
  async darDeBajaAmbulancia(id) {
    const { error } = await supabase
      .from('ambulances')
      .update({ active: false, status: 'fuera_de_servicio' })
      .eq('id', id)
    if (error) throw error
  },

  // ── La tripulación ────────────────────────────────────────────────────

  async asignarTripulante({ ambulanceId, profileId, crewRole }) {
    const { data, error } = await supabase
      .from('ambulance_crew')
      .insert({ ambulance_id: ambulanceId, profile_id: profileId, crew_role: crewRole })
      .select('*, profile:profiles!profile_id(id, full_name, avatar_url, phone)')
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Baja lógica otra vez, y no un delete: quién iba arriba del móvil el día
   * que pasó algo es exactamente lo que se pregunta después.
   */
  async bajarTripulante(crewId) {
    const { error } = await supabase
      .from('ambulance_crew')
      .update({ active: false })
      .eq('id', crewId)
    if (error) throw error
  },

  /**
   * Candidatos para tripular: profesionales con matrícula, tripulación sin
   * matrícula (`emergency_crew` — chofer y enfermero) y el staff de la
   * entidad. Los pacientes NO entran: este buscador no puede volverse una
   * lista de pacientes, y la RLS de `profiles` tampoco lo permitiría.
   */
  async buscarPersonas(texto) {
    const q = (texto ?? '').trim()
    let consulta = supabase
      .from('profiles')
      .select('id, full_name, email, role, avatar_url')
      .in('role', ['professional', 'emergency_crew', 'emergency_admin', 'emergency_operator'])
      .limit(20)
    if (q) consulta = consulta.ilike('full_name', `%${q}%`)
    const { data, error } = await consulta
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /** Los móviles que tripula el usuario logueado — lo usa la app. */
  async misAmbulancias() {
    const { data, error } = await supabase
      .from('ambulance_crew')
      .select('id, crew_role, ambulance:ambulances(*)')
      .eq('active', true)
    if (error) throw error
    return (data ?? []).map(toCamelCase).filter(c => c.ambulance)
  },

  // ── Dónde está cada móvil ─────────────────────────────────────────────

  /** La publica el teléfono de la tripulación (RLS: sólo ellos escriben). */
  async publicarUbicacion({ ambulanceId, profileId, lat, lng, heading, speedKmh }) {
    const { data, error } = await supabase
      .from('ambulance_locations')
      .upsert({
        ambulance_id: ambulanceId,
        profile_id: profileId ?? null,
        latitude: lat,
        longitude: lng,
        heading: heading ?? null,
        speed_kmh: speedKmh ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ambulance_id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * El mapa del operador en vivo. Se suscribe a la flota entera, no a un
   * móvil: el operador mira todo junto, que es de lo que se trata.
   */
  suscribirUbicaciones(onCambio) {
    const canal = supabase
      .channel('flota-ambulancias')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ambulance_locations' },
        payload => onCambio({
          evento: payload.eventType,
          ubicacion: payload.new && Object.keys(payload.new).length ? toCamelCase(payload.new) : null,
          anterior: payload.old && Object.keys(payload.old).length ? toCamelCase(payload.old) : null,
        }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ambulances' },
        payload => onCambio({ evento: 'AMBULANCIA', ambulancia: toCamelCase(payload.new) }))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  },
}

export default dispatchService
