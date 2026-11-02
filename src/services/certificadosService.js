import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Certificados de la consulta — constancia de atención, reposo y escolar
 * (migraciones 222/224). Se emiten por el servicio de recetas desde la Edge
 * Function `rcta-certificado`: el front nunca escribe la tabla, sólo la lee
 * (la RLS deja leer al paciente los suyos y al profesional los que emitió).
 */

export const TIPOS_CERTIFICADO = {
  constancia: { label: 'Constancia', titulo: 'Constancia de atención' },
  reposo:     { label: 'Reposo',     titulo: 'Certificado de reposo' },
  escolar:    { label: 'Escolar',    titulo: 'Certificado escolar' },
}

/** "Reposo · 3 días", "Escolar · 1 día", "Constancia de atención". */
export function nombreDelCertificado(c) {
  if (c.tipo === 'constancia') return 'Constancia de atención'
  const n = Number(c.dias ?? 0)
  return `${TIPOS_CERTIFICADO[c.tipo]?.label ?? 'Certificado'} · ${n} ${n === 1 ? 'día' : 'días'}`
}

async function llamar(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rcta-certificado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error ?? `Error del servicio de certificados (${res.status})`)
    err.code = data.code ?? null
    throw err
  }
  return data
}

export const certificadosService = {
  async listarDeConsulta(consultationId) {
    if (!consultationId) return []
    const { data, error } = await supabase
      .from('clinical_certificates')
      .select('*')
      .eq('consultation_id', consultationId)
      .in('status', ['issued', 'anulado'])
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Los vigentes del paciente, para la Bóveda. */
  async listarDelPaciente(patientId) {
    if (!patientId) return []
    const { data, error } = await supabase
      .from('clinical_certificates')
      .select('id, tipo, dias, desde, rcta_pdf_url, rcta_issued_at, created_at, professional:profiles!professional_id(full_name)')
      .eq('patient_id', patientId)
      .eq('status', 'issued')
      .not('rcta_pdf_url', 'is', null)
      .order('rcta_issued_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Lo que va a decir el PDF, armado del mismo payload que se emitiría. No sale nada afuera. */
  vistaPrevia(datos) { return llamar({ accion: 'vista_previa', ...datos }) },

  async emitir(datos) {
    const { certificado } = await llamar({ accion: 'emitir', ...datos })
    return toCamelCase(certificado)
  },

  anular(certificadoId) { return llamar({ accion: 'anular', certificadoId }) },
}
