import { supabase, toCamelCase } from '../lib/supabase'

/** Lee el archivo como base64 sin el prefijo `data:...;base64,`. */
function aBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const [, base64 = ''] = String(reader.result).split(',')
      resolve({ base64, mimeType: file.type || 'application/pdf' })
    }
    reader.onerror = () => reject(new Error('No pudimos leer el archivo'))
    reader.readAsDataURL(file)
  })
}

export const diagnosticReportService = {
  /**
   * Manda el estudio a `biovisor-extract` (Gemini del lado del servidor) y
   * devuelve `{ date, parameters }`.
   *
   * La llamada a Gemini vivía en la pantalla, con la key en `VITE_GEMINI_API_KEY`
   * — o sea compilada dentro del bundle y pública para cualquiera que abra el JS
   * de producción. Ahora la key es un secret de Supabase y el navegador nunca la
   * ve. Ver el encabezado de `supabase/functions/biovisor-extract/index.ts`.
   */
  async extraerParametros(file) {
    const { base64, mimeType } = await aBase64(file)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Tenés que volver a iniciar sesión para analizar un estudio.')

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/biovisor-extract`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accion: 'extraer', base64, mimeType }),
      }
    )
    const json = await res.json().catch(() => ({ error: 'Respuesta inválida del servidor' }))
    if (!res.ok || json?.error) throw new Error(json?.error ?? `HTTP ${res.status}`)
    return json.data
  },

  /**
   * Resumen en castellano de los parámetros ya extraídos. Misma función, misma
   * key del lado del servidor — el botón "Analizar" también llamaba a Gemini
   * desde el navegador.
   */
  async resumirParametros(parametros) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Tenés que volver a iniciar sesión para usar el análisis.')

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/biovisor-extract`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accion: 'resumen', parametros }),
      }
    )
    const json = await res.json().catch(() => ({ error: 'Respuesta inválida del servidor' }))
    if (!res.ok || json?.error) throw new Error(json?.error ?? `HTTP ${res.status}`)
    return json.data.resumen
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('diagnostic_reports')
      .select('*')
      .eq('patient_id', patientId)
      .order('report_date', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Guarda el PDF/imagen del estudio en el bucket privado `patient-docs`.
   *
   * Va en el service y no en la pantalla porque el bucket es privado: la URL que
   * devuelve `getPublicUrl` no sirve por sí sola, hay que firmarla para verla
   * (`SignedDocLink` ya hace eso en el resto de la app). Guardar el path acá y
   * firmarlo al mostrar es el mismo patrón que usa `documentsService`.
   */
  async uploadDocumento(patientId, file) {
    const path = `${patientId}/biovisor/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('patient-docs').upload(path, file)
    if (error) throw error
    const { data } = supabase.storage.from('patient-docs').getPublicUrl(path)
    return data.publicUrl
  },

  async create({ patientId, reportDate, parameters, documentUrl = null, studyType = null, practiceCode = null }) {
    const { data, error } = await supabase
      .from('diagnostic_reports')
      .insert({
        patient_id: patientId,
        report_date: reportDate,
        parameters,
        // El PDF original. Se guardaba `null` siempre: el BioVisor extraía los
        // valores y tiraba el archivo, así que no había forma de contrastar un
        // valor raro contra el estudio real (migración 080).
        document_url: documentUrl,
        study_type: studyType,
        practice_code: practiceCode,
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id) {
    const { error } = await supabase
      .from('diagnostic_reports')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
