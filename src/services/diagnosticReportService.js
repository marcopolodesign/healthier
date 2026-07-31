import { supabase, toCamelCase } from '../lib/supabase'
import { extraerPathDeStorage } from '../lib/storage'

const BUCKET = 'patient-docs'

/**
 * Sube al bucket con XHR en vez del cliente de Supabase, por una sola razón:
 * `supabase.storage.upload()` usa `fetch`, que **no informa progreso**. Un PDF
 * de análisis desde un teléfono tarda lo suficiente como para que una pantalla
 * quieta se lea como colgada — y no hay forma de mostrar un porcentaje real sin
 * los eventos de XHR.
 */
function subirConProgreso({ path, file, token, onProgreso }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('x-upsert', 'false')
    if (file.type) xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgreso?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let msg = `Error ${xhr.status} al subir el archivo`
      try { msg = JSON.parse(xhr.responseText)?.message ?? msg } catch { /* respuesta no-JSON */ }
      reject(new Error(msg))
    }
    xhr.onerror = () => reject(new Error('Se cortó la conexión al subir el archivo'))
    xhr.send(file)
  })
}


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

  /**
   * Sube el estudio y crea la fila — SIN analizarlo.
   *
   * Subir y analizar eran un solo paso: elegías el archivo y la extracción con
   * IA arrancaba sola. Se separaron a pedido de Mateo (2026-07-31) porque son
   * dos decisiones distintas: guardar el estudio en la historia es gratis y
   * siempre querés hacerlo; gastar tokens de IA en leerlo es opcional, y si la
   * extracción fallaba te quedabas sin ninguna de las dos cosas.
   *
   * La fila nace con `parameters: []` (default de la columna) y `reportDate` de
   * hoy; el análisis, si se pide, corrige la fecha con la que diga el estudio.
   */
  async subirEstudio({ patientId, file, studyType = null, practiceCode = null, onProgreso }) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Tenés que volver a iniciar sesión para subir un estudio.')

    // El nombre se limpia: los espacios y acentos del nombre original rompen la
    // URL del objeto y después el archivo no se puede volver a abrir.
    const nombreLimpio = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${patientId}/biovisor/${Date.now()}_${nombreLimpio}`

    await subirConProgreso({ path, file, token, onProgreso })

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return this.create({
      patientId,
      reportDate: new Date().toISOString().slice(0, 10),
      parameters: [],
      documentUrl: data.publicUrl,
      studyType,
      practiceCode,
    })
  },

  /**
   * Extrae los biomarcadores de un estudio YA subido y los guarda en su fila.
   * Es el paso que el paciente pide a mano con "Analizar con IA".
   */
  async analizarEstudio(report) {
    const path = extraerPathDeStorage(BUCKET, report.documentUrl)
    if (!path) throw new Error('Este estudio no tiene el archivo original guardado.')

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Tenés que volver a iniciar sesión para analizar un estudio.')

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/biovisor-extract`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accion: 'extraer', path }),
      }
    )
    const json = await res.json().catch(() => ({ error: 'Respuesta inválida del servidor' }))
    if (!res.ok || json?.error) throw new Error(json?.error ?? `HTTP ${res.status}`)

    const { date, parameters } = json.data
    if (!parameters?.length) throw new Error('No encontramos parámetros en este documento.')

    const { data: fila, error } = await supabase
      .from('diagnostic_reports')
      .update({ parameters, report_date: date })
      .eq('id', report.id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(fila)
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
