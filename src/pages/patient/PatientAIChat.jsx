import { useState, useRef, useEffect } from 'react'
import { Sparkle, PaperPlaneTilt, ArrowCounterClockwise } from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import companionService from '../../services/companionService'
import { track } from '../../utils/analytics'

// Short, stable id derived from a prompt's display text — never send the raw
// text itself to analytics (only category-like ids).
function slugifyPrompt(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
}

const QUICK_ACTIONS = [
  '¿Qué medicaciones tomo actualmente?',
  '¿Cuáles son mis alergias?',
  '¿Cuándo fue mi última consulta?',
]

function renderMarkdown(text) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const isBullet = /^[•\-\*] /.test(line)
    const content = line.replace(/^[•\-\*] /, '')
    const parts = (isBullet ? content : line).split(/\*\*(.*?)\*\*/g)
    const formatted = parts.map((part, j) =>
      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
    )
    if (isBullet) {
      return (
        <span key={i} className="flex gap-1.5 items-start">
          <span className="text-brand mt-0.5 shrink-0">•</span>
          <span>{formatted}</span>
        </span>
      )
    }
    return <span key={i}>{formatted}{i < lines.length - 1 && line !== '' && <br />}</span>
  })
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-0.5">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce-dot-1" />
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce-dot-2" />
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce-dot-3" />
    </span>
  )
}

