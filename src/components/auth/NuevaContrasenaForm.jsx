import { useState } from 'react'
import { Lock, Eye, EyeSlash, WarningCircle } from '@phosphor-icons/react'

import { MIN_CONTRASENA, validarContrasena } from '../../lib/contrasena'

/**
 * Contraseña nueva + repetirla, con su validación y el error real abajo.
 * Lo usan "Restablecer contraseña", "Recuperar cuenta" (migración 188) y
 * "Mi contraseña" del super admin (/super-admin/perfil).
 *
 * Props:
 *   · `onSubmit(password, actual)` puede tirar: el mensaje se muestra tal cual.
 *     `actual` sólo viene si `pedirActual`.
 *   · `pedirActual` — agrega "Contraseña actual" arriba (obligatoria). Para el
 *     cambio desde adentro de una sesión, cuando la cuenta ya tiene contraseña.
 *     El ojito de "Contraseña nueva" muestra/oculta sólo los dos campos nuevos:
 *     la actual siempre queda oculta.
 *   · `email` — se pone en un input oculto `autocomplete="username"` para que el
 *     gestor de contraseñas guarde la nueva contra la cuenta correcta.
 *   · `autoFocus` (true por defecto) y `placeholderNueva` — textos/foco del primer campo.
 */
export default function NuevaContrasenaForm({
  onSubmit, boton, botonCargando, autoFocus = true, placeholderNueva = '••••••••', pedirActual = false, email,
}) {
  const [form, setForm] = useState({ actual: '', password: '', repetir: '' })
  const [ver, setVer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (pedirActual && !form.actual) return setError('Ingresá tu contraseña actual.')
    const invalida = validarContrasena(form.password, form.repetir)
    if (invalida) return setError(invalida)

    setLoading(true)
    try {
      await onSubmit(form.password, pedirActual ? form.actual : undefined)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const tipo = ver ? 'text' : 'password'
  return (
    <form onSubmit={submit} className="space-y-4">
      {email && (
        <input type="text" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
      )}

      {pedirActual && (
        <div>
          <label className="form-label" htmlFor="actual-contrasena">Contraseña actual</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              id="actual-contrasena"
              type="password"
              required
              autoComplete="current-password"
              autoFocus={autoFocus}
              value={form.actual}
              onChange={e => setForm(p => ({ ...p, actual: e.target.value }))}
              placeholder="••••••••"
              className="form-input pl-9"
            />
          </div>
        </div>
      )}

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
            autoFocus={autoFocus && !pedirActual}
            value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            placeholder={placeholderNueva}
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
