import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Lightning, ArrowLeft, VideoCamera, MapPin, SealCheck, Star, CheckCircle, CircleNotch, CaretRight } from '@phosphor-icons/react'
import { professionalService, disponibleAhora } from '../../services/professionalService'
import { reviewsService } from '../../services/reviewsService'
import { availabilityService } from '../../services/availabilityService'
import { consultationsService } from '../../services/consultationsService'
import { paymentsService } from '../../services/paymentsService'
import { consultorioHabilitado } from '../../services/ministerioService'
import { toast } from '../../components/Toast'
import { verticalForSpecialty } from '../../lib/verticals'
import { nombreDePila, inicialesDe } from '../../lib/format'
import { ofreceModalidad } from '../../lib/modalidad'
import {
  DEFAULT_SLOT_DURATION_MINUTES, proximosDiasConTurnos, horaCorta, etiquetaTurno,
} from '../../lib/agendaTurnos'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { useVerticales } from '../../hooks/useVerticales'

const MODALIDADES = [
  { id: 'virtual',    label: 'Videoconsulta', Icon: VideoCamera },
  { id: 'presencial', label: 'Presencial',    Icon: MapPin },
]

// Los parámetros del wizard que el perfil deja pasar de largo: si se llegó acá
// desde una derivación o eligiendo un familiar, el turno los sigue llevando.
const PARAMS_QUE_SIGUEN = ['para', 'derivacion', 'especialidad']

const peso = (n) => `$${Number(n).toLocaleString('es-AR')}`
const nota = (n) => Number(n).toFixed(1).replace('.', ',')

/**
 * Perfil del profesional, visto por el paciente.
 *
 * Versión del 2026-11-25 (Mateo, sobre las tres propuestas de Felipe): el
 * encabezado de la A (foto o inicial a la izquierda, nombre, especialidad,
 * nota), la franja de tres datos de la B (nota · reseñas · matrícula) y el
 * cuerpo de la C (bio, "Atiende", "Horarios"). Lo nuevo: tocar Videoconsulta o
 * Presencial muestra YA los horarios libres; tocar uno arma el botón
 * "Agendar · hoy 15:30", que sigue al wizard de siempre con todo precargado.
 *
 * La grilla sale de `proximosDiasConTurnos` (misma cuenta que el paso de fecha
 * del wizard). La agenda es una sola para las dos modalidades
 * (`professional_schedules` no distingue), así que lo que cambia al tocar una u
 * otra es el precio y si el profesional la ofrece.
 *
 * Una sola pantalla para todos lados: la búsqueda, el médico de cabecera, el
 * link de referido y la Teleclínica una vez que hay médico asignado
 * (`?desde=teleclinica`, sin agendar porque ya está en una consulta).
 *
 * 🔴 Sin teléfono, WhatsApp ni mail: el contacto pasa por Healthier.
 *
 * `:id` acepta el id de la ficha (`professional_profiles.id`) o el de usuario.
 */
