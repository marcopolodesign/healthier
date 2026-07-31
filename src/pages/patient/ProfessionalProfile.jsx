import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { UserCircle, Lightning, ArrowLeft } from '@phosphor-icons/react';
import { professionalService } from '../../services/professionalService'
import { reviewsService } from '../../services/reviewsService'
import StarRating from '../../components/StarRating'
import { toast } from '../../components/Toast'
import { SPECIALTY_LABELS, verticalForSpecialty } from '../../lib/verticals'


export default function ProfessionalProfile() {
  const { id } = useParams()
  const [professional, setProfessional] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      professionalService.getPublicProfile(id),
      reviewsService.getByProfessional(id),
    ]).then(([prof, revs]) => {
      setProfessional(prof)
      setReviews(revs)
    }).catch(() => toast.error('Error al cargar el perfil'))
    .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-48 bg-bg-surface rounded-xl" />
      <div className="h-32 bg-bg-surface rounded-xl" />
    </div>
  )

  if (!professional) return (
    <div className="text-center py-20 text-text-secondary">Profesional no encontrado</div>
  )

  const name = professional.profiles?.fullName || professional.profiles?.full_name
  const avatar = professional.profiles?.avatarUrl || professional.profiles?.avatar_url

  // Sin vertical el wizard arranca en el selector de especialidad en vez de ir
  // derecho a la fecha. Pasa sólo si la especialidad no mapea a ninguna vertical
  // (esas hoy no se pueden reservar igual), así que se manda sin el parámetro.
  const vertical = verticalForSpecialty(professional.specialty)
  const verticalParam = vertical ? `&vertical=${vertical}` : ''

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <Link to="/paciente/buscar" className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver a la búsqueda
      </Link>

      {/* Profile header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          {avatar ? (
            <img src={avatar} alt={name} className="h-24 w-24 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-24 w-24 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
              <UserCircle className="h-14 w-14 text-brand" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-text-primary">{name}</h1>
            <p className="text-brand font-medium">{SPECIALTY_LABELS[professional.specialty] || professional.specialty}</p>
            {professional.subSpecialty && (
              <p className="text-sm text-text-secondary">{professional.subSpecialty}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <StarRating value={Math.round(professional.averageRating || 0)} readOnly size="sm" />
              <span className="text-sm text-text-secondary">
                {professional.averageRating?.toFixed(1) || 'Sin calificaciones'}
                {professional.totalReviews > 0 && ` (${professional.totalReviews} reseñas)`}
              </span>
            </div>
            {professional.isOnDemand && (
              <span className="inline-flex items-center gap-1 text-sm bg-accent-muted text-accent px-3 py-1 rounded-full mt-2">
                <Lightning className="h-4 w-4" />
                Disponible para consulta ahora
              </span>
            )}
          </div>
        </div>

        {professional.bio && (
          <div className="mt-4 pt-4 border-t border-border-default">
            <p className="text-text-secondary">{professional.bio}</p>
          </div>
        )}

        {professional.sessionPrice && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-text-secondary text-sm">Precio por sesión</span>
            <span className="text-xl font-bold text-text-primary">${professional.sessionPrice.toLocaleString()}</span>
          </div>
        )}

        {/* Reservar es una sola pantalla: el wizard de `/paciente/reservar`, que
            es el único que valida contra `professional_schedules`. Desde acá se
            entra con el profesional ya elegido (`proId` es el id de usuario, que
            es lo que matchea el wizard) y se saltea el paso de elegirlo. */}
        <div className="mt-6">
          {professional.mpConnected === false ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="font-semibold text-text-primary text-sm">No disponible para reservas online</p>
              <p className="text-sm text-text-secondary mt-1">
                {name || 'Este profesional'} todavía no conectó Mercado Pago y no puede recibir turnos por el momento.
              </p>
            </div>
          ) : (
            <Link
              to={`/paciente/reservar?proId=${professional.userId}${verticalParam}`}
              className="btn-accent w-full text-center block py-3 rounded-lg text-base"
            >
              Agendar consulta
            </Link>
          )}
        </div>
      </div>

      {/* Calendly widget (only shown if the professional has a calendly_url) */}

      {/* Reviews */}
      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Reseñas ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="text-text-secondary text-sm text-center py-6">Aún no hay reseñas</p>
        ) : (
          <div className="space-y-4">
            {reviews.map(r => (
              <div key={r.id} className="pb-4 border-b border-border-default last:border-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-text-primary">
                    {r.profiles?.fullName || r.profiles?.full_name || 'Paciente'}
                  </span>
                  <StarRating value={r.rating} readOnly size="sm" />
                </div>
                {r.comment && <p className="text-sm text-text-secondary">{r.comment}</p>}
                <p className="text-xs text-text-tertiary mt-1">
                  {new Date(r.createdAt).toLocaleDateString('es-AR')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
