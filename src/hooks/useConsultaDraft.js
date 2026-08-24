import { useCallback, useEffect, useRef, useState } from 'react'
import { consultationsService } from '../services/consultationsService'
import { hydrateDraft } from '../lib/consultaDraft'

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
      consultationsService.update(consultationIdRef.current, { hcDraft: next }).catch(() => {
        // Falla en silencio a propósito: perder un ciclo de autoguardado no
        // puede interrumpir al profesional en medio de la consulta. El
        // próximo cambio reintenta.
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

  return { draft, update }
}
