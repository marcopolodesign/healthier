import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Envelope, Lock } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton'
import { track, setAnalyticsUser } from '../../utils/analytics'

export default function Login({ onLogin }) {
  // Al intentar registrarse con un mail que ya existe, /registro manda acá con
  // el mail puesto: el usuario sólo tiene que poner la contraseña.
  const [params] = useSearchParams()
  const [form, setForm] = useState({ email: params.get('email') ?? '', password: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    track('login_view', { page_path: '/login' })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    track('login_attempt', { method: 'email' })
    setLoading(true)
    try {
      const { profile } = await authService.login(form.email, form.password)
      await setAnalyticsUser(profile)
      track('login_success', { method: 'email' })
      onLogin(profile)

      const redirects = {
        patient: '/paciente/dashboard',
        professional: '/profesional/dashboard',
        admin: '/admin/profesionales',
        super_admin: '/super-admin/dashboard',
      }
      navigate(redirects[profile.role] || '/')
    } catch (err) {
      const error_type = err.message.includes('Credenciales inválidas') ? 'invalid_credentials' : 'network_error'
      track('login_error', { method: 'email', error_type })
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Bienvenido de nuevo</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Iniciar sesión</h1>
        <p className="text-text-secondary text-sm">Bienvenido/a de vuelta a Healthier</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
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
              placeholder="••••••••"
              className="form-input pl-9"
            />
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
          {loading ? 'Ingresando...' : 'Iniciar sesión'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-border-default" />
        <span className="text-xs text-text-tertiary uppercase tracking-wide">o</span>
        <div className="h-px flex-1 bg-border-default" />
      </div>

      <GoogleAuthButton analyticsEvent="login_attempt" analyticsParams={{ method: 'google' }} />

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿No tenés cuenta?{' '}
        <Link
          to="/registro"
          onClick={() => track('login_to_signup', { source: 'login_page' })}
          className="text-brand font-medium hover:underline"
        >
          Registrate
        </Link>
      </p>
    </div>
  )
}
