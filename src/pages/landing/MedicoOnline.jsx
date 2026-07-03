import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Tag, Clock, Lock, ArrowRight,
  MapPin, FileText, Stethoscope, Brain, Baby, FirstAid,
  ClipboardText,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { LandingFooter } from '../../components/landing/LandingFooter'
import { captureUtms } from '../../lib/utms'

const SPECIALTIES = [
  { icon: Stethoscope, label: 'Clínica general',     from: 'from-brand/20',          to: 'to-brand/40' },
  { icon: Brain,       label: 'Psicología',           from: 'from-brand-tertiary/20', to: 'to-brand-tertiary/40' },
  { icon: FileText,    label: 'Nutrición',            from: 'from-amber-100',         to: 'to-amber-200' },
  { icon: ClipboardText, label: 'Recetas digitales', from: 'from-emerald-100',        to: 'to-emerald-200' },
  { icon: FirstAid,    label: 'Consultas urgentes',  from: 'from-accent/20',         to: 'to-accent/40' },
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
  { icon: Tag,           title: 'Precio visible',           desc: 'Sabés cuánto pagás antes de reservar.', from: 'from-amber-50',          to: 'to-amber-100' },
  { icon: ShieldCheck,   title: 'Profesionales verificados', desc: 'Título, matrícula y perfil confiable.', from: 'from-brand/8',           to: 'to-brand/20' },
  { icon: FileText,      title: 'Receta digital',            desc: 'La recibís al instante, sin volver al consultorio.', from: 'from-emerald-50', to: 'to-emerald-100' },
  { icon: MapPin,        title: 'Desde cualquier ciudad',    desc: 'Consultá desde donde estés.',           from: 'from-sky-50',            to: 'to-sky-100' },
  { icon: ClipboardText, title: 'Historial centralizado',    desc: 'Toda tu información clínica en un solo lugar.', from: 'from-brand-tertiary/8', to: 'to-brand-tertiary/20' },
]

const SINS = [
  { title: 'Sin sorpresas',      desc: 'Precio claro antes de reservar.' },
  { title: 'Sin trámites',       desc: 'Sin autorizaciones ni vueltas.' },
  { title: 'Sin traslados',      desc: 'Consultá desde tu celular o notebook.' },
  { title: 'Sin cobertura médica', desc: 'Accedé igual, cuando lo necesitás.' },
]

