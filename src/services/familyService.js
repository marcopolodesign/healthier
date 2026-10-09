import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Grupo familiar del paciente titular.
 *
 * Desde la migración 181 cada familiar es un paciente de verdad: tiene su
 * `profiles` (role = 'patient', `titular_id` = quien lo creó) y su historia
 * clínica propia, pero NO tiene contraseña. `family_members` es el vínculo:
 * `patient_id` = titular, `familiar_id` = el perfil del familiar.
 *
 * Insertar en `family_members` sin `familiar_id` crea el perfil solo (trigger
 * `family_members_antes`). Los datos del formulario (nombre, DNI, teléfono,
 * obra social) se copian al perfil; fecha de nacimiento y sexo van directo al
 * perfil con `updatePerfil`.
 *
 * El titular actúa como el familiar: le reserva, le sube estudios y lee su HC.
 * Ver docs/grupo-familiar.md.
 */
const SELECT_CON_PERFIL = '*, familiar:profiles!familiar_id(id, full_name, first_name, last_name, birth_date, gender, dni, avatar_url, insurance_name, insurance_num)'

export const familyService = {
  async listForPatient(patientId) {
    if (!patientId) return []
    const { data, error } = await supabase
      .from('family_members')
      .select(SELECT_CON_PERFIL)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /** El vínculo + el perfil de UN familiar, por el id de su perfil. */
  async getFamiliar(titularId, familiarId) {
    const { data, error } = await supabase
      .from('family_members')
      .select(SELECT_CON_PERFIL)
      .eq('patient_id', titularId)
      .eq('familiar_id', familiarId)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Los pacientes cuyas consultas ve este usuario en sus listados: él y los
   * familiares que administra. Un familiar logueado con PIN no administra a
   * nadie, así que para él es sólo su id.
   */
  async idsDelGrupo(patientId) {
    if (!patientId) return []
    const { data } = await supabase
      .from('family_members')
      .select('familiar_id')
      .eq('patient_id', patientId)
      .eq('puede_gestionar', true)
    return [patientId, ...(data ?? []).map(r => r.familiar_id).filter(Boolean)]
  },

  async create(patientId, member) {
    const { data, error } = await supabase
      .from('family_members')
      .insert(toSnakeCase({ ...member, patientId }))
      .select(SELECT_CON_PERFIL)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Faltaba desde el día uno, acá y en la app: sólo el nombre es obligatorio,
   * así que se podía guardar un familiar a medias y después no había forma de
   * completarlo — el único camino era borrarlo y cargarlo de nuevo
   * (Nacho, 2026-09-14).
   */
  async update(id, member) {
    const { data, error } = await supabase
      .from('family_members')
      .update(toSnakeCase(member))
      .eq('id', id)
      .select(SELECT_CON_PERFIL)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Fecha de nacimiento, sexo y nombre/apellido por separado: viven sólo en el
   * perfil del familiar (la receta los lee de ahí — migración 183). El
   * `full_name` del vínculo se sigue mandando en `create`/`update`.
   */
  /**
   * El titular confirma la obra social que sugirió el listado de obras sociales
   * para el familiar (components/CoberturaSugeridaConfirmar). Va al vínculo
   * (`insurance_name`, que la base copia al perfil) y al perfil del familiar el
   * financiador del catálogo, para que sus recetas salgan con cobertura.
   */
  async usarCoberturaSugerida(vinculoId, familiarId, sugerencia) {
    const { error: e1 } = await supabase
      .from('family_members')
      .update({ insurance_name: sugerencia.financiadorNombre })
      .eq('id', vinculoId)
    if (e1) throw e1
    const { error: e2 } = await supabase
      .from('profiles')
      .update({
        coverage_type: 'financiador',
        financiador_id: sugerencia.financiadorId,
        insurance_name: sugerencia.financiadorNombre,
        cobertura_origen: 'listado',
      })
      .eq('id', familiarId)
    if (e2) throw e2
  },

  async updatePerfil(familiarId, { birthDate, gender, nombre, apellido }) {
    const { error } = await supabase
      .from('profiles')
      .update({
        birth_date: birthDate || null,
        gender: gender || null,
        ...(nombre !== undefined ? { first_name: nombre.trim(), last_name: apellido.trim() } : {}),
      })
      .eq('id', familiarId)
    if (error) throw error
  },

  /**
   * Borra el VÍNCULO, no el perfil: la historia clínica del familiar no se
   * destruye (las tablas clínicas no se pueden borrar). El titular deja de
   * verlo y de poder reservarle.
   */
  async remove(id) {
    const { error } = await supabase.from('family_members').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Código de 6 dígitos para que el familiar entre solo, sin contraseña.
   * Un solo uso, vence a los 15 minutos, generar otro invalida el anterior.
   * @returns {{ pin: string, expiraAt: string }}
   */
  async generarPin(familiarId) {
    const { data, error } = await supabase.rpc('generar_pin_familiar', { p_familiar: familiarId })
    if (error) throw error
    return data
  },

  /**
   * Canjea el código en la pantalla "Entrar con código familiar": la Edge
   * Function devuelve un `tokenHash` que se cambia por la sesión del familiar.
   */
  async entrarConPin(pin) {
    const { data, error } = await supabase.functions.invoke('acceso-familiar', { body: { pin } })
    if (error) {
      let mensaje = 'No pudimos validar el código.'
      try { mensaje = (await error.context?.json())?.error ?? mensaje } catch { /* sin cuerpo */ }
      throw new Error(mensaje)
    }
    const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' })
    if (otpError) throw otpError
  },

  /** Super admin: todos los vínculos con conteos (RPC admin_grupos_familiares). */
  async adminListar() {
    const { data, error } = await supabase.rpc('admin_grupos_familiares')
    if (error) throw error
    return toCamelCase(data ?? [])
  },
}
