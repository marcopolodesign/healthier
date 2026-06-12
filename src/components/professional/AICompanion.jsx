import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkle, X, PaperPlaneTilt, CalendarBlank, Clock, Users, ArrowCounterClockwise } from '@phosphor-icons/react'
import companionService from '../../services/companionService'
import { consultationsService } from '../../services/consultationsService'

const QUICK_ACTIONS = [
  { id: 'agenda', label: '¿Qué tengo hoy?', icon: CalendarBlank, navigateTo: '/profesional/agenda' },
  { id: 'next', label: 'Próximo paciente', icon: Clock, navigateTo: '/profesional/pacientes' },
  { id: 'pending', label: 'Pendientes', icon: Users, navigateTo: '/profesional/historial' },
]

// Minimal markdown: **bold**, bullet lines starting with •/- /*
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
      <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-bounce-dot-1" />
      <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-bounce-dot-2" />
      <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary animate-bounce-dot-3" />
    </span>
  )
}

export default function AICompanion({ open, onClose, profile, profSpecialty }) {
  const navigate = useNavigate()
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
    if (!open || !profile || initialized) return
    let cancelled = false

    async function init() {
      try {
        const consultations = await consultationsService.getByProfessional(profile.id)
        if (cancelled) return

        const context = await companionService.getContext(profile, consultations)
        if (cancelled) return

        const prompt = companionService.buildSystemPrompt(
          { ...profile, profSpecialty },
          context.todayConsultations,
          consultations
        )
        if (cancelled) return

        setSystemPrompt(prompt)

        const lastName = profile.fullName?.split(' ').slice(-1)[0] ?? 'Doctor'
        let greeting, followUps

        if (context.todayConsultations.length > 0) {
          const first = context.todayConsultations[0]
          greeting = `¡Hola, Dr./Dra. ${lastName}! Hoy tenés ${context.todayConsultations.length} consulta${context.todayConsultations.length !== 1 ? 's' : ''} programada${context.todayConsultations.length !== 1 ? 's' : ''}. La primera es a las ${first.time} con ${first.patientName.split(' ')[0]}. ¿En qué te ayudo?`
          followUps = ['¿Qué tengo hoy?', 'Próximo paciente', 'Mis pendientes']
        } else {
          greeting = `¡Hola, Dr./Dra. ${lastName}! No tenés consultas programadas para hoy. ¿En qué te puedo ayudar?`
          followUps = ['¿Tengo algo mañana?', 'Ver mis pacientes', 'Mis pendientes']
        }

        setMessages([{ role: 'assistant', content: greeting, followUps }])
        setInitialized(true)
      } catch {
        if (cancelled) return
        const lastName = profile.fullName?.split(' ').slice(-1)[0] ?? 'Doctor'
        setMessages([{
          role: 'assistant',
          content: `¡Hola, Dr./Dra. ${lastName}! Estoy listo para ayudarte. ¿Qué necesitás?`,
          followUps: ['¿Qué tengo hoy?', 'Próximo paciente', 'Mis pendientes'],
        }])
        setInitialized(true)
      }
    }

    init()
    return () => { cancelled = true }
  }, [open, profile, initialized])

  async function sendMessage(text) {
    const trimmed = (text ?? input).trim()
    if (!trimmed || loading) return

    const userMsg = { role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', followUps: [], loading: true }])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    try {
      const history = [...messages, userMsg]
        .filter(m => !m.loading)
        .map(m => ({ role: m.role, content: m.content }))

      const { text: responseText, followUps, navigateTo } = await companionService.sendMessage(history, systemPrompt)

      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: responseText, followUps: followUps ?? [] }
        return updated
      })

      if (navigateTo) {
        setTimeout(() => navigate(navigateTo), 600)
      }
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
    // Outer: in-flow flex item that animates width 0 ↔ w-80 to push the content panel
    <div className={[
      'hidden lg:flex flex-col flex-shrink-0',
      'overflow-hidden will-change-[width]',
      'transition-[width] duration-300 ease-out',
      open ? 'w-[calc(20rem+0.75rem)]' : 'w-0',
    ].join(' ')}
    >
    {/* Inner: fixed-width card — clipped by outer as it collapses; mr-3 gives the gap without a phantom space when closed */}
    <div className="flex flex-col h-full w-80 flex-shrink-0 mr-3 bg-white border border-border-default rounded-2xl overflow-hidden shadow-[4px_4px_32px_rgba(0,0,0,0.10)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-border-default bg-brand-muted flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
            <Sparkle weight="fill" className="h-4 w-4 text-white" />
          </div>
          <p className="text-sm font-semibold text-text-primary">Healthy</p>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleReset}
              className="p-1.5 rounded-lg hover:bg-bg-surface text-text-tertiary hover:text-text-secondary transition-colors"
              title="Reiniciar conversación"
            >
              <ArrowCounterClockwise className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-surface text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={['flex', msg.role === 'user' ? 'justify-end' : 'justify-start items-end gap-2'].join(' ')}>
              {msg.role === 'assistant' && (
                <div className="h-6 w-6 rounded-full bg-brand flex items-center justify-center flex-shrink-0 mb-0.5">
                  <Sparkle weight="fill" className="h-3 w-3 text-white" />
                </div>
              )}
              <div className={[
                'max-w-[85%] px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-brand text-white rounded-2xl rounded-tr-sm'
                  : 'bg-bg-surface border border-border-default text-text-primary rounded-2xl rounded-tl-sm',
              ].join(' ')}>
                {msg.loading
                  ? <TypingDots />
                  : <span className="whitespace-pre-wrap break-words leading-relaxed">
                      {renderMarkdown(msg.content)}
                    </span>
                }
              </div>
            </div>

            {/* Follow-up chips — only on last assistant message */}
            {msg.role === 'assistant' && !msg.loading && msg.followUps?.length > 0 && i > 0 && i === messages.length - 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                {msg.followUps.map((q, j) => (
                  <button
                    key={j}
                    onClick={() => sendMessage(q)}
                    disabled={loading}
                    className="text-xs px-2.5 py-1.5 rounded-full border border-brand/30 text-brand bg-brand-muted hover:bg-brand hover:text-white transition-colors disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Quick actions — before first user message */}
        {!hasUserMessages && messages.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-text-tertiary font-medium uppercase tracking-wide mb-2">Acciones rápidas</p>
            <div className="flex flex-col gap-1.5">
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.id}
                  onClick={() => {
                    if (action.navigateTo) navigate(action.navigateTo)
                    sendMessage(action.label)
                  }}
                  disabled={loading}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border-default bg-white hover:bg-bg-surface text-sm text-text-primary transition-colors text-left disabled:opacity-50"
                >
                  <action.icon className="h-4 w-4 text-brand flex-shrink-0" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-4 pt-3 border-t border-border-default flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Escribí tu consulta..."
            rows={1}
            disabled={loading}
            className="flex-1 form-input text-sm resize-none py-2 rounded-xl min-h-[38px] max-h-[120px] overflow-y-auto disabled:opacity-50 leading-relaxed"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="btn-primary h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          >
            <PaperPlaneTilt weight="fill" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
    </div>
  )
}
