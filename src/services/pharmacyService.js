import { supabase, toCamelCase } from '../lib/supabase'
import { medicationOrdersService } from './medicationOrdersService'

const PHARMACY_ID = medicationOrdersService.PHARMACY_ID

export const pharmacyService = {
  async getAll() {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async getFeatured() {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .eq('featured', true)
      .eq('in_stock', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  // Products in the same category as the patient's most recent consultation vertical.
  async getSuggested(patientId) {
    const { data: consultations, error: consErr } = await supabase
      .from('consultations')
      .select('vertical')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
      .limit(1)
    if (consErr) throw consErr

    const category = consultations?.[0]?.vertical
    if (!category) return []

    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .eq('category', category)
      .eq('in_stock', true)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async search(query) {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Medicamentos con receta emitida que matchean el catálogo y todavía no
   * fueron pedidos — alimenta "Recetados por tu médico" en Pharmacy.jsx.
   * El paciente decide si los agrega o no; esto nunca crea un pedido.
   * Misma lógica de matching que notifyPharmacyMatch (rcta-issue), del
   * lado del cliente para poder listarlos en vez de sólo notificar.
   */
  async getPrescribedMatches(patientId) {
    const [{ data: meds, error: medsErr }, { data: products, error: prodErr }, { data: orders, error: ordersErr }] = await Promise.all([
      supabase
        .from('clinical_medications')
        .select('id, medication_name, presentation, dosage_text, rcta_prescription_id, rcta_status')
        .eq('patient_id', patientId)
        .eq('rcta_status', 'issued')
        .not('rcta_prescription_id', 'is', null),
      supabase
        .from('pharmacy_products')
        .select('*')
        .eq('pharmacy_id', PHARMACY_ID)
        .eq('in_stock', true)
        .not('medication_match', 'is', null),
      supabase
        .from('medication_orders')
        .select('rcta_prescription_id')
        .eq('patient_id', patientId)
        .not('rcta_prescription_id', 'is', null),
    ])
    if (medsErr) throw medsErr
    if (prodErr) throw prodErr
    if (ordersErr) throw ordersErr

    const alreadyOrdered = new Set((orders ?? []).map(o => o.rcta_prescription_id))

    const matches = []
    for (const med of meds ?? []) {
      if (alreadyOrdered.has(med.rcta_prescription_id)) continue
      const needle = (med.medication_name ?? '').toLowerCase()
      const product = (products ?? []).find(p =>
        p.medication_match.split(',').some(kw => needle.includes(kw.trim().toLowerCase()))
      )
      if (product) matches.push({ medication: toCamelCase(med), product: toCamelCase(product) })
    }
    return matches
  },
}
