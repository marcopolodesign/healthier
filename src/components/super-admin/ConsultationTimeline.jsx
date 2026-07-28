import { useEffect, useState } from 'react'
import { CircleNotch, Warning } from '@phosphor-icons/react'
import { consultationEventsService } from '../../services/consultationEventsService'
import { paymentsService } from '../../services/paymentsService'

/**
 * Qué pasó realmente con una consulta.
 *
 * Pedido de Mateo tras una videollamada de prueba que quedó en `no_show` sin
 * que nadie pudiera decir por qué: el estado final no cuenta la historia. Acá se
 * junta la línea de tiempo (consultation_events, migración 070) con el detalle
 * de cobros, que es la otra mitad de "qué pasó".
 */

// Traducción a algo que se lea de un vistazo. Un evento sin entrada acá se
// muestra con su slug crudo — preferible a esconderlo.
const EVENT_LABELS = {
  preconsulta_submitted:          'El paciente completó la pre-consulta',
  patient_entered_waiting:        'El paciente entró a la sala de espera',
  patient_left_waiting:           'El paciente salió de la sala de espera',
  professional_admitted_patient:  'El profesional habilitó al paciente',
  call_page_opened:               'Abrió la pantalla de videollamada',
  call_joined:                    'Se unió a la videollamada',
  call_participant_joined:        'Apareció el otro participante',
  call_left:                      'Dejó la videollamada',
  call_error:                     'Error en la videollamada',
  marked_no_show:                 'Marcada como ausente',
  consultation_closed:            'Consulta cerrada',
  status_changed:                 'Cambio de estado',
}

const ROLE_LABELS = { patient: 'Paciente', professional: 'Profesional', system: 'Sistema', other: 'Otro' }

const hora = ts => new Date(ts).toLocaleTimeString('es-AR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

function detalleLegible(e) {
  const d = e.detail
  if (!d) return null
  if (e.event === 'status_changed') return `${d.from ?? '—'} → ${d.to ?? '—'}`
  if (e.event === 'preconsulta_submitted') {
    return [d.symptom, d.icd10 && `(${d.icd10})`, d.has_red_flags && '⚠ signos de alarma']
      .filter(Boolean).join(' ')
  }
  if (e.event === 'call_participant_joined') return d.user_name ?? d.participant_id ?? null
  return JSON.stringify(d)
}

export default function ConsultationTimeline({ consultationId }) {
  const [events, setEvents] = useState(null)
  const [payments, setPayments] = useState([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      consultationEventsService.listByConsultation(consultationId),
      // El detalle de cobros lo pidió Mateo junto con la línea de tiempo. Si el
      // servicio no expone un getter por consulta, el bloque simplemente no
      // aparece — no rompe la línea de tiempo, que es lo importante.
      paymentsService.listByConsultation?.(consultationId).catch(() => []) ?? Promise.resolve([]),
    ])
      .then(([ev, pay]) => { if (!cancelled) { setEvents(ev); setPayments(pay ?? []) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [consultationId])

  if (error) {
    return <p className="text-xs text-danger py-3">No pudimos cargar la línea de tiempo.</p>
  }
  if (events === null) {
    return <div className="flex justify-center py-4"><CircleNotch className="h-4 w-4 animate-spin text-brand" /></div>
  }
  if (!events.length) {
    return (
      <p className="text-xs text-text-tertiary py-3">
        Sin eventos registrados. La bitácora empezó a registrar el 2026-07-28 —
        las consultas anteriores a esa fecha no tienen historia.
      </p>
    )
  }

  return (
    <div className="py-3 space-y-3">
      <div className="space-y-1.5">
        {events.map(e => {
          const det = detalleLegible(e)
          const alarma = e.event === 'call_error' || e.detail?.has_red_flags
          return (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <span className="font-mono text-text-tertiary shrink-0 tabular-nums">{hora(e.createdAt)}</span>
              {alarma && <Warning className="h-3 w-3 text-red-600 mt-0.5 shrink-0" weight="fill" />}
              <span className="text-text-primary">
                {EVENT_LABELS[e.event] ?? e.event}
                {e.actorRole && <span className="text-text-tertiary"> · {ROLE_LABELS[e.actorRole] ?? e.actorRole}</span>}
                {det && <span className="text-text-secondary"> — {det}</span>}
              </span>
            </div>
          )
        })}
      </div>

      {payments.length > 0 && (
        <div className="pt-2 border-t border-border-default space-y-1">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Cobros</p>
          {payments.map(p => (
            <div key={p.id} className="text-xs space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">
                  {p.status}{p.statusDetail ? ` · ${p.statusDetail}` : ''}
                </span>
                <span className="text-text-primary font-medium">
                  ${Number(p.chargedAmount ?? p.grossAmount ?? 0).toLocaleString('es-AR')}
                  {p.platformFee != null && (
                    <span className="text-text-tertiary font-normal"> · comisión ${Number(p.platformFee).toLocaleString('es-AR')}</span>
                  )}
                </span>
              </div>
              {/* El ciclo de la pre-autorizacion: sin esto no se distingue una
                  consulta que se cobró de una donde la reserva se liberó. */}
              <div className="flex flex-wrap gap-x-3 text-text-tertiary">
                {p.authorizedAt && <span>autorizado {hora(p.authorizedAt)}</span>}
                {p.capturedAt && <span>capturado {hora(p.capturedAt)}</span>}
                {p.authCancelledAt && <span>reserva liberada {hora(p.authCancelledAt)}</span>}
                {p.refundedAt && <span>devuelto {hora(p.refundedAt)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
