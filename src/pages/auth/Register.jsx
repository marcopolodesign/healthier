import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Envelope, Lock, Briefcase, Heart, Check } from '@phosphor-icons/react';
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'

const CONSENT_ITEMS = [
  {
    key: 'hipaa',
    title: 'Datos de salud',
    desc: 'Acepto que Healthier almacene mis datos médicos con cifrado AES-256, accesibles solo por profesionales autorizados.',
  },
  {
    key: 'ley25326',
    title: 'Ley 25.326 — Argentina',
    desc: 'Acepto el tratamiento de datos según la Ley de Protección de Datos Personales. Mis datos se almacenan en servidores de Amazon Web Services en São Paulo, Brasil. Puedo ejercer derechos de acceso, rectificación y supresión.',
  },
  {
    key: 'equipo_tratante',
    title: 'Acceso del equipo médico',
    desc: 'Acepto que los profesionales que me atiendan en Healthier puedan acceder a mi información clínica compartida para una atención integral y coordinada.',
  },
]

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: '' })
  const [consents, setConsents] = useState({ hipaa: false, ley25326: false, equipo_tratante: false })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const allConsented = Object.values(consents).every(Boolean)

  const submit = async (e) => {
    e.preventDefault()
    if (!form.role) { toast.error('Seleccioná un tipo de cuenta'); return }
    if (!allConsented) { toast.error('Necesitamos tu consentimiento para continuar'); return }
    if (form.password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return }
    setLoading(true)
    try {
      await authService.register(form.email, form.password, form.role, form.fullName)
      const { profile } = await authService.login(form.email, form.password)
      onLogin(profile)

      if (profile.role === 'patient') navigate('/paciente/onboarding')
      else if (profile.role === 'professional') navigate('/profesional/onboarding')
      else navigate('/')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const roles = [
    {
      id: 'patient',
      label: 'Paciente',
      desc: 'Quiero consultar con profesionales',
      icon: Heart,
    },
    {
      id: 'professional',
      label: 'Profesional de la Salud',
      desc: 'Quiero ofrecer mis servicios',
      icon: Briefcase,
    },
  ]

  return (
    <div className="card">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary mb-1">Crear cuenta</h1>
        <p className="text-text-secondary text-sm">Sumate a Healthier hoy</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {/* Role selector */}
        <div>
          <label className="form-label">Tipo de cuenta</label>
          <div className="grid grid-cols-2 gap-3">
            {roles.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setForm(p => ({ ...p, role: r.id }))}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  form.role === r.id
                    ? 'border-brand bg-brand-muted'
                    : 'border-border-default hover:border-brand/50'
                }`}
              >
                <r.icon className={`h-5 w-5 mb-1 ${form.role === r.id ? 'text-brand' : 'text-text-tertiary'}`} />
                <p className={`text-sm font-semibold ${form.role === r.id ? 'text-brand' : 'text-text-primary'}`}>{r.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{r.desc}</p>
              </button>
            ))}
          </div>
        </div>

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

        {/* Consent */}
        <div className="border border-border-default rounded-xl p-4 space-y-3 bg-bg-primary">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Consentimiento requerido</p>
          {CONSENT_ITEMS.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => setConsents(p => ({ ...p, [item.key]: !p[item.key] }))}
              className="flex items-start gap-3 w-full text-left"
            >
              <span className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                consents[item.key] ? 'bg-brand border-brand' : 'border-border-default'
              }`}>
                {consents[item.key] && <Check className="h-3 w-3 text-white" weight="bold" />}
              </span>
              <span>
                <span className="text-sm font-semibold text-text-primary block">{item.title}</span>
                <span className="text-xs text-text-secondary leading-relaxed">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <button type="submit" disabled={loading || !allConsented} className="btn-primary w-full py-2.5 mt-2 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
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
