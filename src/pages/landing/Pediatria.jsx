import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Clock, Lock, Check, ArrowRight,
  Thermometer, Drop, Smiley, Sun, Baby,
  MagnifyingGlass, Calendar, Video, FileText, Clipboard,
  Users, Car, Cards, ClipboardText,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { captureUtms } from '../../lib/utms'

const SYMPTOMS = [
  { icon: Thermometer, label: 'fiebre' },
  { icon: Drop,        label: 'lactancia' },
  { icon: Smiley,      label: 'cólicos' },
  { icon: Sun,         label: 'erupciones' },
  { icon: Baby,        label: 'dudas de recién nacidos' },
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
  { icon: ShieldCheck, title: 'Pediatras verificados',  desc: 'Matrícula, título y mala praxis verificados.' },
  { icon: Calendar,    title: 'Turnos en minutos',       desc: 'Elegís horario y consultás desde donde estés.' },
  { icon: FileText,    title: 'Receta digital',          desc: 'La recibís al instante y válida en todo el país.' },
  { icon: Clipboard,   title: 'Seguimiento',             desc: 'Controles y alertas para cuidar a tu bebé siempre.' },
  { icon: ClipboardText, title: 'Historial centralizado', desc: 'Toda su historia clínica en un solo lugar.' },
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
    <div className="min-h-screen bg-[var(--color-bg-primary)] font-sans">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo className="h-6" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-[var(--color-text-secondary)]">Pediatras verificados online</span>
            <Link to="/registro" className="btn-accent rounded-full text-sm px-5 py-2">Hablar con un pediatra</Link>
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
                Pediatría online 24/7
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-[var(--color-text-primary)] mb-6">
                Cuando tu bebé tiene fiebre a las&nbsp;2&nbsp;AM
              </h1>
              <p className="text-lg text-[var(--color-text-secondary)] mb-8 leading-relaxed">
                No necesitás esperar a la guardia.<br/>
                Pediatras verificados disponibles online.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold flex items-center gap-2">
                  Hablar con un pediatra <ArrowRight weight="bold" size={16} />
                </Link>
                <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] border border-neutral-200 rounded-full px-5 py-3 bg-white">
                  <Clock size={15} weight="duotone" className="text-[var(--color-brand)]" />
                  Disponible 24/7
                </span>
              </div>
              {/* Trust bar */}
              <div className="flex flex-wrap gap-5 text-sm text-[var(--color-text-secondary)]">
                {[
                  [ShieldCheck, 'Pediatras verificados', 'Matrícula + verificación'],
                  [Clock,       'Respuesta rápida',      'En minutos'],
                  [Lock,        'Seguro y confidencial', 'Tus datos protegidos'],
                ].map(([Icon, label, sub]) => (
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

            {/* Right — symptom panel */}
            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-6 lg:mt-4">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-widest mb-4">Consultas para:</p>
              <ul className="space-y-3 mb-6">
                {SYMPTOMS.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-3 text-[var(--color-text-primary)]">
                    <span className="w-8 h-8 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center shrink-0">
                      <Icon size={16} weight="duotone" className="text-[var(--color-brand)]" />
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold text-[var(--color-brand)]">Disponible 24/7.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pain section */}
      <section className="py-16 bg-[var(--color-bg-primary)]">
        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase mb-4">Sabemos cómo se siente</p>
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
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--color-text-secondary)] uppercase mb-4">
              Atención pediátrica cuando la necesitás
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-white rounded-xl border border-neutral-100 p-4">
                  <Icon size={24} weight="duotone" className="text-[var(--color-brand)] mb-3" />
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
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-8">
          {SINS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center shrink-0">
                <Icon size={18} weight="duotone" className="text-[var(--color-brand)]" />
              </span>
              <div>
                <p className="font-semibold text-sm text-[var(--color-text-primary)]">{title}</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 bg-[var(--color-brand)]">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center gap-8">
          {/* 5 min badge */}
          <div className="shrink-0 w-24 h-24 rounded-full border-4 border-white/40 flex flex-col items-center justify-center text-white">
            <span className="text-2xl font-bold leading-none">5</span>
            <span className="text-xs font-medium uppercase tracking-wider">min</span>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold text-white/70 uppercase tracking-widest mb-2">Atención inmediata</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Una respuesta médica puede estar a menos de 5 minutos
            </h2>
            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              <Link to="/registro" className="bg-white text-[var(--color-brand)] font-semibold rounded-full px-7 py-3 text-sm hover:bg-neutral-50 transition-colors">
                Hablar con un pediatra
              </Link>
              <p className="flex items-center gap-2 text-sm text-white/80 self-center">
                <span>Accedé desde tu celular, sin guardias ni trámites.</span>
              </p>
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
