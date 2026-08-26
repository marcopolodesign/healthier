/**
 * pharmacyAdminService.js — catalog CRUD + Excel import/export + MP
 * connection for the pharmacy back-office panel. Mirrors mpService.js's
 * connect/disconnect pattern but against pharmacy-mp-connect /
 * pharmacy_mp_accounts instead of the professional's mp-connect.
 */
import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
import { medicationOrdersService } from './medicationOrdersService'
import { callEdgeFunction } from '../lib/edgeFunction'

const PHARMACY_ID = medicationOrdersService.PHARMACY_ID

export const pharmacyAdminService = {
  PHARMACY_ID,

  // ── Catálogo ──────────────────────────────────────────────────────────
  async getCatalog() {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .select('*')
      .eq('pharmacy_id', PHARMACY_ID)
      .order('name')
    if (error) throw error
    return toCamelCase(data)
  },

  async upsertProduct(product) {
    const { data, error } = await supabase
      .from('pharmacy_products')
      .upsert(toSnakeCase({ pharmacyId: PHARMACY_ID, ...product }), { onConflict: 'id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async deleteProduct(id) {
    const { error } = await supabase.from('pharmacy_products').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Upserts by SKU (rows without a SKU are always inserted as new — nothing
   * to match on). Returns a summary for the import preview/confirmation UI.
   */
  async bulkUpsertFromImport(rows) {
    const withSku = rows.filter(r => r.sku)
    const withoutSku = rows.filter(r => !r.sku)
    const summary = { inserted: 0, updated: 0, errors: [] }

    const rowToPayload = r => toSnakeCase({
      pharmacyId: PHARMACY_ID,
      sku: r.sku ?? undefined,
      name: r.nombre,
      presentation: r.presentacion ?? null,
      price: r.precio,
      stockQuantity: r.stock,
      requiresPrescription: r.requiereReceta,
      category: r.category ?? 'clinica',
    })

    const writes = []

    if (withSku.length) {
      const { data: existing, error: existingErr } = await supabase
        .from('pharmacy_products')
        .select('id, sku')
        .eq('pharmacy_id', PHARMACY_ID)
        .in('sku', withSku.map(r => r.sku))
      if (existingErr) throw existingErr
      const existingBySku = new Map((existing ?? []).map(r => [r.sku, r.id]))

      const payload = withSku.map(r => ({ id: existingBySku.get(r.sku), ...rowToPayload(r) }))
      summary.updated = payload.filter(p => p.id).length
      summary.inserted += payload.filter(p => !p.id).length

      writes.push(
        supabase.from('pharmacy_products').upsert(payload, { onConflict: 'sku' })
          .then(({ error }) => { if (error) throw error })
      )
    }

    if (withoutSku.length) {
      const payload = withoutSku.map(rowToPayload)
      summary.inserted += payload.length
      writes.push(
        supabase.from('pharmacy_products').insert(payload)
          .then(({ error }) => { if (error) throw error })
      )
    }

    await Promise.all(writes)
    return summary
  },

  async exportCatalogRows() {
    const products = await this.getCatalog()
    return products.map(p => ({
      SKU: p.sku ?? '',
      Nombre: p.name,
      Presentación: p.presentation ?? '',
      Precio: p.price,
      Stock: p.stockQuantity,
      'Requiere receta': p.requiresPrescription ? 'SI' : 'NO',
      Disponible: p.inStock ? 'SI' : 'NO',
    }))
  },

  // ── Mercado Pago ──────────────────────────────────────────────────────
  getMpConnectUrl() {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pharmacy-mp-connect?action=authorize&pharmacyId=${PHARMACY_ID}`
  },

  async disconnectMp() {
    try {
      await callEdgeFunction('pharmacy-mp-connect?action=disconnect', { pharmacyId: PHARMACY_ID })
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: err.message }
    }
  },

  async getConnectionStatus() {
    try {
      const { data, error } = await supabase
        .from('pharmacies')
        .select('mp_connected')
        .eq('id', PHARMACY_ID)
        .maybeSingle()
      if (error) return { data: { connected: false }, error: error.message }
      return { data: { connected: !!data?.mp_connected }, error: null }
    } catch (err) {
      return { data: { connected: false }, error: err.message }
    }
  },

  // ── Configuración ─────────────────────────────────────────────────────
  async getPharmacy() {
    const { data, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('id', PHARMACY_ID)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async updatePharmacy(fields) {
    const { data, error } = await supabase
      .from('pharmacies')
      .update(toSnakeCase(fields))
      .eq('id', PHARMACY_ID)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },
}
