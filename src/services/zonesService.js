import { supabase, toCamelCase } from '../lib/supabase'

export const zonesService = {
  async getActive() {
    const { data, error } = await supabase
      .from('zones')
      .select('id, name, suggested_price_min, suggested_price_max, suggested_price_recommended')
      .eq('active', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async updatePricing(zoneId, { suggestedPriceMin, suggestedPriceMax, suggestedPriceRecommended }) {
    const { error } = await supabase
      .from('zones')
      .update({
        suggested_price_min:         suggestedPriceMin,
        suggested_price_max:         suggestedPriceMax,
        suggested_price_recommended: suggestedPriceRecommended,
      })
      .eq('id', zoneId)
    if (error) throw error
  },
}
