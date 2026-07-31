/**
 * biovisor-extract — lee un estudio de laboratorio con Gemini y devuelve los
 * biomarcadores estructurados.
 *
 * Dos acciones, las dos con la misma key del lado del servidor:
 *   { accion: 'extraer', path }              → { date, parameters }
 *       `path` es el objeto dentro de `patient-docs`. Se baja acá con el JWT del
 *       que llama, así que la RLS del bucket sigue mandando: el paciente dueño y
 *       el profesional con consulta compartida, nadie más. Se pasa el path y no
 *       el archivo porque analizar dejó de ser parte de subir — el paciente
 *       puede pedirlo días después, desde otro dispositivo, sin el archivo en la
 *       mano.
 *   { accion: 'resumen', parametros: [...] } → { resumen: string }
 *
 * POR QUÉ EXISTE ESTA FUNCIÓN Y NO SE LLAMA A GEMINI DESDE EL NAVEGADOR
 *
 * Antes el BioVisor llamaba a Gemini directo desde el cliente con
 * `VITE_GEMINI_API_KEY`. Cualquier `VITE_*` se compila dentro del bundle, así
 * que esa key queda **pública**: se lee con abrir el JS de producción, y
 * cualquiera puede gastar la cuota (y la facturación) del proyecto. Es la misma
 * regla que ya rige las credenciales de Mercado Pago y de RCTA en este repo:
 * las claves viven en secrets de Supabase, nunca en el `.env` del front.
 *
 * Efecto secundario útil: la key se rota en un solo lugar y sin redeployar el
 * front.
 *
 * El archivo NO se guarda acá — de eso se encarga el cliente contra el bucket
 * `patient-docs`, que ya tiene sus políticas (el paciente dueño, y el
 * profesional con consulta compartida; migración 081).
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

/** Tipos que Gemini puede leer. Un .docx o un .zip no tiene sentido mandarlo. */
const MIMES_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/** 15 MB de archivo original (el base64 pesa ~33% más). */
const MAX_BYTES = 15 * 1024 * 1024

/**
 * El prompt decía "Analizá este análisis de sangre", y el BioVisor recibe
 * cualquier estudio de laboratorio: orina, materia fecal, hisopados. Decirle a
 * Gemini que lo que está mirando es sangre cuando es un urocultivo lo empuja a
 * forzar la lectura. Ahora se le pide además que diga QUÉ estudio es, para poder
 * etiquetar la fila cuando el paciente no eligió el tipo al subirlo.
 *
 * `name` tiene que ser el nombre del analito a secas: la app agrupa la serie
 * histórica por nombre normalizado, así que "Glucosa (suero)" y "Glucosa"
 * quedarían como dos biomarcadores distintos y cortarían la evolución al medio.
 */
