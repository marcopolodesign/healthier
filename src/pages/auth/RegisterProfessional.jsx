import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Envelope, Lock, Check } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { getStoredUtms, clearUtms } from '../../lib/utms'
import { PROFESSIONAL_CONSENT_ITEMS } from '../../lib/consentItems'
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton'

export default function RegisterProfessional({ onLogin }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [consents, setConsents] = useState(
    Object.fromEntries(PROFESSIONAL_CONSENT_ITEMS.map(item => [item.key, false]))
  )
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const allConsented = Object.values(consents).every(Boolean)

  const submit = async (e) => {
    e.preventDefault()
    if (!allConsented) { toast.error('Necesitamos tu consentimiento para continuar'); return }
    if (form.password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return }
    setLoading(true)
    try {
      const utms = getStoredUtms()
      await authService.register(form.email, form.password, 'professional', form.fullName, utms)
      clearUtms()
      const { profile } = await authService.login(form.email, form.password)
      onLogin(profile)
      navigate('/profesional/onboarding')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Creá tu cuenta profesional</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Sumate como profesional</h1>
        <p className="text-text-secondary text-sm">Ofrecé tus servicios en Healthier</p>
      </div>

      <GoogleAuthButton className="mb-6" />

      <div className="flex items-center gap-3 mb-6">
        <div className="h-px flex-1 bg-border-default" />
        <span className="text-xs text-text-tertiary uppercase tracking-wide">o registrate con email</span>
        <div className="h-px flex-1 bg-border-default" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label">Nombre completo</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="text"
              required
              value={form.fullName}
              onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
              placeholder="Dra. Juana Pérez"
              className="form-input pl-9"
            />
          </div>
        </div>

        <div>
          <label className="form-label">Email</label>
          <div className="relative">
            <Envelope className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="tu@email.com"
              className="form-input pl-9"
            />
          </div>
        </div>

        <div>
          <label className="form-label">Contraseña</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="password"
              required
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="Mínimo 6 caracteres"
              className="form-input pl-9"
            />
          </div>
        </div>

        {/* Consent */}
        <div className="border border-border-default rounded-xl p-4 space-y-3 bg-bg-primary">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Consentimiento requerido</p>
          {PROFESSIONAL_CONSENT_ITEMS.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => setConsents(p => ({ ...p, [item.key]: !p[item.key] }))}
              className="flex items-start gap-3 w-full text-left"
            >
              <span className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                consents[item.key] ? 'bg-brand border-brand' : 'border-border-default'
              }`}>
                {consents[item.key] && <Check className="h-3 w-3 text-white" weight="bold" />}
              </span>
              <span>
                <span className="text-sm font-semibold text-text-primary block">{item.title}</span>
                <span className="text-xs text-text-secondary leading-relaxed">
                  {item.link ? (
                    <>
                      {item.desc.replace(' Ver Términos y Condiciones.', '')}{' '}
                      <Link
                        to={item.link}
                        target="_blank"
                        className="text-brand hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        Ver Términos y Condiciones.
                      </Link>
                    </>
                  ) : item.desc}
                </span>
              </span>
            </button>
          ))}
        </div>

        <button type="submit" disabled={loading || !allConsented} className="btn-primary w-full py-2.5 mt-2 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">
          Iniciá sesión
        </Link>
      </p>
      <p className="text-center text-sm text-text-secondary mt-2">
        ¿Sos paciente?{' '}
        <Link to="/registro" className="text-brand font-medium hover:underline">
          Registrate aquí
        </Link>
      </p>
    </div>
  )
}
