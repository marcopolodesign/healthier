import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Clock, Lock, Check, ArrowRight,
  Thermometer, Drop, Smiley, Sun, Baby,
  Calendar, FileText, Clipboard, ClipboardText,
  Users, Car, Cards,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { LandingFooter } from '../../components/landing/LandingFooter'
import { captureUtms } from '../../lib/utms'

const SYMPTOMS = [
  { icon: Thermometer, label: 'Fiebre alta' },
  { icon: Drop,        label: 'Problemas de lactancia' },
  { icon: Smiley,      label: 'Cólicos y llanto' },
  { icon: Sun,         label: 'Erupciones y piel' },
  { icon: Baby,        label: 'Dudas de recién nacido' },
]

const PAINS = [
  'Tu bebé llora.',
  'Son las 2 de la mañana.',
  'No sabés si es urgente.',
  'Tu pediatra no responde.',
  'La guardia está lejos.',
  'Necesitás una respuesta ahora.',
]

const FEATURES = [
  { icon: ShieldCheck,  title: 'Pediatras verificados',    desc: 'Matrícula, título y mala praxis verificados.', from: 'from-brand/8',          to: 'to-brand/20' },
  { icon: Calendar,     title: 'Turnos en minutos',        desc: 'Elegís horario y consultás desde donde estés.', from: 'from-emerald-50',     to: 'to-emerald-100' },
  { icon: FileText,     title: 'Receta digital',           desc: 'La recibís al instante y válida en todo el país.', from: 'from-amber-50',    to: 'to-amber-100' },
  { icon: Clipboard,    title: 'Seguimiento',              desc: 'Controles y alertas para cuidar a tu bebé siempre.', from: 'from-brand-tertiary/8', to: 'to-brand-tertiary/20' },
  { icon: ClipboardText, title: 'Historial centralizado', desc: 'Toda su historia clínica en un solo lugar.',    from: 'from-sky-50',          to: 'to-sky-100' },
]

const SINS = [
  { icon: Users, title: 'Sin salas de espera', desc: 'Consultá desde tu casa, sin filas ni esperas.' },
  { icon: Car,   title: 'Sin traslados',        desc: 'Evitá viajes y traslados innecesarios.' },
  { icon: Cards, title: 'Sin obra social',      desc: 'Accedé sin obra social o prepaga.' },
  { icon: ClipboardText, title: 'Sin autorizaciones', desc: 'Sin trámites ni autorizaciones previas.' },
]

export default function LandingPediatria() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-bg-primary">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-bg-primary/95 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo size="sm" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-text-secondary">Pediatras verificados online</span>
            <Link to="/registro" className="btn-accent rounded-full text-sm px-5 py-2">Hablar con un pediatra</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <p className="text-xs font-semibold tracking-widest text-brand uppercase mb-5 flex items-center gap-2">
                <span className="inline-block w-8 h-px bg-brand" />
                Pediatría online 24/7
              </p>
              <h1 className="text-4xl sm:text-5xl font-light leading-tight text-text-primary mb-6">
                Cuando tu bebé tiene fiebre a las&nbsp;2&nbsp;AM
              </h1>
              <p className="text-lg text-text-secondary mb-8 leading-relaxed">
                No necesitás esperar a la guardia.<br />
                Pediatras verificados disponibles online.
              </p>
              <div className="flex flex-wrap gap-3 mb-10">
                <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold inline-flex items-center gap-2">
                  Hablar con un pediatra <ArrowRight weight="bold" size={16} />
                </Link>
                <span className="inline-flex items-center gap-2 text-sm text-text-secondary border border-border-default rounded-full px-5 py-3 bg-white">
                  <Clock size={15} className="text-brand" />
                  Disponible 24/7
                </span>
              </div>
              <div className="flex flex-wrap gap-6 text-sm text-text-secondary">
                {[[ShieldCheck, 'Pediatras verificados', 'Matrícula + verificación'], [Clock, 'Respuesta rápida', 'En minutos'], [Lock, 'Seguro y confidencial', 'Tus datos protegidos']].map(([Icon, label, sub]) => (
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

            {/* Right — symptom panel as gradient card */}
            <div className="relative">
              <div className="absolute -inset-4 bg-brand/6 rounded-[2rem]" />
              <div className="relative bg-gradient-to-b from-brand/15 to-brand/35 rounded-3xl overflow-hidden border border-brand/20">
                <div className="img-grain">
                  <img
                    src="/images/landing/pediatria-hero.jpg"
                    alt="Mamá con su bebé en casa"
                    className="w-full h-48 object-cover"
                  />
                </div>
                <div className="bg-white/90 backdrop-blur-sm px-6 py-4 border-b border-border-default/30">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Consultas más frecuentes</p>
                </div>
                <div className="p-6 space-y-3">
                  {SYMPTOMS.map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-3 bg-white/55 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/70">
                      <div className="w-8 h-8 rounded-xl bg-white/60 border border-white/80 flex items-center justify-center shrink-0">
                        <Icon size={16} className="text-brand" />
                      </div>
                      <span className="text-sm font-medium text-text-primary">{label}</span>
                    </div>
                  ))}
                  <div className="pt-1">
                    <span className="text-xs font-semibold text-brand/80">Disponible 24/7 — sin turno previo</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pain + Features */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16">
          <div>
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-5">Sabemos cómo se siente</p>
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
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-5">Atención pediátrica cuando la necesitás</p>
            <div className="grid grid-cols-2 gap-3">
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
      <section className="py-14 px-6 bg-bg-primary border-t border-border-default">
        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-6">
          {SINS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
                <Icon size={18} className="text-brand" />
              </div>
              <div>
                <p className="font-semibold text-sm text-text-primary">{title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final — forhers profesionales section style */}
      <section className="relative overflow-hidden py-24 px-6 bg-[#26331F]">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.32)_55%,transparent_80%)]" />
        <div className="relative max-w-4xl mx-auto flex flex-col sm:flex-row items-center gap-8">
          <div className="shrink-0 w-24 h-24 rounded-full border-4 border-white/30 bg-white/10 flex flex-col items-center justify-center text-white">
            <span className="text-2xl font-light leading-none">5</span>
            <span className="text-xs font-medium uppercase tracking-wider text-white/70">min</span>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-3">Atención inmediata</p>
            <h2 className="text-2xl sm:text-3xl font-light text-white mb-5">
              Una respuesta médica puede estar a menos de 5 minutos
            </h2>
            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              <Link to="/registro" className="bg-white text-[#26331F] font-semibold rounded-xl px-7 py-3 text-sm hover:bg-gray-50 transition-colors inline-flex items-center gap-2">
                Hablar con un pediatra <ArrowRight size={14} />
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
