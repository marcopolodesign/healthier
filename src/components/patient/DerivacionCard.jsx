import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShareFat, CaretRight } from '@phosphor-icons/react'
import { derivacionesService, destinoLabel } from '../../services/derivacionesService'
import { useEspecialidades } from '../../hooks/useEspecialidades'

/**
 * "Tu médico te derivó a …" — una tarjeta por cada derivación viva (pendiente y
 * sin vencer) del paciente o de los familiares que administra. Se trae sola y no
 * muestra nada si no hay: es aditiva, nunca bloquea el inicio.
 */
export default function DerivacionCard({ profile }) {
  const navigate = useNavigate()
  const { porSlug } = useEspecialidades()
  const [derivaciones, setDerivaciones] = useState([])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    derivacionesService.listarPendientesVisibles()
      .then(rows => { if (!cancelled) setDerivaciones(rows.slice(0, 3)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [profile?.id])

  if (derivaciones.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {derivaciones.map(d => {
        const paraOtro = d.patientId !== profile.id
        return (
          <button
            key={d.id}
            onClick={() => navigate(`/paciente/derivaciones/${d.id}`)}
            className="w-full rounded-[28px] bg-white border border-brand-tertiary/40 shadow-[0_8px_24px_rgba(155,142,196,0.18)] p-5 flex items-center gap-4 text-left active:scale-[0.98] hover:border-brand-tertiary transition-all"
          >
            <div className="w-11 h-11 rounded-full bg-brand-tertiary/10 flex items-center justify-center flex-shrink-0">
              <ShareFat className="w-5 h-5 text-brand-tertiary" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-brand-tertiary block">
                {paraOtro ? `Derivación para ${d.paciente?.fullName?.split(' ')[0] ?? 'tu familiar'}` : 'Derivación'}
              </span>
              <p className="text-[15px] font-semibold text-text-primary leading-tight mt-1 truncate">
                {d.estado === 'rechazada'
                  ? `${d.destino?.fullName ?? 'El profesional'} no puede tomarla — elegí otro profesional`
                  : `${d.derivado?.fullName ?? 'Tu médico'} te derivó a ${destinoLabel(d, porSlug)}`}
              </p>
              <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-1">{d.motivo}</p>
            </div>
            <CaretRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
