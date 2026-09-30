import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Key, WarningCircle } from '@phosphor-icons/react'
import { familyService } from '../../services/familyService'
import { authService } from '../../services/authService'

// "Entrar con código familiar" (grupo familiar, migración 181).
//
// Un familiar no tiene contraseña: su titular le genera desde el perfil un
// código de 6 dígitos, de un solo uso, que vence a los 15 minutos. Acá se
// canjea por una sesión (Edge Function `acceso-familiar` + `verifyOtp`).
export default function AccesoFamiliar({ onLogin }) {
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (pin.length !== 6 || loading) return
    setLoading(true)
    setError('')
    try {
      await familyService.entrarConPin(pin)
      // Otra persona pudo haber usado este navegador: el perfil cacheado no es
      // el de quien entra ahora.
      localStorage.removeItem('userProfile')
      const profile = await authService.getCurrentUserProfile()
      if (profile) onLogin?.(profile)
      navigate('/paciente/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'No pudimos validar el código.')
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Grupo familiar</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Entrar con código familiar</h1>
        <p className="text-text-secondary text-sm">
          Pedile el código a quien te sumó a su grupo familiar en Healthier. Lo genera desde su perfil y sirve una sola vez.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="pin-familiar">Código de 6 números</label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="pin-familiar"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="form-input pl-9 font-mono tracking-[0.4em] text-lg"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">
            <WarningCircle weight="fill" className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading || pin.length !== 6} className="btn-primary w-full py-2.5 mt-2 disabled:opacity-50">
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿Tenés cuenta propia?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">Iniciá sesión</Link>
      </p>
    </div>
  )
}
