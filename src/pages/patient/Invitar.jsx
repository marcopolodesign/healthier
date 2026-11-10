import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import InvitaCard from '../../components/common/InvitaCard'

/** `/paciente/invitar` — se llega desde Perfil → "Invitá a alguien". */
export default function Invitar() {
  const navigate = useNavigate()
  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="mx-auto max-w-md px-4 pt-6 sm:pt-8 pb-32">
        <button
          type="button"
          onClick={() => navigate('/paciente/perfil')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Perfil
        </button>
        <h1 className="text-3xl font-light tracking-tight text-text-primary">Invitá</h1>
        <p className="text-text-secondary mt-1 mb-6">Compartí tu código con quien quieras.</p>
        <InvitaCard rol="patient" />
      </div>
    </div>
  )
}
