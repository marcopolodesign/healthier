// TODO: wire real backend — replace mock with Gemini 2.5 Flash call
// Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent
// API key: import.meta.env.VITE_GEMINI_API_KEY

const MOCK_RESPONSES = [
  {
    recomendacion_id: 'clinica',
    mensaje: 'Tus síntomas podrían indicar una infección respiratoria o cuadro gripal. Te recomendamos consultar con un médico clínico para una evaluación completa. *Consulta a un médico para diagnóstico exacto.*',
  },
  {
    recomendacion_id: 'mente',
    mensaje: 'Los síntomas que describes pueden estar relacionados con estrés o ansiedad. Un profesional en salud mental puede ayudarte a manejarlos. *Consulta a un médico para diagnóstico exacto.*',
  },
  {
    recomendacion_id: 'nutricion',
    mensaje: 'Estos síntomas podrían estar relacionados con tu alimentación. Un nutricionista puede orientarte con un plan personalizado. *Consulta a un médico para diagnóstico exacto.*',
  },
  {
    recomendacion_id: 'fisico',
    mensaje: 'El dolor o malestar que describes puede tener origen musculoesquelético. Un kinesiólogo puede evaluarte y armar un plan de rehab. *Consulta a un médico para diagnóstico exacto.*',
  },
]

export const aiService = {
  // Returns { recomendacion_id, mensaje } after a realistic delay
  async triage(symptoms) {
    await new Promise(r => setTimeout(r, 1800))
    const lower = symptoms.toLowerCase()
    if (lower.includes('ansiedad') || lower.includes('estres') || lower.includes('estrés') || lower.includes('depresion')) {
      return MOCK_RESPONSES[1]
    }
    if (lower.includes('dieta') || lower.includes('peso') || lower.includes('nutricion') || lower.includes('comer')) {
      return MOCK_RESPONSES[2]
    }
    if (lower.includes('rodilla') || lower.includes('espalda') || lower.includes('dolor muscular') || lower.includes('lesion')) {
      return MOCK_RESPONSES[3]
    }
    return MOCK_RESPONSES[0]
  },
}
