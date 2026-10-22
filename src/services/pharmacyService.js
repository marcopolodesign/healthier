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

  /**
   * Batch fetch por id — usada para completar `imageUrl`/nombre/precio de
   * items que ya están en el carrito (base) pero que el caché local
   * `productsById` de `PharmacyCartContext` todavía no tiene (carrito recién
   * cargado, sin ningún `+`/`-` tocado en esta sesión). Ver el bug de fotos
   * que faltaban en un carrito recién abierto (2026-09-23).
   */
  async getByIds(ids) {
    const unique = [...new Set((ids ?? []).filter(Boolean))]
    if (unique.length === 0) return []
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .in('id', unique)
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
   * Lo recetado en UNA receta, cruzado contra el catálogo de la farmacia.
   *
   * Devuelve **todos** los medicamentos de la receta, con o sin producto: el
   * paciente tiene que poder ver que uno de los tres no está disponible, no
   * que simplemente no aparezca (Mateo, 2026-09-04).
   *
   * El producto es el que la base considera exactamente lo recetado (misma
   * droga, concentración y envase — `getMisRecetas`). Igual cada item viaja con
   * lo recetado Y el producto, porque los nombres del catálogo no son los de
   * la receta y la pantalla muestra las dos cosas.
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

    // Qué producto es exactamente lo recetado lo decide la base (migración
    // 214: misma droga, misma concentración y, si la receta lo dice, mismo
    // envase) — es la misma regla con la que después acepta o rechaza el
    // carrito. Antes se buscaba por palabra clave y una receta de 0,5 mg
    // ofrecía el de 2 mg.
    const lineas = await this.getMisRecetas()
    const productosDe = new Map(lineas.map(l => [l.clinicalMedicationId, new Set(l.productoIds ?? [])]))
    const buscarProducto = (medId) => {
      const ids = productosDe.get(medId)
      if (!ids?.size) return null
      return (products ?? []).find(p => ids.has(p.id)) ?? null
    }

    const medicamentos = toCamelCase(meds ?? []).map(med => {
      const raw = buscarProducto(med.id)
      return { medication: med, product: raw ? toCamelCase(raw) : null }
    })

    return { medicamentos, pedido: toCamelCase(orders ?? [])[0] ?? null }
  },

  /**
   * Las recetas del paciente para la farmacia, con su estado (vigente / usada /
   * vencida), hasta cuándo sirven, cuántos envases cubren y qué productos del
   * catálogo son exactamente lo recetado. Lo calcula la base
   * (`farmacia_mis_recetas`, migración 214) con la misma regla que valida el
   * carrito, así la pantalla nunca ofrece algo que después se rechaza.
   */
  async getMisRecetas() {
    const { data, error } = await supabase.rpc('farmacia_mis_recetas')
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  // ── Super admin: el piso legal del catálogo (migración 214) ──────────────
  // Drogas que nunca se venden como venta libre aunque la farmacia las cargue
  // así. Al agregar una, la base reclasifica el catálogo sola. RLS: sólo el
  // super admin escribe.
  async getDrogasBajoReceta() {
    const { data, error } = await supabase
      .from('farmacia_drogas_bajo_receta')
      .select('*')
      .order('tipo', { ascending: false })
      .order('droga')
    if (error) throw error
    return toCamelCase(data)
  },

  async addDrogaBajoReceta({ droga, tipo, motivo }) {
    const { error } = await supabase
      .from('farmacia_drogas_bajo_receta')
      .insert({ droga: droga.trim().toLowerCase(), tipo, motivo: motivo.trim() })
    if (error) throw error
  },

  async removeDrogaBajoReceta(droga) {
    const { error } = await supabase.from('farmacia_drogas_bajo_receta').delete().eq('droga', droga)
    if (error) throw error
  },
}