export default function LandingMedicoOnline() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-bg-primary">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-bg-primary/95 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo size="sm" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-text-secondary">Médicos verificados online</span>
            <Link to="/registro" className="btn-accent rounded-full text-sm px-5 py-2">Reservar consulta</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-20 px-6 rounded-t-3xl">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <p className="text-xs font-semibold tracking-widest text-brand uppercase mb-5 flex items-center gap-2">
                <span className="inline-block w-8 h-px bg-brand" />
                Médico online sin cobertura médica
              </p>
              <h1 className="text-4xl sm:text-5xl font-light leading-tight text-text-primary mb-6">
                Sin cobertura médica no debería significar sin atención médica
              </h1>
              <p className="text-lg text-text-secondary mb-8 leading-relaxed">
                Elegí médico. Mirá el precio. Reservá en minutos.<br />
                Profesionales verificados disponibles online.
              </p>
              <div className="flex flex-wrap gap-3 mb-10">
                <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold inline-flex items-center gap-2">
                  Reservar consulta <ArrowRight weight="bold" size={16} />
                </Link>
                <span className="inline-flex items-center gap-2 text-sm text-text-secondary border border-border-default rounded-full px-5 py-3 bg-white">
                  <MapPin size={15} className="text-brand" />
                  Disponible desde cualquier ciudad
                </span>
              </div>
              <div className="flex flex-wrap gap-6 text-sm text-text-secondary">
                {[[Tag, 'Precio transparente', 'Lo ves antes de reservar'], [Clock, 'Respuesta rápida', 'Consultas en minutos'], [Lock, 'Seguro y confidencial', 'Tus datos protegidos']].map(([Icon, label, sub]) => (
                  <div key={label} className="flex items-center gap-2">
                    <Icon size={18} className="text-brand shrink-0" />
                    <div>
                      <div className="font-medium text-text-primary text-xs">{label}</div>
                      <div className="text-xs text-text-tertiary">{sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — specialty panel as forhers gradient card */}
            <div className="relative">
              <div className="absolute -inset-4 bg-brand/6 rounded-[2rem]" />
              <div className="relative bg-gradient-to-b from-brand/15 to-brand/35 rounded-3xl overflow-hidden border border-brand/20">
                <div className="img-grain">
                  <img
                    src="/images/landing/doctora-online.jpg"
                    alt="Doctora saludando en videoconsulta"
                    className="w-full h-52 object-cover object-[50%_40%]"
                  />
                </div>
                <div className="bg-white/90 backdrop-blur-sm px-6 py-4 border-b border-border-default/30">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Especialidades disponibles</p>
                </div>
                <div className="p-5 grid grid-cols-1 gap-2">
                  {SPECIALTIES.map(({ icon: Icon, label, from, to }) => (
                    <Link
                      key={label}
                      to="/registro"
                      className={`flex items-center gap-3 bg-gradient-to-r ${from} ${to} rounded-2xl px-4 py-3 border border-white/60 hover:opacity-90 transition-opacity group`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-white/60 border border-white/80 flex items-center justify-center shrink-0">
                        <Icon size={15} className="text-text-primary" />
                      </div>
                      <span className="text-sm font-semibold text-text-primary">{label}</span>
                      <ArrowRight size={13} className="text-text-tertiary ml-auto group-hover:text-brand transition-colors" />
                    </Link>
                  ))}
                  <div className="pt-1 px-1">
                    <span className="text-xs font-semibold text-brand/80">Sin trámites · Sin sorpresas</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pain + Features */}
      <section className="py-20 px-6 bg-white rounded-t-3xl">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16">
          <div>
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-3">Sabemos lo que pasa</p>
            <ul className="space-y-4">
              {PAINS.map((pain, i) => (
                <li key={pain} className="flex items-start gap-4">
                  <span className="text-xs font-light text-brand w-5 pt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-text-primary font-medium">{pain}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-3">Atención médica transparente cuando la necesitás</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
              {FEATURES.map(({ icon: Icon, title, desc, from, to }) => (
                <div key={title} className={`bg-gradient-to-br ${from} ${to} rounded-2xl border border-black/5 p-4`}>
                  <div className="w-9 h-9 rounded-xl bg-white/70 border border-white/80 flex items-center justify-center mb-3">
                    <Icon size={18} className="text-brand" />
                  </div>
                  <p className="text-sm font-semibold text-text-primary mb-1">{title}</p>
                  <p className="text-xs text-text-secondary leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Sin row */}
      <section className="py-14 px-6 bg-bg-primary border-t border-border-default rounded-t-3xl">
        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
          {SINS.map(({ title, desc }) => (
            <div key={title} className="bg-white rounded-2xl border border-border-default p-4">
              <p className="font-semibold text-sm text-text-primary mb-1">{title}</p>
              <p className="text-xs text-text-secondary">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="relative overflow-hidden py-24 px-6 bg-[#26331F] rounded-t-3xl">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.32)_55%,transparent_80%)]" />
        <div className="relative max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-8">
          <div className="shrink-0 w-24 h-24 rounded-full border-4 border-white/30 bg-white/10 flex flex-col items-center justify-center text-white">
            <span className="text-xs font-medium uppercase tracking-wider text-white/70 mb-0.5">Atención</span>
            <span className="text-2xl font-light leading-none">5</span>
            <span className="text-xs font-medium uppercase tracking-wider text-white/70">min</span>
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-2xl sm:text-3xl font-light text-white mb-4">
              Tu próxima consulta puede empezar hoy
            </h2>
            <p className="text-white/75 mb-6 text-sm">Accedé desde cualquier ciudad, sin guardias ni trámites.</p>
            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              <Link to="/registro" className="bg-white text-[#26331F] font-semibold rounded-xl px-7 py-3 text-sm hover:bg-gray-50 transition-colors inline-flex items-center gap-2">
                Reservar consulta <ArrowRight weight="bold" size={14} />
              </Link>
              <Link to="/login" className="border border-white/30 text-white font-semibold rounded-xl px-7 py-3 text-sm hover:bg-white/10 transition-colors">
                Ya tengo cuenta
              </Link>
            </div>
          </div>
        </div>
      </section>

      <LandingFooter />

    </div>
  )
}
