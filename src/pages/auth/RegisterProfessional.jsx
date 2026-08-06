import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Envelope, Lock, ArrowLeft } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { marcarDestinoPostRegistro } from '../../lib/postSignupRedirect'
import { getStoredUtms, clearUtms } from '../../lib/utms'
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton'
import { track } from '../../utils/analytics'

export default function RegisterProfessional({ onLogin }) {
  const [step, setStep] = useState('choose')
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    track('sign_up_start', { step: 1, step_name: 'cuenta', flow: 'profesional', page_path: '/registro-profesional' })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    track('sign_up_method_selected', { method: 'email', step: 1, flow: 'profesional' })
    if (form.password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      track('sign_up_error', { step: 1, step_name: 'cuenta', error_type: 'password_corta', flow: 'profesional' })
      return
    }
    setLoading(true)
    try {
      // Se deja anotado el destino ANTES de crear la cuenta: el `signUp` de
      // Supabase inicia sesión al instante y `AuthRedirectHandler` puede
      // adelantarse al `navigate` de abajo. Ver `lib/postSignupRedirect.js`.
      marcarDestinoPostRegistro('/profesional/onboarding')
      const utms = getStoredUtms()
      await authService.register(form.email, form.password, 'professional', form.fullName, utms)
      clearUtms()
      track('sign_up_step_complete', { step: 1, step_name: 'cuenta', method: 'email', flow: 'profesional' })
      const { profile } = await authService.login(form.email, form.password)
      onLogin(profile)
      navigate('/profesional/onboarding')
    } catch (err) {
      const error_type = /already registered/i.test(err.message) ? 'email_ya_registrado' : 'server_error'
      track('sign_up_error', { step: 1, step_name: 'cuenta', error_type, flow: 'profesional' })
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (step === 'choose') {
    return (
      <div className="card">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Creá tu cuenta profesional</p>
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Sumate como profesional</h1>
          <p className="text-text-secondary text-sm">Ofrecé tus servicios en Healthier</p>
        </div>

        <div className="space-y-3">
          <GoogleAuthButton analyticsEvent="sign_up_method_selected" analyticsParams={{ method: 'google', step: 1, flow: 'profesional' }} />
          <button
            type="button"
            onClick={() => setStep('email')}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border-2 border-border-default hover:border-brand/50 transition-colors text-sm font-semibold text-text-primary"
          >
            <Envelope className="h-4 w-4" />
            Continuar con email
          </button>
        </div>

        <div className="flex items-center gap-1 mt-8 p-1 rounded-full bg-bg-secondary border border-border-default">
          <Link
            to="/registro"
            className="flex-1 py-2 rounded-full text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors text-center"
          >
            Paciente
          </Link>
          <button type="button" className="flex-1 py-2 rounded-full text-sm font-semibold bg-brand text-white transition-colors">
            Profesional
          </button>
        </div>

        <p className="text-center text-sm text-text-secondary mt-6">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="text-brand font-medium hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setStep('choose')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Creá tu cuenta profesional</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Sumate como profesional</h1>
        <p className="text-text-secondary text-sm">Ofrecé tus servicios en Healthier</p>
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

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
        <p className="text-center text-xs text-text-tertiary">
          Vas a aceptar el tratamiento de datos personales (Ley 25.326) en el paso de "Datos y privacidad" del onboarding.
        </p>
      </form>

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">
          Iniciá sesión
        </Link>
      </p>
    </div>
  )
}
