const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const MAX_HISTORY = 20

function getMockResponse(message) {
  const lower = message.toLowerCase()

  if (/agenda|hoy|consulta|turno/.test(lower)) {
    return {
      text: `Hoy tenés 3 consultas programadas:\n• 09:00 — María García (Presencial)\n• 11:30 — Carlos López (Videoconsulta)\n• 16:00 — Ana Martínez (Presencial)\n\nTodo en orden para la jornada.`,
      followUps: ['¿Detalles de María García?', '¿Qué tengo mañana?', '¿Algún pendiente hoy?'],
    }
  }

  if (/pr[oó]ximo|siguiente/.test(lower)) {
    return {
      text: 'Tu próxima consulta es a las 11:30 con Carlos López — Videoconsulta. Quedan aproximadamente 2 horas.',
      followUps: ['¿Historia clínica de Carlos?', '¿Cómo entro a la videoconsulta?', '¿Consultas de esta tarde?'],
    }
  }

  if (/pendiente/.test(lower)) {
    return {
      text: `Tus pendientes de hoy:\n• Historia clínica de María García\n• Resultado de laboratorio — Carlos López\n• Derivación a cardiólogo — Ana Martínez`,
      followUps: ['¿Cómo completo la historia clínica?', '¿Recetas pendientes?', '¿Resumen de la semana?'],
    }
  }

  return {
    text: 'Puedo ayudarte con tu agenda, información de pacientes, notas clínicas y priorización de tareas. ¿Qué necesitás?',
    followUps: ['¿Qué tengo hoy?', 'Próximo paciente', 'Mis pendientes'],
  }
}

function parseJsonResponse(raw) {
  try {
    const parsed = JSON.parse(raw)
    return {
      text: parsed.message ?? raw,
      followUps: Array.isArray(parsed.follow_ups) ? parsed.follow_ups.slice(0, 3) : [],
      navigateTo: parsed.navigate_to ?? null,
    }
  } catch {
    // Claude sometimes wraps in markdown code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        return {
          text: parsed.message ?? raw,
          followUps: Array.isArray(parsed.follow_ups) ? parsed.follow_ups.slice(0, 3) : [],
          navigateTo: parsed.navigate_to ?? null,
        }
      } catch { /* fall through */ }
    }
    return { text: raw, followUps: [], navigateTo: null }
  }
}

const companionService = {
  buildSystemPrompt(profile, todayConsultations, allConsultations) {
    const dateStr = new Date().toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    const doctorName = profile?.fullName ?? 'Doctor/a'
    const specialty = profile?.profSpecialty ?? profile?.specialty ?? 'sin especialidad especificada'

    const scheduleLines =
      todayConsultations && todayConsultations.length > 0
        ? todayConsultations
            .map(c => `  • ${c.time} — ${c.patientName} (${c.modality}, estado: ${c.status})`)
            .join('\n')
        : '  Sin consultas programadas para hoy.'

    const totalPatients =
      allConsultations && allConsultations.length > 0
        ? new Set(allConsultations.map(c => c.patientId).filter(Boolean)).size
        : 0

    return `Sos el asistente de IA de Healthier, ayudando al Dr./Dra. ${doctorName}, especialista en ${specialty}.

Fecha de hoy: ${dateStr}

Agenda de hoy:
${scheduleLines}

Total de pacientes en el sistema: ${totalPatients}

Tu rol es ayudar al profesional con:
- Gestión y consulta de su agenda diaria
- Información sobre sus pacientes (solo la que te fue proporcionada)
- Notas clínicas y recordatorios
- Priorización de tareas del día
- Preguntas sobre el flujo de trabajo en Healthier

Estilo:
- Cálido pero eficiente; respuestas concisas y directas
- Español argentino (tuteo)
- Nunca inventés datos médicos ni información de pacientes que no te haya sido suministrada
- Si no tenés un dato, decilo claramente

## Navegación disponible
Podés llevar al médico a cualquiera de estas páginas incluyendo "navigate_to" en tu respuesta:
- /profesional/agenda → cuando pide ver su agenda, turnos o calendario
- /profesional/pacientes → cuando pide ver sus pacientes
- /profesional/historial → cuando pide ver historial o consultas pasadas
- /profesional/ganancias → cuando pide ver ingresos o ganancias
- /profesional/perfil → cuando pide editar su perfil
- /profesional/dashboard → cuando pide volver al inicio

## Formato de respuesta — OBLIGATORIO
Respondé SIEMPRE con JSON válido, sin texto extra ni bloques de código:
{
  "message": "Tu respuesta completa aquí",
  "follow_ups": ["Pregunta corta 1", "Pregunta corta 2", "Pregunta corta 3"],
  "navigate_to": "/profesional/agenda"
}
- message: respuesta completa en español argentino. Podés usar viñetas con • para listas.
- follow_ups: exactamente 3 preguntas de seguimiento, menos de 8 palabras cada una, relevantes para el médico.
- navigate_to: ruta a la que navegar. Omitir (o null) si el usuario no pidió ir a ninguna página.`
  },

  async getContext(profile, allConsultations) {
    const today = new Date().toDateString()
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    const todayConsultations = (allConsultations ?? [])
      .filter(c => c.scheduledAt && new Date(c.scheduledAt).toDateString() === today)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .map(c => ({
        id: c.id,
        time: new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        patientName: c.patient?.fullName ?? 'Paciente sin nombre',
        modality: c.modality === 'video' ? 'Videoconsulta' : 'Presencial',
        status: c.status,
      }))

    const upcomingConsultations = (allConsultations ?? [])
      .filter(c => {
        if (!c.scheduledAt) return false
        const d = new Date(c.scheduledAt)
        return d > now && d.toDateString() !== today
      })
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, 5)
      .map(c => ({
        id: c.id,
        time: new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        patientName: c.patient?.fullName ?? 'Paciente sin nombre',
        modality: c.modality === 'video' ? 'Videoconsulta' : 'Presencial',
        status: c.status,
      }))

    const totalPatients = new Set(
      (allConsultations ?? []).map(c => c.patientId).filter(Boolean)
    ).size

    return { todayConsultations, upcomingConsultations, totalPatients }
  },

  async sendMessage(messages, systemPrompt) {
    // Cap history to avoid token bloat
    const trimmed = messages.slice(-MAX_HISTORY)

    if (!ANTHROPIC_API_KEY) {
      await new Promise(r => setTimeout(r, 900))
      const lastMsg = trimmed[trimmed.length - 1]?.content ?? ''
      return getMockResponse(lastMsg)
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages: trimmed,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const raw = data.content?.[0]?.text ?? ''
      return parseJsonResponse(raw)
    } catch (err) {
      console.error('[companionService] API error:', err?.message ?? err)
      return {
        text: `No pude conectarme (${err?.message ?? 'error desconocido'}). Revisá tu conexión e intentá de nuevo.`,
        followUps: [],
        navigateTo: null,
      }
    }
  },
}

export default companionService