function buildPatientSystemPrompt(profile, timeline) {
  const name = profile?.fullName ?? 'Paciente'

  const allergies = (timeline?.allergies ?? [])
    .filter(a => a.clinicalStatus === 'active')
    .map(a => `${a.allergen}${a.severity ? ` (${a.severity})` : ''}`)

  const recentEncounters = (timeline?.encounters ?? []).slice(0, 5).map(enc => {
    const dateStr = enc.createdAt
      ? new Date(enc.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'fecha desconocida'
    const proName = enc.professional?.fullName ?? 'Profesional'
    const specialty = enc.professional?.professionalProfiles?.[0]?.specialty ?? ''
    const conditions = (enc.conditions ?? []).map(c => c.display).join(', ')
    const medications = (enc.medications ?? []).filter(m => m.status === 'active').map(m => `${m.medicationName}${m.dosage ? ` ${m.dosage}` : ''}`).join(', ')
    const notes = (enc.entries ?? []).filter(e => e.entryType === 'note').map(e => e.content).join(' ')
    let line = `• ${dateStr} — ${proName}${specialty ? ` (${specialty})` : ''}`
    if (conditions) line += `\n  Diagnósticos: ${conditions}`
    if (medications) line += `\n  Medicaciones: ${medications}`
    if (notes) line += `\n  Nota: ${notes.slice(0, 200)}`
    return line
  })

  const allActiveMeds = (timeline?.encounters ?? [])
    .flatMap(e => e.medications ?? [])
    .filter(m => m.status === 'active')
    .map(m => `${m.medicationName}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? `, ${m.frequency}` : ''}`)

  const activeMedsUnique = [...new Set(allActiveMeds)]

  return `Sos Healthy, el asistente de salud personal de ${name} en la plataforma Healthier.

Tu rol es ayudar al paciente a entender su historial clínico, recordar sus medicaciones y alergias, y responder preguntas de salud general basadas en su historia. NUNCA inventés datos que no estén en la historia clínica del paciente.

## Historial clínico de ${name}

**Alergias activas:**
${allergies.length > 0 ? allergies.map(a => `• ${a}`).join('\n') : 'Sin alergias registradas.'}

**Medicaciones activas:**
${activeMedsUnique.length > 0 ? activeMedsUnique.map(m => `• ${m}`).join('\n') : 'Sin medicaciones activas registradas.'}

**Consultas recientes:**
${recentEncounters.length > 0 ? recentEncounters.join('\n\n') : 'Sin consultas registradas.'}

## Estilo
- Cálido, claro y empático. Español argentino (tuteo).
- Explicá términos médicos en lenguaje simple.
- Si el paciente pregunta algo que no está en su historia, decilo claramente y sugerí que consulte con su médico.
- Respondé en texto plano con viñetas cuando sea útil. No uses JSON.
- Podés sugerir 2-3 preguntas de seguimiento relevantes al final, en formato: "Podés preguntarme: • ..." (opcional, solo cuando agregue valor).`
}

export default function PatientAIChat({ profile }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [initialized, setInitialized] = useState(false)

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    track('ia_chat_open', {})
  }, [])

  useEffect(() => {
    if (!profile?.id || initialized) return
    let cancelled = false

    async function init() {
      try {
        const timeline = await historiaClinicaService.getPatientTimeline(profile.id)
        if (cancelled) return

        const prompt = buildPatientSystemPrompt(profile, timeline)
        if (cancelled) return

        setSystemPrompt(prompt)

        const firstName = profile.fullName?.split(' ')[0] ?? 'hola'
        const hasHistory = (timeline?.encounters?.length ?? 0) > 0
        const hasAllergies = (timeline?.allergies ?? []).some(a => a.clinicalStatus === 'active')

        let greeting = `¡Hola, ${firstName}! Soy Healthy, tu asistente de salud. `
        if (hasHistory) {
          greeting += `Tengo acceso a tu historial clínico y puedo ayudarte a entender tus consultas, medicaciones y alergias. ¿Qué querés saber?`
        } else {
          greeting += `Todavía no tenés consultas registradas en Healthier. Cuando hagas tu primera consulta, podré ayudarte a revisar tu historial clínico. Por ahora podés preguntarme sobre salud en general.`
        }

        const followUps = hasAllergies
          ? ['¿Cuáles son mis alergias?', '¿Qué medicaciones tomo?', '¿Cuándo fue mi última consulta?']
          : ['¿Cómo reservo una consulta?', '¿Qué especialistas hay?', '¿Cómo funciona Healthier?']

        if (!cancelled) {
          setMessages([{ role: 'assistant', content: greeting, followUps }])
          setInitialized(true)
        }
      } catch {
        if (cancelled) return
        const firstName = profile.fullName?.split(' ')[0] ?? 'hola'
        setMessages([{
          role: 'assistant',
          content: `¡Hola, ${firstName}! Soy Healthy, tu asistente de salud. ¿En qué te puedo ayudar hoy?`,
          followUps: QUICK_ACTIONS,
        }])
        setInitialized(true)
      }
    }

    init()
    return () => { cancelled = true }
  }, [profile?.id, initialized])

  async function sendMessage(text, type = 'free_text') {
    const trimmed = (text ?? input).trim()
    if (!trimmed || loading) return

    track('ia_message_sent', { message_type: type, message_length: trimmed.length })

    const userMsg = { role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true }])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    try {
      const history = [...messages, userMsg]
        .filter(m => !m.loading)
        .map(m => ({ role: m.role, content: m.content }))

      const requestStartedAt = Date.now()
      const { text: responseText } = await companionService.sendMessage(history, systemPrompt)
      track('ia_response_received', { response_time_ms: Date.now() - requestStartedAt })

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: responseText, followUps: [] }
        return updated
      })
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'No pude conectarme ahora. Revisá tu conexión e intentá de nuevo.',
          followUps: [],
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleInputChange(e) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  function handleReset() {
    setMessages([])
    setSystemPrompt('')
    setInitialized(false)
  }

  const hasUserMessages = messages.some(m => m.role === 'user')

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
            <Sparkle weight="fill" className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-base font-semibold text-text-primary leading-none">Healthy</p>
            <p className="text-xs text-text-tertiary mt-0.5">Tu asistente de salud</p>
          </div>
        </div>
        {messages.length > 1 && (
          <button
            onClick={handleReset}
            className="p-2 rounded-xl hover:bg-bg-surface text-text-tertiary hover:text-text-secondary transition-colors"
            title="Nueva conversación"
          >
            <ArrowCounterClockwise className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start items-end gap-2'}`}>
              {msg.role === 'assistant' && (
                <div className="h-7 w-7 rounded-full bg-brand flex items-center justify-center flex-shrink-0 mb-0.5">
                  <Sparkle weight="fill" className="h-3.5 w-3.5 text-white" />
                </div>
              )}
              <div className={[
                'max-w-[82%] px-3.5 py-2.5 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-brand text-white rounded-2xl rounded-tr-sm'
                  : 'bg-white border border-gray-100 shadow-sm text-text-primary rounded-2xl rounded-tl-sm',
              ].join(' ')}>
                {msg.loading
                  ? <TypingDots />
                  : <span className="whitespace-pre-wrap break-words">{renderMarkdown(msg.content)}</span>
                }
              </div>
            </div>

            {/* Follow-up chips */}
            {msg.role === 'assistant' && !msg.loading && msg.followUps?.length > 0 && i === messages.length - 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-9">
                {msg.followUps.map((q, j) => (
                  <button
                    key={j}
                    onClick={() => { track('ia_suggested_prompt_click', { prompt_id: slugifyPrompt(q) }); sendMessage(q, 'suggested') }}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded-full border border-brand/30 text-brand bg-white hover:bg-brand hover:text-white transition-colors disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Quick actions before first user message */}
        {!hasUserMessages && messages.length > 0 && (
          <div className="mt-2 ml-9">
            <div className="flex flex-col gap-1.5">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => { track('ia_suggested_prompt_click', { prompt_id: slugifyPrompt(action) }); sendMessage(action, 'suggested') }}
                  disabled={loading}
                  className="text-left text-sm px-3 py-2.5 rounded-xl border border-gray-100 bg-white shadow-sm text-text-secondary hover:border-brand/30 hover:text-brand transition-colors disabled:opacity-50"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 pb-4 pt-3 border-t border-gray-100 bg-bg-secondary flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Hacé una pregunta sobre tu salud..."
            rows={1}
            disabled={loading}
            className="flex-1 form-input text-sm resize-none py-2.5 rounded-xl min-h-[42px] max-h-[120px] overflow-y-auto disabled:opacity-50 leading-relaxed"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="btn-primary h-[42px] w-[42px] rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          >
            <PaperPlaneTilt weight="fill" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
