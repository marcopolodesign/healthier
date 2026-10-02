/**
 * pharmacyAdminService.js — catalog CRUD + Excel import/export + MP
 * connection for the pharmacy back-office panel. Mirrors mpService.js's
 * connect/disconnect pattern but against pharmacy-mp-connect /
 * pharmacy_mp_accounts instead of the professional's mp-connect.
 */
import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
import { medicationOrdersService } from './medicationOrdersService'
import { callEdgeFunction } from '../lib/edgeFunction'
import { PRESCRIPTION_TYPE_LABELS } from '../lib/pharmacyExcel'

const PHARMACY_ID = medicationOrdersService.PHARMACY_ID
const PRODUCT_IMAGES_BUCKET = 'pharmacy-products'
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

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

  /**
   * Sube la foto de un producto al bucket `pharmacy-products` y la deja en su
   * `image_url`. Cada subida usa un nombre nuevo (id + hora) para que la
   * foto reemplazada no quede servida desde la caché del CDN. Sólo el
   * administrador de la farmacia tiene permiso (migración 182 + RLS de
   * pharmacy_products). Los errores se tiran con el mensaje real.
   */
  async uploadProductImage(productId, file) {
    const tipos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
    const ext = tipos[file?.type]
    if (!ext) throw new Error('La foto tiene que ser JPG, PNG o WEBP.')
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      throw new Error(`La foto pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es 5 MB.`)
    }
    const path = `${productId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false })
    if (upErr) throw new Error(`No se pudo subir la foto: ${upErr.message}`)
    const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path)
    const { data, error } = await supabase
      .from('pharmacy_products')
      .update({ image_url: pub.publicUrl })
      .eq('id', productId)
      .select()
    if (error) throw new Error(`La foto se subió pero no se pudo guardar en el producto: ${error.message}`)
    if (!data?.length) throw new Error('La foto se subió pero el producto no se actualizó (sin permiso o no existe).')
    return toCamelCase(data[0])
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
      prescriptionType: r.prescriptionType,
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
      'Categoría receta': PRESCRIPTION_TYPE_LABELS[p.prescriptionType] ?? PRESCRIPTION_TYPE_LABELS.venta_libre,
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