export default function ProfessionalProfile() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const sinAcciones = searchParams.get('desde') === 'teleclinica'
  const navigate = useNavigate()
  const { porSlug, especialidades } = useEspecialidades()
  const { verticalesById } = useVerticales()
  const [professional, setProfessional] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalidad, setModalidad] = useState(null)
  const [agenda, setAgenda] = useState(null) // { schedule, consultations } — null mientras carga
  const [slotMinutes, setSlotMinutes] = useState(DEFAULT_SLOT_DURATION_MINUTES)
  const [elegido, setElegido] = useState(null) // { dia, slot }
  // Al tocar una modalidad se baja hasta los horarios: si quedan debajo del
  // botón fijo, la persona no ve que aparecieron (Felipe, 2026-11-25).
  const horariosRef = useRef(null)
  const bajarAHorarios = useRef(false)

  useEffect(() => {
    let cancelado = false
    professionalService.getPublicProfile(id)
      .then(async (prof) => {
        if (cancelado) return
        setProfessional(prof)
        // Las reseñas cuelgan del id de USUARIO del profesional, no del de la ficha.
        if (prof?.userId) setReviews(await reviewsService.getByProfessional(prof.userId).catch(() => []))
      })
      .catch(() => toast.error('Error al cargar el perfil'))
      .finally(() => { if (!cancelado) setLoading(false) })
    return () => { cancelado = true }
  }, [id])

  const ofertas = useMemo(() => (
    professional
      ? MODALIDADES.map(m => ({ ...m, ...ofreceModalidad(professional, m.id) })).filter(m => m.ok)
      : []
  ), [professional])

  // Se abre directo con horarios cuando no hay nada que elegir: una sola
  // modalidad, o la que ya se eligió en el wizard (`?modalidad=`).
  const modalidadPedida = searchParams.get('modalidad')
  useEffect(() => {
    if (sinAcciones || modalidad) return
    const pedida = ofertas.find(o => o.id === modalidadPedida)
    if (pedida) setModalidad(pedida.id)
    else if (ofertas.length === 1) setModalidad(ofertas[0].id)
  }, [ofertas, modalidad, sinAcciones, modalidadPedida])

  // La agenda se pide recién cuando hace falta (al tocar una modalidad), y una sola vez.
  useEffect(() => {
    if (!modalidad || agenda || !professional?.userId) return
    let cancelado = false
    Promise.all([
      availabilityService.getSchedule(professional.userId),
      consultationsService.getByProfessional(professional.userId).catch(() => []),
      paymentsService.getPlatformSettings().catch(() => null),
    ])
      .then(([schedule, consultations, settings]) => {
        if (cancelado) return
        if (settings?.slotDurationMinutes) setSlotMinutes(settings.slotDurationMinutes)
        setAgenda({ schedule, consultations })
      })
      .catch(() => { if (!cancelado) setAgenda({ schedule: [], consultations: [] }) })
    return () => { cancelado = true }
  }, [modalidad, agenda, professional?.userId])

  const dias = useMemo(() => (
    agenda ? proximosDiasConTurnos({ ...agenda, slotMinutes, cuantos: 3 }) : []
  ), [agenda, slotMinutes])

  useEffect(() => {
    if (!bajarAHorarios.current || !agenda) return
    bajarAHorarios.current = false
    horariosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [agenda, modalidad])

  const volver = () => (window.history.length > 1 ? navigate(-1) : navigate('/paciente/buscar'))

  if (loading) return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-4 animate-pulse">
      <div className="h-24 bg-bg-surface-hover rounded-[28px]" />
      <div className="h-20 bg-bg-surface-hover rounded-[20px]" />
      <div className="h-40 bg-bg-surface-hover rounded-[20px]" />
    </div>
  )

  if (!professional) return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-text-secondary">
      <p>Profesional no encontrado</p>
      <button onClick={volver} className="btn-secondary px-6 py-2">Volver</button>
    </div>
  )

  const name = professional.profiles?.fullName || 'Profesional'
  const avatar = professional.profiles?.avatarUrl
  const especialidad = porSlug[professional.specialty] || professional.specialty
  const vertical = verticalForSpecialty(professional.specialty, especialidades)
  const matricula = professional.licenseNumber
    ? `${professional.licenseType ? `${professional.licenseType.toUpperCase()} ` : ''}${professional.licenseNumber}`
    : professional.sisaMatricula
  const conInmediata = disponibleAhora(professional) && vertical && verticalesById[vertical]?.onDemandPrice
  const puedeReservar = professional.mpConnected !== false && ofertas.length > 0
  const conNota = professional.totalReviews > 0 && professional.averageRating
  const cantResenas = professional.totalReviews || 0

  const elegirModalidad = (m) => {
    bajarAHorarios.current = true
    if (m === modalidad) {
      if (agenda) horariosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setModalidad(m)
    setElegido(null)
  }

  const urlDelWizard = (extra) => {
    const q = new URLSearchParams({ proId: professional.userId, ...(vertical ? { vertical } : {}), ...extra })
    PARAMS_QUE_SIGUEN.forEach(k => { if (searchParams.get(k)) q.set(k, searchParams.get(k)) })
    return `/paciente/reservar?${q.toString()}`
  }

  const agendar = () => {
    if (!modalidad || !elegido) return
    navigate(urlDelWizard({ modality: modalidad, fecha: elegido.dia.value, hora: elegido.slot.startTime.slice(0, 5) }))
  }

  const ctaLabel = !modalidad ? 'Elegí cómo atenderte'
    : !elegido ? 'Elegí un horario'
      : `Agendar · ${etiquetaTurno(elegido.dia, elegido.slot)}`

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary animate-fade-in" data-testid="perfil-profesional">
      <div className="max-w-xl mx-auto px-5 sm:px-6 pt-6 sm:pt-8 pb-72">
        <button onClick={volver} aria-label="Volver" className="w-10 h-10 bg-bg-surface-hover rounded-full flex items-center justify-center hover:bg-border-subtle">
          <ArrowLeft className="h-5 w-5 text-text-primary" />
        </button>

        {/* Encabezado (A): foto o inicial a la izquierda, nombre, especialidad, nota */}
        <header className="flex items-center gap-4 mt-6">
          {avatar ? (
            <img src={avatar} alt={name} className="w-[72px] h-[72px] rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-[72px] h-[72px] rounded-full bg-terracota-muted text-terracota flex items-center justify-center font-serif font-normal text-[32px] shrink-0">
              {inicialesDe(name)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-[30px] sm:text-[34px] font-light text-text-primary leading-[1.08] tracking-[-0.02em]" data-testid="perfil-nombre">{name}</h1>
            <p className="text-terracota text-[16px] mt-1">
              {especialidad}{professional.subSpecialty ? ` · ${professional.subSpecialty}` : ''}
            </p>
            {/* La nota y las reseñas van en la franja de abajo (B), no dos veces.
                Sin reseñas no hay franja: la matrícula queda acá, en gris (como C). */}
            {!conNota && (
              <p className="text-[15px] text-text-secondary mt-0.5 tabular-nums" data-testid={matricula ? 'perfil-matricula' : undefined}>
                {matricula || 'Sin reseñas todavía'}
              </p>
            )}
          </div>
        </header>

        {(consultorioHabilitado(professional) || (disponibleAhora(professional) && !sinAcciones)) && (
          <div className="flex flex-wrap gap-2 mt-4">
            {consultorioHabilitado(professional) && (
              <span className="inline-flex items-center gap-1 text-xs bg-brand-muted text-brand-hover px-3 py-1 rounded-full" data-testid="perfil-consultorio-habilitado">
                <SealCheck className="h-3.5 w-3.5" weight="fill" /> Consultorio habilitado
              </span>
            )}
            {disponibleAhora(professional) && !sinAcciones && (
              <span className="inline-flex items-center gap-1 text-xs bg-accent-muted text-accent-hover px-3 py-1 rounded-full">
                <Lightning className="h-3.5 w-3.5" weight="fill" /> Disponible ahora
              </span>
            )}
          </div>
        )}

        {/* Franja de tres datos (B): nota · reseñas · matrícula */}
        {conNota && (
          <div className="flex mt-6 py-4 bg-bg-secondary rounded-[20px]" data-testid="perfil-datos">
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="font-serif text-[24px] leading-none text-text-primary">{nota(professional.averageRating)}</span>
              <span className="flex gap-px text-warning" aria-label={`${nota(professional.averageRating)} de 5`}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className="h-3 w-3" weight={i <= Math.round(professional.averageRating) ? 'fill' : 'regular'} />
                ))}
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="font-serif text-[24px] leading-none text-text-primary">{cantResenas}</span>
              <span className="text-[13px] text-text-secondary">{cantResenas === 1 ? 'reseña' : 'reseñas'}</span>
            </div>
            {matricula && (
              <div className="flex-[1.2] flex flex-col items-center gap-1">
                <span className="text-[17px] leading-6 font-medium text-text-primary tabular-nums" data-testid="perfil-matricula">{matricula}</span>
                <span className="text-[13px] text-text-secondary">matrícula</span>
              </div>
            )}
          </div>
        )}

        {/* Cuerpo (C): bio, Atiende, Horarios */}
        {professional.bio && (
          <p className="text-[17px] leading-relaxed text-text-primary whitespace-pre-line mt-7">{professional.bio}</p>
        )}

        {ofertas.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[20px] font-normal text-text-primary mb-3">Atiende</h2>
            <div className="space-y-2" role={sinAcciones ? undefined : 'radiogroup'} aria-label="Modalidad">
              {ofertas.map(({ id: mId, label, Icon, precio }) => {
                const on = modalidad === mId
                if (sinAcciones) return (
                  <div key={mId} className="flex items-center gap-3 px-4 py-4 rounded-[20px] bg-bg-secondary">
                    <Icon className="h-5 w-5 text-brand-hover shrink-0" />
                    <span className="flex-1 text-[15px] text-text-secondary">{label}</span>
                    <span className="text-[15px] font-medium text-text-primary tabular-nums">{peso(precio)}</span>
                  </div>
                )
                return (
                  <button
                    key={mId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => elegirModalidad(mId)}
                    data-testid={`perfil-modalidad-${mId}`}
                    className={`w-full flex items-center gap-3 px-4 py-4 rounded-[20px] text-left transition-colors ${on ? 'bg-brand-light' : 'bg-bg-secondary hover:bg-bg-surface-hover'}`}
                  >
                    <Icon className="h-5 w-5 text-brand-hover shrink-0" weight={on ? 'fill' : 'regular'} />
                    <span className={`flex-1 text-[15px] ${on ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>{label}</span>
                    <span className="text-[15px] font-medium text-text-primary tabular-nums">{peso(precio)}</span>
                    {on && <CheckCircle className="h-5 w-5 text-brand-hover shrink-0" weight="fill" />}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {!sinAcciones && puedeReservar && (
          <section ref={horariosRef} className="mt-8 scroll-mt-6" data-testid="perfil-horarios">
            <h2 className="text-[20px] font-normal text-text-primary mb-3">Horarios</h2>
            {!modalidad ? (
              <p className="text-[15px] text-text-secondary">Tocá una modalidad para ver los horarios.</p>
            ) : !agenda ? (
              <div className="flex justify-center py-8"><CircleNotch className="h-6 w-6 text-brand animate-spin" /></div>
            ) : dias.length === 0 ? (
              <p className="text-[15px] text-text-secondary" data-testid="perfil-sin-horarios">
                No tiene horarios libres en las próximas dos semanas.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2" data-testid="perfil-grilla">
                  {dias.map(dia => (
                    <div key={dia.value} className="flex flex-col gap-2">
                      <div className="flex flex-col items-center mb-0.5">
                        <span className="text-[14px] font-medium text-text-primary">{dia.titulo}</span>
                        <span className="text-[13px] text-text-secondary">{dia.sub}</span>
                      </div>
                      {dia.slots.slice(0, 4).map(slot => {
                        const on = elegido?.dia.value === dia.value && elegido?.slot.id === slot.id
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => setElegido({ dia, slot })}
                            aria-pressed={on}
                            data-testid="perfil-slot"
                            className={`h-10 rounded-full text-[14px] font-medium tabular-nums transition-colors ${on ? 'bg-brand-hover text-white' : 'bg-bg-surface-hover text-text-primary hover:bg-border-subtle'}`}
                          >
                            {horaCorta(slot.startTime)}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => navigate(urlDelWizard({ modality: modalidad }))}
                  className="mt-4 text-[15px] font-medium text-brand-hover inline-flex items-center gap-1"
                >
                  Ver más horarios <CaretRight className="h-4 w-4" />
                </button>
              </>
            )}
          </section>
        )}

        {reviews.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[20px] font-normal text-text-primary mb-3">Reseñas</h2>
            <div className="space-y-2">
              {reviews.map(r => (
                <div key={r.id} className="bg-bg-secondary rounded-[20px] px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    {/* Sólo el nombre de pila: la reseña es pública. */}
                    <span className="font-medium text-[15px] text-text-primary">{nombreDePila(r.profiles?.fullName, 'Paciente')}</span>
                    <span className="flex gap-px text-warning">
                      {[1, 2, 3, 4, 5].map(i => <Star key={i} className="h-3 w-3" weight={i <= r.rating ? 'fill' : 'regular'} />)}
                    </span>
                    <span className="ml-auto text-[13px] text-text-tertiary">{new Date(r.createdAt).toLocaleDateString('es-AR')}</span>
                  </div>
                  {r.comment && <p className="text-[15px] text-text-secondary mt-1">{r.comment}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Botón fijo abajo. En la Teleclínica no va: ya está en una consulta. */}
      {!sinAcciones && (
        <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
          {/* Degradé de 32 px: el contenido se desvanece en vez de cortarse en seco. */}
          <div className="h-8 bg-linear-to-b from-transparent to-bg-primary" />
          <div className="bg-bg-primary px-5 sm:px-6 pb-28 sm:pb-32">
          <div className="max-w-xl mx-auto sm:px-6 flex flex-col gap-2 pointer-events-auto">
            {puedeReservar ? (
              <button
                onClick={agendar}
                disabled={!elegido}
                className="w-full h-14 rounded-full text-[16px] font-medium text-white bg-brand-hover disabled:bg-border-default disabled:text-text-secondary transition-colors"
                data-testid="perfil-agendar"
              >
                {ctaLabel}
              </button>
            ) : (
              <p className="text-[15px] text-text-secondary text-center py-2">{nombreDePila(name)} todavía no recibe turnos online.</p>
            )}
            {conInmediata && (
              <button
                onClick={() => navigate(`/paciente/ondemand/${vertical}`)}
                className="w-full h-12 rounded-full text-[15px] font-medium text-brand-hover bg-brand-light flex items-center justify-center gap-2"
              >
                <Lightning className="h-4 w-4" weight="fill" /> Consulta inmediata
              </button>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
