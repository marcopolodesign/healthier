import { Link } from 'react-router-dom'
import { User, UsersThree, Check, Plus } from '@phosphor-icons/react'

/**
 * "¿Para quién es la consulta?" — calcado del paso de mascota de veterinaria.
 *
 * Grupo familiar (migración 181): elegir un familiar hace que la consulta sea
 * SUYA (`patient_id` = el familiar), con su historia clínica aparte. El cobro
 * sale igual de las tarjetas del titular.
 *
 * @param {{ profile: object, familiares: object[], value: string|null,
 *           onChange: (id: string, nombre: string) => void, compacto?: boolean }} props
 */
export default function SelectorParaQuien({ profile, familiares, value, onChange, compacto = false }) {
  const opciones = [
    { id: profile?.id, nombre: 'Para mí', detalle: profile?.fullName || null, icono: User },
    ...familiares.map(f => ({
      id: f.familiarId,
      nombre: f.familiar?.fullName || f.fullName,
      detalle: f.relationship || 'Grupo familiar',
      icono: UsersThree,
    })),
  ]

  return (
    <div className={compacto ? 'space-y-2' : 'space-y-2.5'}>
      {opciones.map(o => {
        const activo = value === o.id
        const Icono = o.icono
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id, o.id === profile?.id ? null : o.nombre)}
            className={`w-full flex items-center gap-3 rounded-2xl border px-4 ${compacto ? 'py-3' : 'py-4'} text-left transition-all ${
              activo ? 'border-brand bg-brand-muted' : 'border-border-default bg-bg-secondary hover:border-brand/40'
            }`}
          >
            <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${activo ? 'bg-brand text-white' : 'bg-white text-text-secondary border border-border-default'}`}>
              <Icono className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-semibold text-text-primary truncate">{o.nombre}</span>
              {o.detalle && <span className="block text-[12px] text-text-tertiary truncate">{o.detalle}</span>}
            </span>
            {activo && <Check className="w-5 h-5 text-brand flex-shrink-0" />}
          </button>
        )
      })}
      <Link
        to="/paciente/perfil"
        className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-brand py-2"
      >
        <Plus className="w-4 h-4" /> Añadir a alguien de tu grupo familiar
      </Link>
    </div>
  )
}
