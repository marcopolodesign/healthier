import { supabase } from '../lib/supabase'

/**
 * Cambio del correo de acceso, con dos códigos (migración 161 +
 * Edge Function `cambio-de-correo`).
 *
 * No se usa `supabase.auth.updateUser({ email })` a propósito: ese flujo manda
 * un link al correo NUEVO y con eso alcanza. Verifica que la dirección existe,
 * pero no que quien pide el cambio sea el dueño de la cuenta — que es el
 * agujero a tapar (un profesional verificado pasándole su cuenta a otro para
 * que atienda con su matrícula). Por eso también va un código al correo actual.
 */
async function llamar(accion, payload = {}) {
  const { data, error } = await supabase.functions.invoke('cambio-de-correo', {
    body: { accion, ...payload },
  })
  // Los errores de `functions.invoke` llegan como "Edge Function returned a
  // non-2xx status code", sin el mensaje: el útil viene en el cuerpo.
  if (error) throw new Error(data?.error || error.message)
  if (data?.error) throw new Error(data.error)
  return data
}

export const emailChangeService = {
  /** ¿Hay un pedido vivo? Devuelve a qué correo, cuándo vence y los intentos. */
  estado: () => llamar('estado'),

  /** Manda los dos códigos. */
  solicitar: nuevoEmail => llamar('solicitar', { nuevoEmail }),

  /** Los dos códigos juntos. `{ ok, motivo, intentosRestantes }`. */
  verificar: (codigoActual, codigoNuevo) => llamar('verificar', { codigoActual, codigoNuevo }),

  cancelar: () => llamar('cancelar'),
}
