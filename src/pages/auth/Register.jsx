import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Envelope, Lock } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { getStoredUtms, clearUtms } from '../../lib/utms'
import { GoogleAuthButton } from '../../components/auth/GoogleAuthButton'

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    if (form.password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return }
    setLoading(true)
    try {
      const utms = getStoredUtms()
      await authService.register(form.email, form.password, 'patient', form.fullName, utms)
      clearUtms()
      const { profile } = await authService.login(form.email, form.password)
      onLogin(profile)
      navigate('/paciente/onboarding')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Creá tu cuenta</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Crear cuenta</h1>
        <p className="text-text-secondary text-sm">Sumate a Healthier hoy</p>
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
              placeholder="Juan Pérez"
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
          En el siguiente paso te vamos a pedir tu consentimiento para el tratamiento de tus datos.
        </p>
      </form>

      <p className="text-center text-sm text-text-secondary mt-6">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">
          Iniciá sesión
        </Link>
      </p>
      <p className="text-center text-sm text-text-secondary mt-2">
        ¿Sos profesional de la salud?{' '}
        <Link to="/registro-profesional" className="text-brand font-medium hover:underline">
          Registrate aquí
        </Link>
      </p>
    </div>
  )
}
