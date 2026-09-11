import { supabase } from '../lib/supabase'

/**
 * La firma ológrafa del profesional, la que se imprime en el bloque
 * "FIRMA Y SELLO" de la receta electrónica.
 *
 * Vive en `professional_signatures` (migración 154) y no en
 * `professional_profiles` porque esa tabla tiene lectura pública para todo
 * profesional verificado: con la firma de un médico a mano se falsifica una
 * receta en papel. Acá la única policy de lectura es "sos vos mismo", y quien
 * la necesita para emitir es la Edge Function `rcta-issue`, que la lee con el
 * service role.
 *
 * Se guarda el PNG en base64 **crudo**, sin el prefijo `data:image/png;base64,`
 * — es el formato exacto que espera `medico.firmabase64`. Con el prefijo
 * adelante el servicio de recetas contesta 200 y no dibuja nada: una receta sin
 * firma y sin error. Por eso el prefijo se saca acá al guardar, y `rcta-issue`
 * lo vuelve a sacar por las dudas.
 */
export const firmaService = {
  /** La firma del profesional, o `null` si no cargó ninguna. */
  async get(userId) {
    const { data, error } = await supabase
      .from('professional_signatures')
      .select('firma_png, origen, ancho, alto, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return {
      dataUrl: `data:image/png;base64,${data.firma_png}`,
      origen: data.origen,
      ancho: data.ancho,
      alto: data.alto,
      updatedAt: data.updated_at,
    }
  },

  /**
   * Guarda (o pisa) la firma. `dataUrl` es lo que devuelve `canvas.toDataURL()`.
   * @param {string} userId
   * @param {{ dataUrl: string, origen: 'trazo'|'foto', ancho?: number, alto?: number }} firma
   */
  async save(userId, { dataUrl, origen, ancho = null, alto = null }) {
    const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '')
    if (base64.length < 100) throw new Error('La firma quedó vacía. Volvé a firmar.')

    const { error } = await supabase
      .from('professional_signatures')
      .upsert(
        { user_id: userId, firma_png: base64, origen, ancho, alto, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (error) throw error
  },

  async remove(userId) {
    const { error } = await supabase
      .from('professional_signatures')
      .delete()
      .eq('user_id', userId)
    if (error) throw error
  },
}
