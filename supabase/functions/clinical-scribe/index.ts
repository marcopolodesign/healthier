import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Same section set surfaced in OnboardingPreview.jsx's NOTE_SECTIONS preview —
// keep both in sync if this list changes.
const SCRIBE_SECTIONS = [
  'motivo_consulta', 'edad', 'historia_social', 'antecedentes_medicos',
  'medicamentos_actuales', 'alergias', 'historia_familiar', 'consumo_alcohol',
  'consumo_tabaco', 'sustancias_controladas', 'dispositivos_asistencia',
  'dieta', 'actividad_fisica', 'sueno', 'historia_enfermedad_actual', 'examen_fisico',
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function callGemini(parts: unknown[], generationConfig: Record<string, unknown>) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('Gemini API error:', errText)
    throw new Error(`Gemini error: ${res.status}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

async function transcribeChunk({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) {
  const text = await callGemini(
    [
      { text: 'Transcribí este audio de una consulta médica en Argentina, en español. Devolvé SOLO el texto transcripto, sin comentarios ni formato adicional. Si no se entiende nada, devolvé una cadena vacía.' },
      { inlineData: { mimeType, data: audioBase64 } },
    ],
    { maxOutputTokens: 2048 }
  )
  return { transcript: text.trim() }
}

async function extractNote({ transcript, specialty }: { transcript: string; specialty?: string }) {
  const prompt = `Sos un asistente clínico que arma una historia clínica estructurada a partir de la transcripción de una consulta médica en Argentina (especialidad: ${specialty ?? 'no especificada'}).

Transcripción completa:
"""
${transcript}
"""

Extraé la información y devolvé un JSON con EXACTAMENTE estas claves (todas en string, en español argentino):
${SCRIBE_SECTIONS.map(s => `- "${s}"`).join('\n')}

Reglas obligatorias:
- Nunca inventés información que no esté en la transcripción.
- Si una sección no fue mencionada, devolvé cadena vacía "" para esa clave — no la omitas ni la completes con suposiciones.
- Sé conciso, en prosa clínica breve, no copies la transcripción literal salvo que sea necesario.
- Respondé SOLO con el JSON, sin markdown ni texto extra.`

  const text = await callGemini(
    [{ text: prompt }],
    { maxOutputTokens: 2048, responseMimeType: 'application/json' }
  )
  const structuredData = JSON.parse(text)
  return { structuredData }
}

async function voiceEdit({
  structuredData, instructionText, instructionAudioBase64, instructionMimeType,
}: {
  structuredData: Record<string, string>
  instructionText?: string
  instructionAudioBase64?: string
  instructionMimeType?: string
}) {
  const prompt = `Esta es la historia clínica estructurada actual (JSON):
${JSON.stringify(structuredData)}

El profesional pidió el siguiente cambio (por voz o texto, adjunto abajo). Aplicá SOLO ese cambio, dejando el resto de las claves exactamente igual. Devolvé el JSON completo actualizado, con las mismas claves que el original (${SCRIBE_SECTIONS.join(', ')}), sin agregar ni quitar claves. Respondé SOLO con el JSON, sin markdown ni texto extra.`

  const parts: unknown[] = [{ text: prompt }]
  if (instructionAudioBase64) {
    parts.push({ text: 'Instrucción hablada del profesional (audio adjunto):' })
    parts.push({ inlineData: { mimeType: instructionMimeType ?? 'audio/webm', data: instructionAudioBase64 } })
  } else if (instructionText) {
    parts.push({ text: `Instrucción del profesional: "${instructionText}"` })
  } else {
    throw new Error('instructionText or instructionAudioBase64 required')
  }

  const text = await callGemini(parts, { maxOutputTokens: 2048, responseMimeType: 'application/json' })
  const updated = JSON.parse(text)
  return { structuredData: updated }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'transcribe_chunk':
        return jsonResponse(await transcribeChunk(body))
      case 'extract_note':
        return jsonResponse(await extractNote(body))
      case 'voice_edit':
        return jsonResponse(await voiceEdit(body))
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('clinical-scribe error:', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
