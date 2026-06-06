const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`

const VERTICAL_KEYWORDS = {
  mente: ['ansiedad', 'estres', 'estrés', 'depresion', 'depresión', 'nervioso', 'tristeza', 'panico', 'pánico'],
  nutricion: ['dieta', 'peso', 'nutricion', 'nutrición', 'comer', 'apetito', 'digestion', 'digestión'],
  fisico: ['rodilla', 'espalda', 'dolor muscular', 'lesion', 'lesión', 'fractura', 'tobillo', 'hombro'],
}

function fallbackTriage(symptoms) {
  const lower = symptoms.toLowerCase()
  for (const [id, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return id
  }
  return 'clinica'
}

export const aiService = {
  async triage(symptoms) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) {
      // Graceful fallback without real key
      await new Promise(r => setTimeout(r, 900))
      const id = fallbackTriage(symptoms)
      return {
        recomendacion_id: id,
        mensaje: getMockMessage(id),
      }
    }

    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Sos un asistente médico de triage. Un paciente describe: "${symptoms}"\n\nBasándote en los síntomas, respondé en formato JSON con:\n- "recomendacion_id": una de estas opciones: "clinica", "mente", "nutricion", "fisico"\n- "mensaje": un mensaje breve (máximo 2 oraciones) en español argentino, empático y no alarmista, explicando tu recomendación. Terminá con "Consultá con un profesional para un diagnóstico preciso."\n\nRespondé SOLO con el JSON, sin markdown.`,
            }],
          }],
          generationConfig: { maxOutputTokens: 200, responseMimeType: 'application/json' },
        }),
      })
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      const parsed = JSON.parse(text)
      if (!parsed.recomendacion_id || !parsed.mensaje) throw new Error('Invalid response')
      return parsed
    } catch {
      // Fallback on any Gemini error
      const id = fallbackTriage(symptoms)
      return { recomendacion_id: id, mensaje: getMockMessage(id) }
    }
  },
}

function getMockMessage(id) {
  return {
    clinica: 'Tus síntomas podrían indicar un cuadro infeccioso o inflamatorio. Consultá con un médico clínico para una evaluación completa. Consultá con un profesional para un diagnóstico preciso.',
    mente: 'Los síntomas que describís pueden estar relacionados con estrés o ansiedad. Un profesional en salud mental puede ayudarte a manejarlos. Consultá con un profesional para un diagnóstico preciso.',
    nutricion: 'Estos síntomas podrían estar relacionados con tu alimentación. Un nutricionista puede orientarte con un plan personalizado. Consultá con un profesional para un diagnóstico preciso.',
    fisico: 'El dolor que describís puede tener origen musculoesquelético. Un kinesiólogo puede evaluarte y armar un plan. Consultá con un profesional para un diagnóstico preciso.',
  }[id] ?? 'Consultá con un profesional de la salud para una evaluación. Consultá con un profesional para un diagnóstico preciso.'
}
