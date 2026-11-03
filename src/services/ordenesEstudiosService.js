import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Órdenes de estudios emitidas por el servicio de recetas (migración 227).
 * Las emite la Edge Function `rcta-estudios` a partir de la orden guardada en
 * la HC (`clinical_entries`, entry_type 'order'). El front nunca escribe la
 * tabla: la RLS deja leer al paciente las suyas y al profesional las que emitió.
 */

async function llamar(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rcta-estudios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error ?? `Error del servicio de recetas (${res.status})`)
    err.code = data.code ?? null
    throw err
  }
  return data
}

/** "Hemograma, Ferritina y 3 más". */
export function resumenDeEstudios(estudios = [], max = 2) {
  const nombres = (estudios ?? []).map(e => e?.nombre).filter(Boolean)
  if (nombres.length <= max) return nombres.join(', ')
  return `${nombres.slice(0, max).join(', ')} y ${nombres.length - max} más`
}

export const ordenesEstudiosService = {
  /** Las emisiones de estas órdenes de la HC (para el panel del profesional). */
  async listarDeEntradas(entryIds) {
    if (!entryIds?.length) return []
    const { data, error } = await supabase
      .from('clinical_study_orders')
      .select('*')
      .in('entry_id', entryIds)
      .or('status.in.(issued,anulado),a_revisar.eq.true')
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Las vigentes del paciente, para la Bóveda. */
  async listarDelPaciente(patientId) {
    if (!patientId) return []
    const { data, error } = await supabase
      .from('clinical_study_orders')
      .select('id, estudios, rcta_pdf_url, rcta_issued_at, created_at, professional:profiles!professional_id(full_name)')
      .eq('patient_id', patientId)
      .eq('status', 'issued')
      .not('rcta_pdf_url', 'is', null)
      .order('rcta_issued_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** `{ orden, yaEstaba, recuperada }`. */
  async emitir(entryId) {
    const r = await llamar({ accion: 'emitir', entryId })
    return { orden: toCamelCase(r.orden), yaEstaba: r.yaEstaba === true, recuperada: r.recuperada === true }
  },

  anular(ordenId) { return llamar({ accion: 'anular', ordenId }) },

  /** Super admin: las que pudieron haber salido sin respuesta registrada. */
  async listarARevisar() {
    const { data, error } = await supabase.from('clinical_study_orders')
      .select('id, created_at, estudios, error_detalle, patient:profiles!patient_id(full_name), professional:profiles!professional_id(full_name)')
      .eq('a_revisar', true).order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  async liberarARevisar(id) {
    const { error } = await supabase.rpc('liberar_orden_estudios_a_revisar', { p_id: id })
    if (error) throw error
  },
}
