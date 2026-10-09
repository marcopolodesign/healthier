import { supabase } from '../lib/supabase'

/**
 * Cobertura sugerida por DNI, desde el listado de obras sociales del Ministerio
 * (Edge Function `cobertura-sugerida`). Lee el DNI ya guardado en el perfil —
 * no se le pasa un DNI suelto—, así que se llama DESPUÉS de guardarlo.
 *
 * Nunca tira: si algo falla devuelve `{ estado: 'no_disponible' }` y el alta
 * sigue igual que siempre. El error real queda del lado del servidor.
 */
export const coberturaService = {
  async sugerida(pacienteId) {
    try {
      const { data, error } = await supabase.functions.invoke('cobertura-sugerida', {
        body: pacienteId ? { pacienteId } : {},
      })
      if (error) throw error
      return data ?? { estado: 'no_disponible' }
    } catch (e) {
      console.warn('cobertura-sugerida', e?.message ?? e)
      return { estado: 'no_disponible' }
    }
  },
}