const PROMPT_EXTRAER = `Analizá este estudio de laboratorio. Puede ser de sangre, orina, materia fecal u otra muestra.
Extraé los parámetros medidos con sus valores, rangos de referencia y unidades.
Respondé ÚNICAMENTE con JSON válido siguiendo este esquema exacto (sin markdown, sin texto extra):
{"date":"YYYY-MM-DD","studyType":"string","parameters":[{"id":"string","name":"string","value":0,"min":0,"max":0,"unit":"string"}]}
El campo "date" es la fecha del estudio (si no encontrás fecha, usá la fecha de hoy).
El campo "studyType" es el nombre del estudio tal como lo titula el laboratorio (ej: "Hemograma completo", "Orina completa", "Perfil tiroideo"). Si no se puede determinar, devolvé "".
El campo "id" debe ser un string único (usá el índice numérico como string).
El campo "name" es el nombre del analito solo, sin la muestra ni el método entre paréntesis (ej: "Glucosa", no "Glucosa (suero, enzimático)").
Si un rango de referencia es abierto ("mayor a 40", "< 130"), poné 0 en el extremo que no exista.
Incluí SOLO parámetros con un valor numérico. Los resultados cualitativos (ej: "Negativo", "Ausente") no van.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ data: null, error: 'Method not allowed' }, 405)

  try {
    if (!GEMINI_API_KEY) {
      // Mensaje explícito: este fue exactamente el modo de falla que dejó la
      // función de análisis muerta durante semanas, con la key vacía en el .env.
      return json({ data: null, error: 'GEMINI_API_KEY no está configurada en el proyecto' }, 500)
    }

    // Sólo pacientes logueados. Sin esto la función sería un proxy abierto a
    // Gemini pagado por nosotros.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ data: null, error: 'Unauthorized' }, 401)

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return json({ data: null, error: 'Unauthorized' }, 401)

    const body = await req.json() as {
      accion?: string
      base64?: string
      mimeType?: string
      path?: string
      parametros?: Array<{ name?: string; value?: number; unit?: string; min?: number; max?: number }>
    }

    // ── Resumen en castellano de parámetros ya extraídos ──────────────────────
    if (body.accion === 'resumen') {
      const parametros = Array.isArray(body.parametros) ? body.parametros : []
      if (!parametros.length) return json({ data: null, error: 'No hay parámetros para analizar' }, 400)

      const resumenPedido = parametros
        .map(p => `${p.name}: ${p.value} ${p.unit ?? ''} (normal ${p.min}–${p.max})`)
        .join('\n')

      const rRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Sos un médico clínico. Analizá estos resultados de laboratorio y dá un resumen breve en español argentino. Sé claro y accesible, no alarmista. Máximo 4 oraciones.\n\n${resumenPedido}` }] }],
          generationConfig: {
            maxOutputTokens: 600,
            /*
             * Sin esto el resumen sale CORTADO a mitad de la primera oración
             * ("¡Hola! Acá te hago un resumen de tus"). En Gemini 2.5 los tokens
             * de razonamiento se descuentan de `maxOutputTokens`, así que con un
             * tope chico el modelo se gasta el presupuesto pensando y devuelve
             * medio texto — sin error, con `finishReason: MAX_TOKENS`. Para un
             * resumen de cuatro oraciones no hace falta que piense.
             */
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      })
      if (!rRes.ok) {
        console.error('biovisor-extract(resumen): Gemini', rRes.status, (await rRes.text()).slice(0, 300))
        return json({ data: null, error: `No pudimos generar el análisis (Gemini ${rRes.status})` }, 502)
      }
      const rPayload = await rRes.json()
      const resumen = rPayload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!resumen) return json({ data: null, error: 'El análisis volvió vacío' }, 502)
      return json({ data: { resumen }, error: null })
    }

    // ── Extracción de biomarcadores desde el archivo ──────────────────────────
    let { base64, mimeType } = body

    // Camino normal: el archivo ya está en `patient-docs` y se baja acá.
    if (!base64 && body.path) {
      const { data: blob, error: dlErr } = await supabase.storage
        .from('patient-docs')
        .download(body.path)
      if (dlErr || !blob) {
        console.error('biovisor-extract: no se pudo bajar', body.path, dlErr?.message)
        return json({ data: null, error: 'No pudimos abrir el estudio guardado' }, 404)
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      // En trozos: un `String.fromCharCode(...bytes)` de un PDF de varios MB
      // revienta el stack por cantidad de argumentos.
      let binario = ''
      const TROZO = 8192
      for (let i = 0; i < bytes.length; i += TROZO) {
        binario += String.fromCharCode(...bytes.subarray(i, i + TROZO))
      }
      base64 = btoa(binario)
      mimeType = blob.type || 'application/pdf'
    }

    if (!base64 || !mimeType) return json({ data: null, error: 'Faltan el archivo o su tipo' }, 400)
    if (!MIMES_OK.includes(mimeType)) {
      return json({ data: null, error: `Tipo de archivo no soportado: ${mimeType}` }, 415)
    }
    // `length * 3/4` es el tamaño real que representa el base64.
    if (base64.length * 0.75 > MAX_BYTES) {
      return json({ data: null, error: 'El archivo es demasiado grande (máximo 15 MB)' }, 413)
    }

    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT_EXTRAER },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })

    if (!res.ok) {
      const detalle = await res.text()
      console.error('biovisor-extract: Gemini error', res.status, detalle.slice(0, 500))
      // El detalle de Gemini no se le devuelve al paciente (puede incluir la
      // key en el eco de la URL), pero queda en los logs de la función.
      return json({ data: null, error: `No pudimos leer el estudio (Gemini ${res.status})` }, 502)
    }

    const payload = await res.json()
    const texto = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    let parsed: { date?: string; studyType?: string; parameters?: unknown[] }
    try {
      parsed = JSON.parse(texto)
    } catch {
      console.error('biovisor-extract: respuesta no-JSON de Gemini:', texto.slice(0, 300))
      return json({ data: null, error: 'No pudimos interpretar la respuesta del análisis' }, 502)
    }

    const parameters = (Array.isArray(parsed.parameters) ? parsed.parameters : [])
      .map((p, i) => {
        const item = p as Record<string, unknown>
        return {
          id: typeof item.id === 'string' && item.id ? item.id : String(i),
          name: String(item.name ?? ''),
          value: Number(item.value),
          min: item.min == null ? null : Number(item.min),
          max: item.max == null ? null : Number(item.max),
          unit: String(item.unit ?? ''),
        }
      })
      // Un parámetro sin nombre o sin valor numérico no se puede graficar ni
      // comparar: entra como ruido en el BioVisor y confunde al profesional.
      .filter(p => p.name && Number.isFinite(p.value))

    return json({
      data: {
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
          ? parsed.date
          : new Date().toISOString().slice(0, 10),
        studyType: typeof parsed.studyType === 'string' ? parsed.studyType.trim().slice(0, 120) : '',
        parameters,
      },
      error: null,
    })
  } catch (err) {
    console.error('biovisor-extract error:', err)
    return json({ data: null, error: err instanceof Error ? err.message : 'Error interno' }, 500)
  }
})
