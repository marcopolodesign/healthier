import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, UserCircle, ShareFat, ShieldCheck, CircleNotch, CalendarCheck } from '@phosphor-icons/react'
import { derivacionesService, destinoLabel, derivacionVigente } from '../../services/derivacionesService'
import { professionalService } from '../../services/professionalService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { verticalForSpecialty } from '../../lib/verticals'
import DerivacionEstado from '../../components/DerivacionEstado'
import { toast } from '../../components/Toast'

function ProCard({ etiqueta, profile, specialty, porSlug }) {
  const avatar = profile?.avatarUrl
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-bg-secondary border border-border-default p-4">
      {avatar ? (
        <img src={avatar} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-11 h-11 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
          <UserCircle className="w-5 h-5 text-brand" />
        </div>
      )}
      <div className="min-w-0">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary block">{etiqueta}</span>
        <p className="text-[15px] font-semibold text-text-primary truncate">{profile?.fullName ?? '—'}</p>
        {specialty && <p className="text-[12px] text-text-secondary truncate">{porSlug[specialty] ?? specialty}</p>}
      </div>
    </div>
  )
}

/**
 * `/paciente/derivaciones/:id` — a donde lleva la tarjeta del inicio y el aviso.
 *
 * El paciente ve quién lo derivó, a quién y por qué, decide si comparte su
 * historia clínica con quien lo va a atender y recién después reserva. La
 * respuesta es obligatoria (sí o no) antes de reservar, y se puede cambiar.
 */
