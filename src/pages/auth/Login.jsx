import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Envelope, Lock } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton'
import { track, setAnalyticsUser, LOGIN_ENTRY_INTENT_PARAM } from '../../utils/analytics'

// Lee la señal de intención (no el rol real — ver el comentario en
// analytics.js) del query param que dejó el link de entrada, si vino de uno
// que la manda (ej. la landing de Profesionales).
function getEntryIntent() {
  const value = new URLSearchParams(window.location.search).get(LOGIN_ENTRY_INTENT_PARAM)
  return value === 'profesional' ? 'profesional' : undefined
}

// Google OAuth vuelve acá con `?code=...` (PKCE) o `#access_token=...`
// (implicit) ANTES de que `AuthRedirectHandler` (App.jsx) navegue al
// dashboard según el rol. Sin este guard el componente monta un instante de
// tránsito — el usuario nunca vio el formulario — y dispara un `login_view`
// espurio. Es justo lo que reportó Henry: un `login_view` con Referrer
// `accounts.google.com` y la URL ya en `/paciente/dashboard` (2026-07-27).
function isOAuthCallback() {
  return new URLSearchParams(window.location.search).has('code') || window.location.hash.includes('access_token')
}

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  // Estable durante toda la vida del componente (el query string no cambia
  // sin un remount) — se calcula una sola vez acá y se reusa en todos los
  // eventos de esta pantalla en vez de re-parsear la URL en cada uno.
  const entryIntent = getEntryIntent()
  const entryIntentParams = entryIntent ? { entry_intent: entryIntent } : {}

  useEffect(() => {
    if (isOAuthCallback()) return
    // No hay rol confirmado todavía (el usuario ni siquiera escribió el
    // email) — esta página es compartida entre paciente y profesional. Sólo
    // se manda `entry_intent` cuando el link de entrada lo declaró; nunca se
    // inventa un rol acá. El rol real recién se conoce en login_success.
    track('login_view', { app_path: '/login', ...entryIntentParams })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    track('login_attempt', { method: 'email', ...entryIntentParams })
    setLoading(true)
    try {
      const { profile } = await authService.login(form.email, form.password)

      if (!profile) {
        // Cuenta autenticada sin fila en `profiles` todavía (p. ej. quedó a
        // medias, ver migración 082). No hay rol a dónde mandarla — el
        // AuthRedirectHandler de App.jsx ya está escuchando este mismo login
        // vía onAuthStateChange y va a mandarla a /completar-registro. No es
        // un login exitoso todavía, así que no se trackea login_success acá.
        return
      }

      // El rol real recién se conoce acá — cachearlo ANTES de trackear
      // login_success para que `user_type` viaje en ese push y en todos los
      // siguientes (ver el docstring de `track` en analytics.js).
      await setAnalyticsUser(profile)
      track('login_success', { method: 'email', flow: profile.role === 'professional' ? 'profesional' : 'paciente' })
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
      // `error_message` va en el anexo B de la spec de tracking. Es el mensaje
      // que ya se le muestra al usuario (nunca trae PII), y sirve para separar
      // los `network_error` reales entre sí sin tener que abrir el log.
      track('login_error', { method: 'email', error_type, error_message: err.message, ...entryIntentParams })
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

      <GoogleAuthButton analyticsEvent="login_attempt" analyticsParams={{ method: 'google', ...entryIntentParams }} />

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿No tenés cuenta?{' '}
        <Link
          to="/registro"
          onClick={() => track('login_to_signup', { source: 'login_page', ...entryIntentParams })}
          className="text-brand font-medium hover:underline"
        >
          Registrate
        </Link>
      </p>

      <p className="text-center text-sm text-text-secondary mt-2">
        ¿Sos profesional?{' '}
        <Link
          to="/registro-profesional"
          onClick={() => track('login_to_signup', { source: 'login_page', flow: 'profesional', ...entryIntentParams })}
          className="text-brand font-medium hover:underline"
        >
          Sumate acá
        </Link>
      </p>
    </div>
  )
}
