import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightning, Clock, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { ondemandService } from '../../services/ondemandService'
import { toast } from '../Toast'

/**
 * Pedidos de consulta inmediata esperando a que alguien los tome.
 *
 * Aparece en el panel del profesional y se actualiza sin recargar. Es la mitad
 * visible del modelo de despacho (migración 067): el pedido no tiene médico
 * asignado hasta que alguien toca "Aceptar".
 *
 * Nota: esto funciona porque `consultations`/`ondemand_requests` están
 * publicadas a Realtime — hasta el 2026-07-27 la única tabla publicada era
 * `walk_in_queue` y toda suscripción `postgres_changes` de la app era código
 * muerto (migración 065).
 */
function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)))
  useEffect(() => {
    const iv = setInterval(() => {
      setLeft(Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(iv)
  }, [expiresAt])
  return left
}

function RequestCard({ request, onAccept, accepting }) {
  const left = useCountdown(request.expiresAt)
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const urgent = left <= 30
  // El síntoma ya viene contestado si el paciente alcanzó a completarlo mientras
  // sonaba — se muestra para que el profesional decida con información.
  const motivo = request.preconsultaData?.mainComplaint ?? request.preconsultaData?.main_complaint

  if (left <= 0) return null

  return (
    <div className="rounded-xl border-2 border-brand bg-brand-muted/40 p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center shrink-0">
        <Lightning className="h-5 w-5 text-white" weight="fill" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-text-primary truncate">
          {request.patient?.fullName ?? 'Paciente'}
        </p>
        <p className="text-xs text-text-secondary truncate">
          Consulta inmediata{motivo ? ` · ${motivo}` : ''}
          {request.priceAtRequest ? ` · $${Number(request.priceAtRequest).toLocaleString('es-AR')}` : ''}
        </p>
      </div>
      <span className={`flex items-center gap-1 text-xs font-mono font-bold tabular-nums shrink-0 ${urgent ? 'text-danger' : 'text-text-secondary'}`}>
        <Clock className="h-3.5 w-3.5" /> {mm}:{ss}
      </span>
      <button
        onClick={() => onAccept(request.id)}
        disabled={accepting}
        className="btn-primary text-sm px-4 py-2 shrink-0 disabled:opacity-60"
      >
        {accepting ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Aceptar'}
      </button>
    </div>
  )
}

export default function IncomingRequests({ profile }) {
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [acceptingId, setAcceptingId] = useState(null)
  const acceptingRef = useRef(false)

  const load = useCallback(() => {
    ondemandService.listOpen().then(setRequests).catch(() => {})
  }, [])

  useEffect(() => {
    if (profile?.role !== 'professional') return
    load()
    // Realtime trae los pedidos nuevos; el refetch resuelve el resto (que otro
    // lo haya tomado, que haya vencido) sin tener que replicar acá las reglas
    // de visibilidad, que viven en RLS.
    const ch = supabase
      .channel('ondemand-incoming')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ondemand_requests' }, load)
      .subscribe()
    // Barrido local: los vencidos desaparecen solos aunque no llegue ningún evento.
    const iv = setInterval(load, 20_000)
    return () => { supabase.removeChannel(ch); clearInterval(iv) }
  }, [profile?.role, load])

  const handleAccept = async (requestId) => {
    // Guard local contra el doble click; la carrera real la resuelve el RPC.
    if (acceptingRef.current) return
    acceptingRef.current = true
    setAcceptingId(requestId)
    try {
      const consultationId = await ondemandService.accept(requestId)
      if (!consultationId) {
        toast.info('Otro profesional tomó esta consulta.')
        load()
        return
      }
      toast.success('Consulta aceptada — entrando a la sala')
      navigate(`/profesional/videollamada/${consultationId}`)
    } catch (err) {
      toast.error(err?.message ?? 'No pudimos aceptar la consulta.')
    } finally {
      acceptingRef.current = false
      setAcceptingId(null)
    }
  }

  if (!requests.length) return null

  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand" />
        </span>
        <h2 className="text-sm font-bold text-text-primary">
          {requests.length === 1 ? 'Un paciente te está pidiendo una consulta' : `${requests.length} pacientes esperando`}
        </h2>
      </div>
      {requests.map(r => (
        <RequestCard
          key={r.id}
          request={r}
          onAccept={handleAccept}
          accepting={acceptingId === r.id}
        />
      ))}
    </div>
  )
}
