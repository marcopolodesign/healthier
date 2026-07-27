import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isPatientWaiting, WAITING_HEARTBEAT_MS } from '../services/consultationsService'

/**
 * Tracks which of a professional's consultations currently have a patient
 * sitting in the waiting room.
 *
 * Two things have to happen for the professional to actually notice:
 *   1. Realtime — a patient who arrives after the page loaded must light up
 *      the row without a reload.
 *   2. A ticker — presence goes stale on its own (heartbeat stops when the
 *      patient closes the tab), and "esperando hace 4 min" has to keep
 *      counting. Neither produces a Postgres event, so we re-evaluate on a
 *      timer as well.
 *
 * @param {Array} consultations  Consultations already loaded by the caller.
 * @param {string} professionalId
 * @returns {(consultationId: string) => {waiting: boolean, since: Date|null}}
 */
export function useWaitingPresence(consultations, professionalId) {
  // Realtime overrides, keyed by consultation id. Seeded lazily — the
  // consultations prop stays the source of truth until an event arrives.
  const [presence, setPresence] = useState({})
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!professionalId) return
    const channel = supabase
      .channel(`waiting-presence-${professionalId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'consultations',
        filter: `professional_id=eq.${professionalId}`,
      }, ({ new: row }) => {
        if (!row?.id) return
        setPresence(prev => ({
          ...prev,
          [row.id]: {
            patientWaitingSince: row.patient_waiting_since,
            patientLastSeenAt:   row.patient_last_seen_at,
            status:              row.status,
          },
        }))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [professionalId])

  // Re-render so elapsed time advances and stale presence drops off.
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), WAITING_HEARTBEAT_MS)
    return () => clearInterval(iv)
  }, [])

  const byId = useMemo(() => {
    const map = {}
    for (const c of consultations ?? []) map[c.id] = c
    return map
  }, [consultations])

  return (consultationId) => {
    const base = byId[consultationId]
    const live = presence[consultationId]
    // Realtime carries the freshest presence, but only the loaded consultation
    // has the joined fields — merge rather than replace.
    const merged = live ? { ...base, ...live } : base
    if (!isPatientWaiting(merged)) return { waiting: false, since: null }
    return { waiting: true, since: new Date(merged.patientWaitingSince) }
  }
}

export default useWaitingPresence
