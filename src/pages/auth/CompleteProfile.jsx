import { useState } from 'react'
import { User, Briefcase, Heart } from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { getStoredUtms, clearUtms } from '../../lib/utms'

export default function CompleteProfile({ authUser, onProfileComplete }) {
  const [fullName, setFullName] = useState(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || '')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(false)

  const roles = [
    { id: 'patient', label: 'Paciente', desc: 'Quiero consultar con profesionales', icon: Heart },
    { id: 'professional', label: 'Profesional de la Salud', desc: 'Quiero ofrecer mis servicios', icon: Briefcase },
  ]

  const submit = async (e) => {
    e.preventDefault()
    if (!role) { toast.error('Seleccioná un tipo de cuenta'); return }
    if (!fullName.trim()) { toast.error('Ingresá tu nombre completo'); return }
    setLoading(true)
    try {
      const utms = getStoredUtms()
      // authService.completeGoogleProfile guarda contra authUser nulo (sesión
      // perdida mientras completaba el perfil: token vencido, logout en otra
      // pestaña, etc.) y tira un error con mensaje claro — antes esto
      // explotaba con "Cannot read properties of null (reading 'id')" acá
      // mismo. El catch de abajo ya lo muestra vía toast.
      const profile = await authService.completeGoogleProfile(authUser, role, fullName.trim(), utms)
      clearUtms()
      onProfileComplete(profile)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Un último paso</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Completá tu perfil</h1>
        <p className="text-text-secondary text-sm">Necesitamos estos datos para terminar de crear tu cuenta de Healthier</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label">Tipo de cuenta</label>
          <div className="grid grid-cols-2 gap-3">
            {roles.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  role === r.id ? 'border-brand bg-brand-muted' : 'border-border-default hover:border-brand/50'
                }`}
              >
                <r.icon className={`h-5 w-5 mb-1 ${role === r.id ? 'text-brand' : 'text-text-tertiary'}`} />
                <p className={`text-sm font-semibold ${role === r.id ? 'text-brand' : 'text-text-primary'}`}>{r.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{r.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="form-label">Nombre completo</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="text"
              required
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Juan Pérez"
              className="form-input pl-9"
            />
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? 'Guardando...' : 'Continuar'}
        </button>
        <p className="text-center text-xs text-text-tertiary">
          En el siguiente paso te vamos a pedir tu consentimiento para el tratamiento de tus datos.
        </p>
      </form>
    </div>
  )
}
