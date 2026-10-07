import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, Eye, EyeSlash, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { bajaService } from '../../services/bajaService'
import { ROLE_REDIRECTS } from '../../lib/roleRedirects'

// A acá llega el link del mail "Recuperá tu cuenta" (migración 188): alguien
// que fue dado de baja se quiso registrar de nuevo con el mismo mail y eligió
// recuperar la cuenta vieja, con su historia clínica. Elige una contraseña
// nueva, `reactivar-cuenta` le devuelve el acceso y entra directo.
const MIN = 6

export default function ReactivarCuenta({ onLogin }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ password: '', repetir: '' })
  const [ver, setVer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [destino, setDestino] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < MIN) return setError(`La contraseña tiene que tener al menos ${MIN} caracteres.`)
    if (form.password !== form.repetir) return setError('Las dos contraseñas no coinciden.')

    setLoading(true)
    try {
      const email = await bajaService.confirmarReactivacion(token, form.password)
      const { profile } = await authService.login(email, form.password)
      onLogin?.(profile)
      setDestino(ROLE_REDIRECTS[profile?.role] || '/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="card text-center">
        <WarningCircle weight="fill" className="h-12 w-12 text-brand-secondary mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Falta el link del mail</h1>
        <p className="text-text-secondary text-sm mb-6">Abrí esta página desde el botón del mail “Recuperá tu cuenta”.</p>
        <Link to="/registro" className="btn-primary w-full py-2.5 inline-block">Volver al registro</Link>
      </div>
    )
  }

  if (destino) {
    return (
      <div className="card text-center">
        <CheckCircle weight="fill" className="h-12 w-12 text-brand mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Recuperaste tu cuenta</h1>
        <p className="text-text-secondary text-sm mb-6">Tu historial y tu historia clínica siguen ahí, como los dejaste.</p>
        <button type="button" onClick={() => navigate(destino, { replace: true })} className="btn-primary w-full py-2.5">
          Ir a mi inicio
        </button>
      </div>
    )
  }

  const tipo = ver ? 'text' : 'password'
  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Recuperar cuenta</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Elegí tu contraseña</h1>
        <p className="text-text-secondary text-sm">Con esto vuelve tu cuenta, con tu historial e historia clínica.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="reactivar-contrasena">Contraseña nueva</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="reactivar-contrasena"
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
          <label className="form-label" htmlFor="reactivar-repetir">Repetí la contraseña</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="reactivar-repetir"
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
          {loading ? 'Recuperando...' : 'Recuperar mi cuenta'}
        </button>
      </form>
    </div>
  )
}
