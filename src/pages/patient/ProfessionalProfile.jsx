import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { UserCircle, Lightning, ArrowLeft, IdentificationCard, VideoCamera, MapPin } from '@phosphor-icons/react'
import { professionalService, disponibleAhora } from '../../services/professionalService'
import { reviewsService } from '../../services/reviewsService'
import StarRating from '../../components/StarRating'
import { toast } from '../../components/Toast'
import { verticalForSpecialty } from '../../lib/verticals'
import { nombreDePila } from '../../lib/format'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { useVerticales } from '../../hooks/useVerticales'

/**
 * Perfil completo del profesional, visto por el paciente (Mateo, 2026-10-07).
 *
 * Una sola pantalla para todos lados: la búsqueda, el médico de cabecera, y la
 * Teleclínica una vez que hay médico asignado (`?desde=teleclinica`, sin los
 * botones de agendar/consulta inmediata porque ya está en una).
 *
 * 🔴 Sin teléfono, WhatsApp ni mail: el contacto pasa por Healthier (mismo
 * criterio que 8052e0d). Por eso el perfil ya ni siquiera se lee con el mail.
 *
 * `:id` acepta el id de la ficha (`professional_profiles.id`, lo que usan la
 * búsqueda y los links viejos) o el id de usuario (lo que tiene la Teleclínica).
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

  useEffect(() => {
    let cancelado = false
    professionalService.getPublicProfile(id)
      .then(async (prof) => {
        if (cancelado) return
        setProfessional(prof)
        // Las reseñas cuelgan del id de USUARIO del profesional, no del de la
        // ficha: con el de la ficha la lista salía siempre vacía.
        if (prof?.userId) setReviews(await reviewsService.getByProfessional(prof.userId).catch(() => []))
      })
      .catch(() => toast.error('Error al cargar el perfil'))
      .finally(() => { if (!cancelado) setLoading(false) })
    return () => { cancelado = true }
  }, [id])

  const volver = () => (window.history.length > 1 ? navigate(-1) : navigate('/paciente/buscar'))

  if (loading) return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-4 animate-pulse">
      <div className="h-72 bg-bg-surface rounded-[28px]" />
      <div className="h-32 bg-bg-surface rounded-[28px]" />
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
  const verticalParam = vertical ? `&vertical=${vertical}` : ''
  const matricula = professional.licenseNumber
    ? `${professional.licenseType ? `${professional.licenseType.toUpperCase()} ` : ''}${professional.licenseNumber}`
    : professional.sisaMatricula
  const precioVideo = professional.priceVideo ?? professional.sessionPrice
  const precioPresencial = professional.pricePresencial
  const conInmediata = disponibleAhora(professional) && vertical && verticalesById[vertical]?.onDemandPrice
  const puedeReservar = professional.mpConnected !== false
  const peso = (n) => `$${Number(n).toLocaleString('es-AR')}`

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary animate-fade-in">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-56">
        <button onClick={volver} className="w-11 h-11 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 mb-4">
          <ArrowLeft className="h-5 w-5 text-gray-900" />
        </button>

        {/* Foto grande + identidad */}
        <div className="card overflow-hidden p-0">
          {/* Sin foto, un bloque bajo: una placa gigante vacía parecía rota. */}
          {avatar ? (
            <div className="aspect-[4/3] sm:aspect-[16/9] bg-brand-muted">
              <img src={avatar} alt={name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-36 bg-brand-muted flex items-center justify-center">
              <UserCircle className="h-20 w-20 text-brand" />
            </div>
          )}
          <div className="p-5 sm:p-6">
            <h1 className="text-[28px] sm:text-[32px] font-light text-text-primary leading-tight" data-testid="perfil-nombre">{name}</h1>
            <p className="text-brand font-medium mt-1">{especialidad}</p>
            {professional.subSpecialty && <p className="text-sm text-text-secondary">{professional.subSpecialty}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <StarRating value={Math.round(professional.averageRating || 0)} readOnly size="sm" />
              <span className="text-sm text-text-secondary">
                {professional.averageRating ? Number(professional.averageRating).toFixed(1) : 'Sin calificaciones'}
                {professional.totalReviews > 0 && ` · ${professional.totalReviews} reseñas`}
              </span>
              {disponibleAhora(professional) && !sinAcciones && (
                <span className="inline-flex items-center gap-1 text-xs bg-accent-muted text-accent px-3 py-1 rounded-full">
                  <Lightning className="h-3.5 w-3.5" /> Disponible ahora
                </span>
              )}
            </div>
          </div>
        </div>

        {professional.bio && (
          <section className="card mt-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Sobre {nombreDePila(name)}</h2>
            <p className="text-text-secondary whitespace-pre-line leading-relaxed">{professional.bio}</p>
          </section>
        )}

        <section className="card mt-4 divide-y divide-border-default">
          {matricula && (
            <div className="flex items-center gap-3 py-3 first:pt-0">
              <IdentificationCard className="h-5 w-5 text-brand shrink-0" />
              <span className="text-text-secondary text-sm flex-1">Matrícula</span>
              <span className="text-text-primary text-sm font-medium" data-testid="perfil-matricula">{matricula}</span>
            </div>
          )}
          {precioVideo != null && (
            <div className="flex items-center gap-3 py-3 first:pt-0">
              <VideoCamera className="h-5 w-5 text-brand shrink-0" />
              <span className="text-text-secondary text-sm flex-1">Consulta por video</span>
              <span className="text-text-primary font-medium">{peso(precioVideo)}</span>
            </div>
          )}
          {precioPresencial != null && (
            <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <MapPin className="h-5 w-5 text-brand shrink-0" />
              <span className="text-text-secondary text-sm flex-1">Consulta presencial</span>
              <span className="text-text-primary font-medium">{peso(precioPresencial)}</span>
            </div>
          )}
        </section>

        <section className="card mt-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest text-text-tertiary mb-4">Reseñas ({reviews.length})</h2>
          {reviews.length === 0 ? (
            <p className="text-text-secondary text-sm text-center py-6">Aún no hay reseñas</p>
          ) : (
            <div className="space-y-4">
              {reviews.map(r => (
                <div key={r.id} className="pb-4 border-b border-border-default last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    {/* Sólo el nombre de pila: la reseña es pública. */}
                    <span className="font-medium text-sm text-text-primary">{nombreDePila(r.profiles?.fullName, 'Paciente')}</span>
                    <StarRating value={r.rating} readOnly size="sm" />
                  </div>
                  {r.comment && <p className="text-sm text-text-secondary">{r.comment}</p>}
                  <p className="text-xs text-text-tertiary mt-1">{new Date(r.createdAt).toLocaleDateString('es-AR')}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* CTAs abajo, fijos. En la Teleclínica no van: ya está en una consulta. */}
      {!sinAcciones && (
        <div className="fixed bottom-28 sm:bottom-32 inset-x-0 px-4 sm:px-6 z-40 pointer-events-none">
          <div className="max-w-3xl mx-auto bg-white/90 backdrop-blur-[20px] border border-white/80 rounded-[28px] shadow-[0_8px_30px_rgba(0,0,0,0.1)] p-3 flex flex-col sm:flex-row gap-2 pointer-events-auto">
            {puedeReservar ? (
              <button
                onClick={() => navigate(`/paciente/reservar?proId=${professional.userId}${verticalParam}`)}
                className="btn-primary flex-1 py-4 rounded-[20px] text-[16px]"
                data-testid="perfil-agendar"
              >
                Agendar turno
              </button>
            ) : (
              <p className="flex-1 text-sm text-text-secondary px-3 py-2">{name} todavía no recibe turnos online.</p>
            )}
            {conInmediata && (
              <button
                onClick={() => navigate(`/paciente/ondemand/${vertical}`)}
                className="btn-accent flex-1 py-4 rounded-[20px] text-[16px] flex items-center justify-center gap-2"
              >
                <Lightning className="h-5 w-5" weight="fill" /> Consulta inmediata
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

