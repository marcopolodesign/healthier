import { supabase, toCamelCase } from '../lib/supabase'

export const zonesService = {
  async getActive() {
    const { data, error } = await supabase
      .from('zones')
      .select('id, name')
      .eq('active', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },
}
