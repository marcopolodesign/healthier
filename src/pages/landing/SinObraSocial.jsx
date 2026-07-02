import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Tag, Clock, Lock, Check, X, ArrowRight,
  MapPin, FileText, Stethoscope, Brain, AppleLogo, Baby, FirstAid,
  MagnifyingGlass, Calendar, Video, Clipboard,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { captureUtms } from '../../lib/utms'

const PAIN_ITEMS = [
  'Guardias con costos altísimos.',
  'Turnos que nunca conseguís.',
  'Trámites eternos y autorizaciones.',
  'Precios que no sabés hasta el final.',
  'Perdés tiempo que no tenés.',
]

const FEATURES = [
  { icon: Tag,         title: 'Precio visible',              desc: 'Sabés cuánto pagás antes de reservar. Sin letras chicas. Sin sorpresas.' },
  { icon: Clock,       title: 'Turnos en minutos',            desc: 'Atención rápida, cuando la necesitás.' },
  { icon: MapPin,      title: 'Desde cualquier ciudad',       desc: 'Consultá desde tu casa, oficina o donde estés.' },
  { icon: FileText,    title: 'Receta digital al instante',   desc: 'La recibís y la usás sin moverte.' },
  { icon: ShieldCheck, title: 'Profesionales de confianza',   desc: 'Médicos verificados y calificados.' },
]

const STEPS = [
  { n: '01', icon: MagnifyingGlass, title: 'Elegís médico',       desc: 'Buscá por especialidad y mirá el precio antes de reservar.' },
  { n: '02', icon: Calendar,        title: 'Reservás',             desc: 'Elegís día y horario. En minutos.' },
  { n: '03', icon: Video,           title: 'Consultás online',     desc: 'Desde tu dispositivo, sin traslados.' },
  { n: '04', icon: FileText,        title: 'Recibís tu receta',    desc: 'Receta digital y resumen en tu historial al instante.' },
]

const TRUST = [
  [Tag,         'Ves el precio antes de reservar'],
  [Clock,       'Atención en minutos'],
  [FileText,    'Receta digital al instante'],
  [ShieldCheck, 'Profesionales verificados'],
]

export default function LandingSinObraSocial() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] font-sans">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo className="h-6" /></Link>
          <div className="flex items-center gap-6 text-sm text-[var(--color-text-secondary)]">
            <a href="#como-funciona" className="hidden sm:block hover:text-[var(--color-text-primary)] transition-colors">¿Cómo funciona?</a>
            <a href="#profesionales" className="hidden sm:block hover:text-[var(--color-text-primary)] transition-colors">Profesionales</a>
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
              <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-[var(--color-text-primary)] mb-6">
                Sin obra social no debería significar sin atención médica.
              </h1>
              <p className="text-lg text-[var(--color-text-secondary)] mb-8 leading-relaxed">
                Médicos verificados. Precios claros.<br/>
                Consulta online cuando lo necesitás.<br/>
                Sin trámites. Sin sorpresas.
              </p>
              <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold inline-flex items-center gap-2 mb-10">
                Reservar consulta <ArrowRight weight="bold" size={16} />
              </Link>
              {/* Trust bar */}
              <div className="grid grid-cols-2 gap-4">
                {TRUST.map(([Icon, label]) => (
                  <div key={label} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <Icon size={16} weight="duotone" className="text-[var(--color-brand)] shrink-0" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — price card */}
            <div className="bg-[var(--color-brand)] rounded-2xl p-7 text-white shadow-lg">
              <p className="text-sm font-medium text-white/70 mb-1">Consulta clínica online</p>
              <p className="text-5xl font-bold mb-6">$14.900</p>
              <ul className="space-y-3 mb-7">
                {['Profesional verificado', 'Atención online', 'Receta digital incluida', 'Sin trámites', 'Sin sorpresas'].map(item => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <Check size={16} weight="bold" className="text-white/80 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/registro" className="block w-full text-center bg-white text-[var(--color-brand)] font-semibold rounded-full py-3 text-sm hover:bg-neutral-50 transition-colors">
                Reservar ahora
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pain + Features */}
      <section className="py-16 bg-[var(--color-bg-primary)]">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-16">
          {/* Pain */}
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase mb-2">Sabemos lo que vivís</p>
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-8 leading-tight">
              La salud no debería ser complicada ni impredecible.
            </h2>
            <ul className="space-y-4">
              {PAIN_ITEMS.map(item => (
                <li key={item} className="flex items-start gap-3 text-[var(--color-text-secondary)]">
                  <X size={16} weight="bold" className="text-[var(--color-brand-secondary)] mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Features */}
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase mb-2">Healthier es diferente</p>
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-8 leading-tight">
              Atención médica clara, rápida y sin burocracia.
            </h2>
            <div className="space-y-4">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 bg-white rounded-xl border border-neutral-100 p-4">
                  <span className="w-9 h-9 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center shrink-0">
                    <Icon size={18} weight="duotone" className="text-[var(--color-brand)]" />
                  </span>
                  <div>
                    <p className="font-semibold text-sm text-[var(--color-text-primary)]">{title}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="py-16 bg-[var(--color-bg-secondary)]">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase text-center mb-2">¿Cómo funciona?</p>
          <h2 className="text-3xl font-bold text-[var(--color-text-primary)] text-center mb-12">En 4 pasos, sin complicaciones.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {STEPS.map(({ n, icon: Icon, title, desc }, i) => (
              <div key={n} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-5 left-full w-full h-px bg-neutral-200 -translate-x-1/2 z-0" />
                )}
                <div className="relative z-10 flex flex-col items-start">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-brand)] flex items-center justify-center mb-3">
                    <Icon size={18} weight="duotone" className="text-white" />
                  </div>
                  <span className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">{n}</span>
                  <p className="font-semibold text-[var(--color-text-primary)] mb-1">{title}</p>
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 bg-[var(--color-brand)]">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-4">Tu próxima consulta</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">Tu próxima consulta puede empezar hoy.</h2>
          <p className="text-white/80 mb-8">Atención médica de calidad, sin trámites ni sorpresas. Cuando la necesitás, a un tap de distancia.</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/registro" className="bg-white text-[var(--color-brand)] font-semibold rounded-full px-8 py-3 text-sm hover:bg-neutral-50 transition-colors flex items-center gap-2">
              Reservar consulta <ArrowRight weight="bold" size={14} />
            </Link>
            <Link to="/login" className="border border-white/40 text-white font-semibold rounded-full px-8 py-3 text-sm hover:bg-white/10 transition-colors">
              Ya tengo cuenta
            </Link>
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
