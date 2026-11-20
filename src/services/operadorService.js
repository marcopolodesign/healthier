import { supabase } from '../lib/supabase'
import { terminarTurnoYDescartarSesion } from '../lib/sesionOperador'
import { aBlobSubible, TIPOS_AVATAR } from '../lib/archivoSubible'

/**
 * El modo operador de las cuentas operadorN de Medizin (migraciones 241-243).
 * Todo el contrato vive en la base y en la Edge Function `operador-modo`.
 */
const KEY_MODO = 'operador-modo'
/** Pedido de ingreso en espera (sessionStorage): sobrevive a recargar la pantalla. */
export const KEY_INGRESO = 'operador-ingreso'
export const enModoOperadorMarcado = () => { try { return window.localStorage.getItem(KEY_MODO) === '1' } catch { return false } }
function marcarModoOperador(activo) {
  try { activo ? window.localStorage.setItem(KEY_MODO, '1') : window.localStorage.removeItem(KEY_MODO) } catch { /* sin storage */ }
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function llamarModo(body) {
  const { data, error } = await supabase.functions.invoke('operador-modo', { body })
  if (error) {
    // El mensaje real viene en el cuerpo de la respuesta (409/422/403).
    let real = null
    try { real = (await error.context?.json?.())?.error } catch { /* sin cuerpo */ }
    throw new Error(real || error.message || 'No pudimos pedir el ingreso')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const operadorService = {
  /** Paso 1: el DNI. `{modo:'pendiente', ingreso_id}` o `{modo:'registro'}`. */
  pedirIngreso: (dni) => llamarModo({ dni }),

  /** Paso 2: consulta/retira el pedido. Puede devolver la sesión del profesional. */
  consultarIngreso: (ingresoId) => llamarModo({ ingresoId }),

  /**
   * ¿Esta sesión es una de modo operador (la de un profesional prestada)? La base
   * contesta `{ activo, cuenta_operador_id, cuenta_operador_email }`. El resultado
   * queda marcado en `operador-modo` (sólo para la UI: `FueraDeModoOperador` de
   * App.jsx saca de ganancias, configuración y perfil). La seguridad sigue en la base.
   */
  async estoyEnModoOperador() {
    const { data, error } = await supabase.rpc('estoy_en_modo_operador')
    const activo = !error && data?.activo === true
    marcarModoOperador(activo)
    return activo
  },

  /** ¿La cuenta crew es un operador (crew_role 'operador') de un móvil? */
  async esOperador(profileId) {
    const { data } = await supabase.from('ambulance_crew')
      .select('crew_role').eq('profile_id', profileId).eq('active', true).eq('crew_role', 'operador').limit(1)
    return !!data?.length
  },

  /** El registro de hoy de esta cuenta, o null. */
  async registroDeHoy(profileId) {
    const { data: dia } = await supabase.rpc('hoy_en_argentina')
    const { data } = await supabase.from('operadores_del_dia')
      .select('nombre, foto_path').eq('profile_id', profileId).eq('dia', dia).maybeSingle()
    return data ?? null
  },

  /** Registro del día: sube la selfie al bucket privado y llama al RPC. */
  async registrar({ nombre, dni, foto, profileId }) {
    if (!foto) throw new Error('Sacate una selfie con la cara a la vista.')
    // Lee la foto a memoria y resuelve el tipo (lo que manda el picker de un teléfono no siempre sirve).
    const { blob, contentType } = await aBlobSubible(foto, TIPOS_AVATAR)
    const path = `${profileId}/${Date.now()}.${EXT[contentType]}`
    const { error: up } = await supabase.storage.from('operadores-dia').upload(path, blob, { contentType })
    if (up) throw new Error(up.message || 'No pudimos subir la selfie')
    const { data, error } = await supabase.rpc('registrar_operador_del_dia', { p_nombre: nombre, p_dni: dni, p_foto_path: path })
    if (error) throw new Error(error.message)
    return data
  },

  /** El operador del día de MI emergencia (paciente), con URL firmada de la foto. */
  async delDiaDeMiEmergencia(emergencyId) {
    const { data, error } = await supabase.rpc('operador_de_mi_emergencia', { p_emergency_id: emergencyId })
    if (error || !data?.nombre) return null
    let fotoUrl = null
    if (data.foto_path) {
      const { data: firmada } = await supabase.storage.from('operadores-dia').createSignedUrl(data.foto_path, 600)
      fotoUrl = firmada?.signedUrl ?? null
    }
    return { nombre: data.nombre, fotoUrl }
  },

  /** Terminar turno: la base cierra la sesión y acá se descarta la local en el acto. */
  terminarTurno: () => terminarTurnoYDescartarSesion({ supabase, storage: window.localStorage }),
}
