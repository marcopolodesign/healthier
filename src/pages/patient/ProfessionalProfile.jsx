import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { UserCircleIcon, BoltIcon, StarIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { professionalService } from '../../services/professionalService'
import { reviewsService } from '../../services/reviewsService'
import StarRating from '../../components/StarRating'
import { toast } from '../../components/Toast'
import { SPECIALTY_LABELS } from '../../lib/verticals'

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

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <Link to="/paciente/buscar" className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeftIcon className="h-4 w-4" /> Volver a la búsqueda
      </Link>

      {/* Profile header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          {avatar ? (
            <img src={avatar} alt={name} className="h-24 w-24 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-24 w-24 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
              <UserCircleIcon className="h-14 w-14 text-brand" />
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
                <BoltIcon className="h-4 w-4" />
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

        <div className="mt-6">
          <Link
            to={`/paciente/agendar/${id}`}
            className="btn-accent w-full text-center block py-3 rounded-lg text-base"
          >
            Agendar consulta
          </Link>
        </div>
      </div>

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
