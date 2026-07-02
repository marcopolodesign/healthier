import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Tag, Clock, Lock, Check, ArrowRight,
  MapPin, FileText, Stethoscope, Brain, AppleLogo, Baby, FirstAid,
  MagnifyingGlass, Calendar, ClipboardText,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { captureUtms } from '../../lib/utms'

const SPECIALTIES = [
  { icon: Stethoscope, label: 'clínica general' },
  { icon: Brain,       label: 'psicología' },
  { icon: AppleLogo,   label: 'nutrición' },
  { icon: FileText,    label: 'recetas digitales' },
  { icon: FirstAid,    label: 'consultas urgentes' },
]

const PAINS = [
  'No tenés obra social.',
  'La guardia privada sale cara.',
  'No querés perder horas en traslados.',
  'Necesitás ver el precio antes.',
  'Querés un profesional confiable.',
  'Buscás resolver todo en una sola sesión.',
]

const FEATURES = [
  { icon: Tag,           title: 'Precio visible',           desc: 'Sabés cuánto pagás antes de reservar.' },
  { icon: ShieldCheck,   title: 'Profesionales verificados', desc: 'Título, matrícula y perfil confiable.' },
  { icon: FileText,      title: 'Receta digital',            desc: 'La recibís al instante, sin volver al consultorio.' },
  { icon: MapPin,        title: 'Acceso desde cualquier ciudad', desc: 'Consultá desde donde estés.' },
  { icon: ClipboardText, title: 'Historial centralizado',    desc: 'Toda tu información clínica en un solo lugar.' },
]

const SINS = [
  { title: 'Sin sorpresas',      desc: 'Precio claro antes de reservar.' },
  { title: 'Sin trámites',       desc: 'Sin autorizaciones ni vueltas.' },
  { title: 'Sin traslados',      desc: 'Consultá desde tu celular o notebook.' },
  { title: 'Sin cobertura médica', desc: 'Accedé igual, cuando lo necesitás.' },
]

const TRUST = [
  [Tag,         'Precio transparente',  'Lo ves antes de reservar'],
  [Clock,       'Respuesta rápida',     'Consultas en minutos'],
  [Lock,        'Seguro y confidencial','Tus datos protegidos'],
]

export default function LandingMedicoOnline() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] font-sans">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo className="h-6" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-[var(--color-text-secondary)]">Médicos verificados online</span>
            <Link to="/registro" className="btn-accent rounded-full text-sm px-5 py-2">Reservar consulta</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 pb-16 bg-[var(--color-bg-secondary)]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left */}
            <div>
              <p className="text-xs font-semibold tracking-widest text-[var(--color-brand)] uppercase mb-4 flex items-center gap-2">
                <span className="inline-block w-8 h-px bg-[var(--color-brand)]" />
                Médico online sin obra social
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-[var(--color-text-primary)] mb-6">
                Sin obra social no debería significar sin atención médica
              </h1>
              <p className="text-lg text-[var(--color-text-secondary)] mb-8 leading-relaxed">
                Elegí médico. Mirá el precio. Reservá en minutos.<br/>
                Profesionales verificados disponibles online.
              </p>
              <div className="flex flex-wrap gap-3 mb-10">
                <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold flex items-center gap-2">
                  Reservar consulta <ArrowRight weight="bold" size={16} />
                </Link>
                <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] border border-neutral-200 rounded-full px-5 py-3 bg-white">
                  <MapPin size={15} weight="duotone" className="text-[var(--color-brand)]" />
                  Disponible desde cualquier ciudad
                </span>
              </div>
              {/* Trust bar */}
              <div className="flex flex-wrap gap-5 text-sm text-[var(--color-text-secondary)]">
                {TRUST.map(([Icon, label, sub]) => (
                  <div key={label} className="flex items-center gap-2">
                    <Icon size={18} weight="duotone" className="text-[var(--color-brand)]" />
                    <div>
                      <div className="font-medium text-[var(--color-text-primary)]">{label}</div>
                      <div className="text-xs">{sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — specialty panel */}
            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-6 lg:mt-4">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-widest mb-4">Consultas para:</p>
              <ul className="space-y-3 mb-6">
                {SPECIALTIES.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <Link
                      to="/registro"
                      className="flex items-center gap-3 text-[var(--color-text-primary)] hover:text-[var(--color-brand)] transition-colors group"
                    >
                      <span className="w-8 h-8 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center shrink-0 group-hover:bg-[var(--color-brand)]/20 transition-colors">
                        <Icon size={16} weight="duotone" className="text-[var(--color-brand)]" />
                      </span>
                      <span className="text-sm font-medium">{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold text-[var(--color-brand)]">Sin trámites. Sin sorpresas.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pain + Features side by side */}
      <section className="py-16 bg-[var(--color-bg-primary)]">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-16">
          {/* Pain */}
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-5">Sabemos lo que pasa</p>
            <ul className="space-y-4">
              {PAINS.map((pain, i) => (
                <li key={pain} className="flex items-start gap-4">
                  <span className="text-xs font-semibold text-[var(--color-brand)] w-5 pt-0.5 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[var(--color-text-primary)] font-medium">{pain}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Features */}
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">Atención médica transparente cuando la necesitás</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-white rounded-xl border border-neutral-100 p-4">
                  <Icon size={22} weight="duotone" className="text-[var(--color-brand)] mb-3" />
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{title}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Sin row */}
      <section className="py-12 bg-white border-t border-b border-neutral-100">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          {SINS.map(({ title, desc }) => (
            <div key={title}>
              <p className="font-semibold text-sm text-[var(--color-text-primary)] mb-1">{title}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 bg-[var(--color-brand)]">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center gap-8">
          <div className="shrink-0 w-24 h-24 rounded-full border-4 border-white/40 flex flex-col items-center justify-center text-white">
            <span className="text-xs font-medium uppercase tracking-wider text-white/70 mb-0.5">Atención</span>
            <span className="text-2xl font-bold leading-none">5</span>
            <span className="text-xs font-medium uppercase tracking-wider">min</span>
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Tu próxima consulta puede empezar hoy
            </h2>
            <p className="text-white/80 mb-6 text-sm">Accedé desde cualquier ciudad, sin guardias ni trámites.</p>
            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              <Link to="/registro" className="bg-white text-[var(--color-brand)] font-semibold rounded-full px-7 py-3 text-sm hover:bg-neutral-50 transition-colors flex items-center gap-2">
                Reservar consulta <ArrowRight weight="bold" size={14} />
              </Link>
              <Link to="/login" className="border border-white/40 text-white font-semibold rounded-full px-7 py-3 text-sm hover:bg-white/10 transition-colors">
                Ya tengo cuenta
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--color-text-primary)] py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <CompanyLogo className="h-5 invert opacity-80" />
          <div className="flex gap-6 text-sm text-white/50">
            <Link to="/terminos" className="hover:text-white/80 transition-colors">Términos y condiciones</Link>
            <Link to="/login" className="hover:text-white/80 transition-colors">Iniciar sesión</Link>
            <Link to="/registro?tipo=profesional" className="hover:text-white/80 transition-colors">¿Sos profesional?</Link>
          </div>
          <p className="text-xs text-white/30">© 2026 Healthier · Buenos Aires</p>
        </div>
      </footer>

    </div>
  )
}
