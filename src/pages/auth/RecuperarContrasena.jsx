import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Envelope, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { authService } from '../../services/authService'

// Paso 1 de "¿Olvidaste tu contraseña?". El mail lleva a /restablecer-contrasena.
//
// Después de pedirlo se muestra SIEMPRE el mismo mensaje, exista o no la
// cuenta: decir "ese correo no está registrado" le permite a cualquiera
// averiguar quién tiene cuenta en Healthier. Supabase ya responde 200 para
// correos inexistentes; lo único que se muestra como error es una falla real
// de la API (rate limit, red).
export default function RecuperarContrasena() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authService.requestPasswordReset(email)
      setEnviado(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (enviado) {
    return (
      <div className="card text-center">
        <CheckCircle weight="fill" className="h-12 w-12 text-brand mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Revisá tu correo</h1>
        <p className="text-text-secondary text-sm mb-2">
          Si hay una cuenta con <strong className="text-text-primary break-all">{email.trim()}</strong>, te mandamos un mail para elegir una contraseña nueva.
        </p>
        <p className="text-text-tertiary text-xs mb-6">
          El enlace vence en una hora. Si no lo ves, fijate en la carpeta de spam.
        </p>
        <Link to="/login" className="btn-primary w-full py-2.5 inline-block">Volver a iniciar sesión</Link>
        <button
          type="button"
          onClick={() => setEnviado(false)}
          className="text-sm text-brand font-medium hover:underline mt-4"
        >
          Usar otro correo
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Contraseña</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">¿Olvidaste tu contraseña?</h1>
        <p className="text-text-secondary text-sm">Escribí tu correo y te mandamos un enlace para elegir una nueva.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="recuperar-email">Email</label>
          <div className="relative">
            <Envelope className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="recuperar-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="form-input pl-9"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">
            <WarningCircle weight="fill" className="h-4 w-4 mt-0.5 shrink-0" />
            <span>No pudimos mandar el mail: {error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
          {loading ? 'Enviando...' : 'Mandarme el enlace'}
        </button>
      </form>

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿Te acordaste?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">Iniciá sesión</Link>
      </p>
    </div>
  )
}
