import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, Eye, EyeSlash, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { ROLE_REDIRECTS } from '../../lib/roleRedirects'

// Paso 2 de "¿Olvidaste tu contraseña?": acá llega el link del mail.
//
// El link trae `?token_hash=...&type=recovery` (no un `code` de PKCE), así que
// se puede abrir en cualquier dispositivo — también cuando el mail lo pidió la
// app. `verifyOtp` canjea el token por una sesión y con esa sesión se llama a
// `updateUser({ password })`.
//
// Ojo con dos cosas:
// - El token es de un solo uso y StrictMode monta los efectos dos veces en dev:
//   sin el ref, el segundo `verifyOtp` fallaba con "ya se usó".
// - `verifyOtp` de recuperación emite `PASSWORD_RECOVERY`, no `SIGNED_IN`, así
//   que App.jsx no se entera de la sesión. Al terminar se le pasa el perfil con
//   `onLogin` para que el botón "Ir a mi inicio" no rebote al login.

// Si la persona recarga la página después de canjear el token, el token ya no
// sirve pero la sesión sí. Esta marca (por pestaña) deja volver al formulario.
const MARCA = 'recuperacionVerificada'
const MIN = 6

export default function RestablecerContrasena({ onLogin }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [estado, setEstado] = useState('verificando') // verificando | form | invalido | listo
  const [motivo, setMotivo] = useState('')
  const [form, setForm] = useState({ password: '', repetir: '' })
  const [ver, setVer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [destino, setDestino] = useState('/login')
  const yaVerifico = useRef(false)

  useEffect(() => {
    if (yaVerifico.current) return
    yaVerifico.current = true

    const tokenHash = params.get('token_hash')
    const type = params.get('type')

    const verificar = async () => {
      if (tokenHash && type === 'recovery') {
        try {
          const session = await authService.verifyRecoveryToken(tokenHash)
          sessionStorage.setItem(MARCA, session?.user?.id || '1')
          // Sacar el token de la URL: ya no sirve y no tiene que quedar en el historial.
          navigate('/restablecer-contrasena', { replace: true })
          setEstado('form')
        } catch (err) {
          setMotivo(err.vencido ? '' : err.message)
          setEstado('invalido')
        }
        return
      }
      // Sin token: sólo vale si esta pestaña ya canjeó uno y la sesión sigue viva.
      const marca = sessionStorage.getItem(MARCA)
      const user = marca ? await authService.getCurrentUser().catch(() => null) : null
      if (user && (marca === '1' || marca === user.id)) setEstado('form')
      else setEstado('invalido')
    }
    verificar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < MIN) return setError(`La contraseña tiene que tener al menos ${MIN} caracteres.`)
    if (form.password !== form.repetir) return setError('Las dos contraseñas no coinciden.')

    setLoading(true)
    try {
      const user = await authService.updatePassword(form.password)
      sessionStorage.removeItem(MARCA)
      try {
        const profile = await authService.getCurrentUserProfile(user.id)
        if (profile) {
          onLogin?.(profile)
          setDestino(ROLE_REDIRECTS[profile.role] || '/')
        }
      } catch {
        // La contraseña ya cambió; sin perfil el botón manda al login y listo.
      }
      setEstado('listo')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (estado === 'verificando') {
    return (
      <div className="card flex flex-col items-center gap-3 py-12">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        <span className="text-text-secondary text-sm">Verificando el enlace...</span>
      </div>
    )
  }

  if (estado === 'invalido') {
    return (
      <div className="card text-center">
        <WarningCircle weight="fill" className="h-12 w-12 text-brand-secondary mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">El enlace ya no sirve</h1>
        <p className="text-text-secondary text-sm mb-6">
          {motivo || 'Venció o ya se usó. Los enlaces para cambiar la contraseña duran una hora y sirven una sola vez.'}
        </p>
        <Link to="/recuperar-contrasena" className="btn-primary w-full py-2.5 inline-block">Pedir otro mail</Link>
        <p className="text-center text-sm text-text-secondary mt-4">
          <Link to="/login" className="text-brand font-medium hover:underline">Volver a iniciar sesión</Link>
        </p>
      </div>
    )
  }

  if (estado === 'listo') {
    return (
      <div className="card text-center">
        <CheckCircle weight="fill" className="h-12 w-12 text-brand mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Listo, cambiaste tu contraseña</h1>
        <p className="text-text-secondary text-sm mb-6">La próxima vez que entres, usá la contraseña nueva.</p>
        <button type="button" onClick={() => navigate(destino, { replace: true })} className="btn-primary w-full py-2.5">
          {destino === '/login' ? 'Iniciar sesión' : 'Ir a mi inicio'}
        </button>
      </div>
    )
  }

  const tipo = ver ? 'text' : 'password'
  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Contraseña</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Elegí una contraseña nueva</h1>
        <p className="text-text-secondary text-sm">Tiene que tener al menos {MIN} caracteres.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="nueva-contrasena">Contraseña nueva</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="nueva-contrasena"
              type={tipo}
              required
              minLength={MIN}
              autoComplete="new-password"
              autoFocus
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="••••••••"
              className="form-input pl-9 pr-11"
            />
            <button
              type="button"
              onClick={() => setVer(v => !v)}
              aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-text-tertiary hover:text-text-primary"
            >
              {ver ? <EyeSlash className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="repetir-contrasena">Repetí la contraseña</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="repetir-contrasena"
              type={tipo}
              required
              minLength={MIN}
              autoComplete="new-password"
              value={form.repetir}
              onChange={e => setForm(p => ({ ...p, repetir: e.target.value }))}
              placeholder="••••••••"
              className="form-input pl-9"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">
            <WarningCircle weight="fill" className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
          {loading ? 'Guardando...' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  )
}