export default function Derivacion({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { porSlug, especialidades: catalogo } = useEspecialidades()
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [respondiendo, setRespondiendo] = useState(false)
  const [especialidades, setEspecialidades] = useState({ derivado: null, destino: null })

  const cargar = () =>
    derivacionesService.getById(id)
      .then(setD)
      .catch(err => toast.error(err?.message ?? 'No pudimos cargar la derivación'))
      .finally(() => setLoading(false))

  useEffect(() => { cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // La especialidad de cada profesional sale de su legajo, no de `profiles`.
  useEffect(() => {
    if (!d) return
    let cancelled = false
    const especialidadDe = async (userId) => {
      if (!userId) return null
      try { return (await professionalService.getByUserId(userId))?.specialty ?? null } catch { return null }
    }
    Promise.all([especialidadDe(d.derivadoPor), especialidadDe(d.profesionalDestinoId)])
      .then(([derivado, destino]) => { if (!cancelled) setEspecialidades({ derivado, destino }) })
    return () => { cancelled = true }
  }, [d?.derivadoPor, d?.profesionalDestinoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const responder = async (acepta) => {
    setRespondiendo(true)
    try {
      await derivacionesService.responderConsentimiento(d.id, acepta)
      await cargar()
      toast.success(acepta ? 'Vas a compartir tu historia clínica' : 'No vas a compartir tu historia clínica')
    } catch (err) {
      toast.error(err?.message ?? 'No pudimos guardar tu respuesta')
    } finally {
      setRespondiendo(false)
    }
  }

  const reservar = () => {
    const params = new URLSearchParams({ derivacion: d.id })
    if (d.patientId !== profile?.id) params.set('para', d.patientId)
    if (d.profesionalDestinoId) {
      params.set('proId', d.profesionalDestinoId)
      // Con el área del profesional el wizard arranca en la modalidad, igual
      // que desde su perfil; sin ella le pregunta el área al paciente.
      const vertical = verticalForSpecialty(especialidades.destino, catalogo)
      if (vertical) params.set('vertical', vertical)
    } else {
      params.set('vertical', d.verticalDestino)
      if (d.especialidadDestino) params.set('especialidad', d.especialidadDestino)
    }
    navigate(`/paciente/reservar?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <CircleNotch className="w-6 h-6 animate-spin text-brand" />
      </div>
    )
  }

  const vigente = d && derivacionVigente(d)
  const respondida = d?.consentimientoHc === true || d?.consentimientoHc === false
  const vence = d?.venceAt
    ? new Date(d.venceAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-lg mx-auto px-6 pt-6 sm:pt-8 pb-32">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h1 className="text-[26px] sm:text-[28px] font-light text-text-primary tracking-tight leading-none">Tu derivación</h1>
        </div>

        {!d ? (
          <p className="text-[15px] text-text-secondary text-center py-16">No encontramos esta derivación.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-text-secondary">
                {d.patientId !== profile?.id && d.paciente?.fullName ? `Para ${d.paciente.fullName}` : 'Para vos'}
              </p>
              <DerivacionEstado derivacion={d} />
            </div>

            <ProCard etiqueta="Te derivó" profile={d.derivado} specialty={especialidades.derivado} porSlug={porSlug} />

            {d.destino ? (
              <ProCard etiqueta="Derivado a" profile={d.destino} specialty={especialidades.destino} porSlug={porSlug} />
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-bg-secondary border border-border-default p-4">
                <div className="w-11 h-11 rounded-full bg-brand-tertiary/10 flex items-center justify-center shrink-0">
                  <ShareFat className="w-5 h-5 text-brand-tertiary" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary block">Derivado a</span>
                  <p className="text-[15px] font-semibold text-text-primary">{destinoLabel(d, porSlug)}</p>
                  <p className="text-[12px] text-text-secondary">Elegís con quién reservar</p>
                </div>
              </div>
            )}

            <div>
              <span className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary block mb-1.5">Motivo</span>
              <blockquote className="border-l-2 border-brand/40 pl-4 text-[15px] text-text-primary leading-relaxed whitespace-pre-line">
                {d.motivo}
              </blockquote>
              {vigente && vence && <p className="text-[12px] text-text-tertiary mt-2">Podés reservar hasta el {vence}.</p>}
            </div>

            {/* Consentimiento: se pregunta mientras la derivación siga viva (pendiente
                o ya reservada: el paciente puede cambiar de idea). */}
            {(vigente || d.estado === 'reservada') && (
              <div className="rounded-2xl bg-white border border-border-default p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                  <p className="text-[14px] text-text-primary leading-relaxed">
                    ¿Querés compartir tu historia clínica con quien te va a atender? Si decís que no,
                    sólo va a ver la nota de derivación.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    [true, 'Sí, compartir'],
                    [false, 'No compartir'],
                  ].map(([valor, label]) => {
                    const activo = d.consentimientoHc === valor
                    return (
                      <button
                        key={label}
                        disabled={respondiendo}
                        onClick={() => !activo && responder(valor)}
                        className={`py-3 rounded-full text-[14px] font-semibold border transition-colors disabled:opacity-50 ${
                          activo
                            ? 'bg-brand text-white border-brand'
                            : 'bg-bg-secondary text-text-primary border-border-default hover:border-brand'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[12px] text-text-tertiary">
                  {respondida
                    ? 'Podés cambiar tu respuesta cuando quieras.'
                    : 'Elegí una opción para poder reservar.'}
                </p>
              </div>
            )}

            {vigente && (
              <div className="space-y-2">
                <button
                  onClick={reservar}
                  disabled={!respondida}
                  className="btn-primary w-full py-4 disabled:opacity-50"
                >
                  Reservar turno
                </button>
                {!respondida && (
                  <p className="text-[12px] text-text-tertiary text-center">
                    Primero decinos si compartís tu historia clínica.
                  </p>
                )}
              </div>
            )}

            {d.estado === 'reservada' && (
              <div className="rounded-2xl bg-brand-muted/50 border border-brand/20 p-5 space-y-3 text-center">
                <p className="text-[14px] font-semibold text-text-primary">Ya reservaste</p>
                {d.consultaReservadaId && (
                  <button
                    onClick={() => navigate(`/paciente/turno-confirmado/${d.consultaReservadaId}`)}
                    className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
                  >
                    <CalendarCheck className="w-4 h-4" />
                    Ver mi turno
                  </button>
                )}
              </div>
            )}

            {!vigente && d.estado !== 'reservada' && (
              <p className="text-[14px] text-text-secondary text-center">
                {d.estado === 'cancelada'
                  ? 'Esta derivación fue cancelada.'
                  : 'Esta derivación venció. Pedile a tu médico que la renueve.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
