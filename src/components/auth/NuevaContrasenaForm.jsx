import { useState } from 'react'
import { Lock, Eye, EyeSlash, WarningCircle } from '@phosphor-icons/react'

export const MIN_CONTRASENA = 6

/**
 * Contraseña nueva + repetirla, con su validación y el error real abajo.
 * Lo usan "Restablecer contraseña" y "Recuperar cuenta" (migración 188).
 * `onSubmit(password)` puede tirar: el mensaje se muestra tal cual.
 */
export default function NuevaContrasenaForm({ onSubmit, boton, botonCargando }) {
  const [form, setForm] = useState({ password: '', repetir: '' })
  const [ver, setVer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < MIN_CONTRASENA) return setError(`La contraseña tiene que tener al menos ${MIN_CONTRASENA} caracteres.`)
    if (form.password !== form.repetir) return setError('Las dos contraseñas no coinciden.')

    setLoading(true)
    try {
      await onSubmit(form.password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const tipo = ver ? 'text' : 'password'
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="form-label" htmlFor="nueva-contrasena">Contraseña nueva</label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <input
            id="nueva-contrasena"
            type={tipo}
            required
            minLength={MIN_CONTRASENA}
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
            minLength={MIN_CONTRASENA}
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
        {loading ? botonCargando : boton}
      </button>
    </form>
  )
}
