import { supabase, toCamelCase } from '../lib/supabase'
import { medicationOrdersService } from './medicationOrdersService'

const PHARMACY_ID = medicationOrdersService.PHARMACY_ID

export const pharmacyService = {
  /**
   * La farmacia sólo está habilitada para pacientes que ya se atendieron al
   * menos una vez con un profesional de Healthier. Llama a la misma función
   * que usa la policy de INSERT en medication_orders (migración 130) — acá
   * sólo para mostrar el mensaje antes de dejarlos armar un carrito; el RLS
   * es el que realmente bloquea la compra.
   */
  async hasBeenAttended() {
    const { data, error } = await supabase.rpc('patient_has_completed_consultation')
    if (error) throw error
    return !!data
  },

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
  /**
   * Lo recetado en UNA receta, cruzado contra el catálogo de la farmacia.
   *
   * Devuelve **todos** los medicamentos de la receta, con o sin producto: el
   * paciente tiene que poder ver que uno de los tres no está disponible, no
   * que simplemente no aparezca (Mateo, 2026-09-04). Por eso esto no reusa
   * `getPrescribedMatches`, que descarta lo que no matchea.
   *
   * 🔴 **El match es por palabra clave, no por marca ni por dosis.** Puede
   * traer otra presentación de la misma droga, así que cada item viaja con lo
   * recetado Y lo que es el producto, para que la pantalla pueda mostrar las
   * dos cosas y ninguna diferencia pase inadvertida — ver la regla de exactitud
   * de datos de medicamentos. Nunca presentar el producto como si fuera
   * exactamente lo recetado.
   *
   * `pedido` es el pedido que ya incluye esta receta, si existe: una receta ya
   * pedida no se vuelve a comprar desde acá, se muestra el pedido.
   */
  async getPrescriptionMatch(prescriptionId, patientId) {
    if (!prescriptionId || !patientId) return { medicamentos: [], pedido: null }

    const [{ data: meds, error: medsErr }, { data: products, error: prodErr }, { data: orders, error: ordersErr }] = await Promise.all([
      supabase
        .from('clinical_medications')
        .select('id, medication_name, presentation, dosage_text, frequency, duration_days, quantity, notes, rcta_prescription_id, rcta_pdf_url, rcta_issued_at, created_at, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .eq('rcta_prescription_id', prescriptionId)
        .order('created_at', { ascending: true }),
      supabase
        .from('pharmacy_products')
        .select('*')
        .eq('pharmacy_id', PHARMACY_ID)
        .eq('in_stock', true)
        .not('medication_match', 'is', null),
      supabase
        .from('medication_orders')
        .select('id, status, created_at')
        .eq('patient_id', patientId)
        .eq('rcta_prescription_id', prescriptionId)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    if (medsErr) throw medsErr
    if (prodErr) throw prodErr
    if (ordersErr) throw ordersErr

    const buscarProducto = (nombre) => {
      const needle = (nombre ?? '').toLowerCase()
      if (!needle) return null
      return (products ?? []).find(p =>
        (p.medication_match ?? '').split(',').some(kw => kw.trim() && needle.includes(kw.trim().toLowerCase()))
      ) ?? null
    }

    const medicamentos = toCamelCase(meds ?? []).map(med => {
      const raw = buscarProducto(med.medicationName)
      return { medication: med, product: raw ? toCamelCase(raw) : null }
    })

    return { medicamentos, pedido: toCamelCase(orders ?? [])[0] ?? null }
  },

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
