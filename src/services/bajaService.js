import { supabase } from '../lib/supabase'
import { callEdgeFunction } from '../lib/edgeFunction'

// Baja lógica y reactivación de cuentas (migración 188).
export const bajaService = {
  /** Super admin: da de baja (nunca borra). Devuelve `[{ id, ok, error? }]`. */
  async darDeBaja(ids) {
    const { resultados } = await callEdgeFunction('dar-de-baja-usuario', { ids })
    return resultados
  },

  /** ¿Este mail tiene una cuenta dada de baja que se puede recuperar? */
  async estaDadoDeBaja(email) {
    const { data, error } = await supabase.rpc('cuenta_dada_de_baja', { p_email: email })
    // Si el chequeo falla, el registro sigue como siempre: no se le traba el
    // alta a nadie por esta consulta.
    return !error && data === true
  },

  async pedirReactivacion(email) {
    await callEdgeFunction('reactivar-cuenta', { accion: 'solicitar', email })
  },

  /** Devuelve el mail de la cuenta recuperada, para iniciar sesión con él. */
  async confirmarReactivacion(token, password) {
    const { email } = await callEdgeFunction('reactivar-cuenta', { accion: 'confirmar', token, password })
    return email
  },
}

/** Lo que dice el diálogo de "Eliminar" en todas las listas del super admin. */
export const MENSAJE_BAJA =
  'Se da de baja: pierde el acceso y su mail queda libre. Su historia clínica se conserva (ley 26.529) y, si vuelve con el mismo mail, puede recuperar la cuenta.'
