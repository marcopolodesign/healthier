import { Link } from 'react-router-dom'
import { UserCircle, Lightning } from '@phosphor-icons/react';
import StarRating from './StarRating'
import { SPECIALTY_LABELS } from '../lib/verticals'
import { track } from '../utils/analytics'

export default function ProfessionalCard({ professional, origin = 'listado' }) {
  const { id, userId, profiles, specialty, bio, averageRating, totalReviews, isOnDemand, sessionPrice } = professional
  const name = profiles?.fullName || profiles?.full_name || 'Profesional'
  const avatar = profiles?.avatarUrl || profiles?.avatar_url

  // El paciente eligió a este profesional. `professional_id` es `profiles.id`,
  // el mismo uuid con el que se identifica al médico en Customer.io — es lo que
  // permite matchearlo y mandarle el WhatsApp.
  //
  // El nombre va sólo a Customer.io (tercer argumento): a GTM no le puede
  // llegar el nombre de una persona. La especialidad no va en ningún lado —
  // atada a un paciente identificado es dato de salud.
  const onSelect = () => track('doctor_selected', {
    professional_id:         userId,
    professional_profile_id: id,
    rating:                  averageRating ?? undefined,
    price:                   sessionPrice ?? undefined,
    currency:                'ARS',
    is_on_demand:            !!isOnDemand,
    origin,
  }, {
    professional_name: name,
  })

  return (
    <div className="card-hover flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        {avatar ? (
          <img src={avatar} alt={name} className="h-14 w-14 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
            <UserCircle className="h-8 w-8 text-brand" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text-primary truncate">{name}</h3>
          <p className="text-sm text-brand">{SPECIALTY_LABELS[specialty] || specialty}</p>
          {isOnDemand && (
            <span className="inline-flex items-center gap-1 text-xs bg-accent-muted text-accent px-2 py-0.5 rounded-full mt-1">
              <Lightning className="h-3 w-3" />
              Consulta ahora
            </span>
          )}
        </div>
      </div>

      {/* Bio */}
      {bio && <p className="text-sm text-text-secondary line-clamp-2">{bio}</p>}

      {/* Rating */}
      <div className="flex items-center gap-2">
        <StarRating value={Math.round(averageRating || 0)} readOnly size="sm" />
        <span className="text-sm text-text-secondary">
          {averageRating ? averageRating.toFixed(1) : 'Sin reseñas'}
          {totalReviews > 0 && <span className="text-text-tertiary"> ({totalReviews})</span>}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border-default mt-auto">
        {sessionPrice && (
          <span className="text-sm font-semibold text-text-primary">${sessionPrice.toLocaleString()}</span>
        )}
        <Link
          to={`/paciente/profesional/${id}`}
          onClick={onSelect}
          className="btn-primary text-sm ml-auto"
        >
          Ver perfil
        </Link>
      </div>
    </div>
  )
}
