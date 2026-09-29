import { useCallback, useEffect, useRef, useState } from 'react'
import { consultationsService } from '../services/consultationsService'
import { hydrateDraft } from '../lib/consultaDraft'
import { mensajeDeError } from '../lib/supabase'

const PERSIST_DELAY_MS = 1500

/**
 * Estado del borrador de la "consulta estructurada" (`ConsultaEstructurada`),
 * persistido debounced en `consultations.hc_draft` (migración 122).
 *
 * Es estado flow-critical (regla de State Resilience de CLAUDE.md): si se
 * cae la llamada o se cierra la pestaña a mitad de documentar, no se puede
 * perder lo cargado. Por eso vive en la base y no sólo en memoria — se
 * restaura al montar desde `consultation.hc_draft`, que ya viene cargado por
 * `consultationsService.getById` antes de que este panel exista.
 *
 * `consultationId` es estable en la práctica (la página de videollamada no
 * cambia de consulta sin un remount de ruta), pero se cubre el caso de todos
 * modos: si cambia, se re-hidrata desde `initialHcDraft` en vez de arrastrar
 * el draft de la consulta anterior.
 */
export function useConsultaDraft({ consultationId, initialHcDraft }) {
  const [draft, setDraft] = useState(() => hydrateDraft(initialHcDraft))
  // Motivo del último autoguardado fallido, o null si el último salió bien.
  const [errorGuardado, setErrorGuardado] = useState(null)
  const prevIdRef = useRef(consultationId)
  const timerRef = useRef(null)
  const consultationIdRef = useRef(consultationId)
  consultationIdRef.current = consultationId

  useEffect(() => {
    if (prevIdRef.current === consultationId) return
    prevIdRef.current = consultationId
    setDraft(hydrateDraft(initialHcDraft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const persist = useCallback(next => {
    if (!consultationIdRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      consultationsService.update(consultationIdRef.current, { hcDraft: next })
        .then(() => setErrorGuardado(null))
        .catch(err => {
          // Sin toast: perder un ciclo no puede interrumpir al profesional, y
          // el próximo cambio reintenta. Pero ya no es mudo — el 2026-09-28
          // el borrador dejó de guardarse varios minutos (sesión perdida en el
          // WebView) y nada lo decía. La pantalla muestra este motivo.
          setErrorGuardado(mensajeDeError(err))
        })
    }, PERSIST_DELAY_MS)
  }, [])

  const update = useCallback(updater => {
    setDraft(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      persist(next)
      return next
    })
  }, [persist])

  return { draft, update, errorGuardado }
}
