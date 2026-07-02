import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Tag, Clock, Lock, Check, ArrowRight,
  MapPin, FileText, Stethoscope, Brain, AppleLogo,
  Baby, FirstAid, MagnifyingGlass, Calendar, Clipboard,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { captureUtms } from '../lib/utms'

// ── Data ──────────────────────────────────────────────────────────────────────

const SPECIALTIES = [
  { icon: Stethoscope, label: 'Clínica general',    href: '/registro' },
  { icon: Brain,       label: 'Psicología',          href: '/registro' },
  { icon: AppleLogo,   label: 'Nutrición',           href: '/registro' },
  { icon: Baby,        label: 'Pediatría',           href: '/registro' },
  { icon: FirstAid,    label: 'Consultas urgentes',  href: '/registro' },
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
  {
    icon: Tag,
    title: 'Precio visible',
    desc: 'Sabés cuánto pagás antes de reservar. Sin letras chicas ni sorpresas.',
  },
  {
    icon: ShieldCheck,
    title: 'Profesionales verificados',
    desc: 'Título, matrícula y perfil confiable. Revisamos cada profesional.',
  },
  {
    icon: FileText,
    title: 'Receta digital',
    desc: 'La recibís al instante en tu historial. Sin volver al consultorio.',
  },
  {
    icon: MapPin,
    title: 'Desde cualquier ciudad',
    desc: 'Consultá desde tu casa, oficina o donde estés. 100% online.',
  },
  {
    icon: Clipboard,
    title: 'Historial centralizado',
    desc: 'Toda tu información clínica en un solo lugar, siempre disponible.',
  },
]

const SINS = [
  { title: 'Sin sorpresas',         desc: 'Precio claro antes de reservar.' },
  { title: 'Sin trámites',          desc: 'Sin autorizaciones ni vueltas.' },
  { title: 'Sin traslados',         desc: 'Desde tu celular o notebook.' },
  { title: 'Sin cobertura médica',  desc: 'Accedé igual, cuando lo necesitás.' },
]

const STEPS = [
  { icon: MagnifyingGlass, num: '01', title: 'Elegís médico',           desc: 'Buscá por especialidad y mirá el precio antes de reservar.' },
  { icon: Calendar,        num: '02', title: 'Reservás',                desc: 'Elegís horario y confirmás en minutos desde tu celular.' },
  { icon: Clock,           num: '03', title: 'Consultás online',        desc: 'Videollamada con el profesional desde donde estés.' },
  { icon: FileText,        num: '04', title: 'Recibís tu receta',       desc: 'Resumen y receta digital al instante en tu historial.' },
]

const PRICE_INCLUDES = [
  'Profesional verificado',
  'Atención online',
  'Receta digital incluida',
  'Sin trámites',
  'Sin sorpresas',
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function Landing() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-bg-secondary font-sans">

      {/* ── Navbar ── */}
      <nav className="fixed top-0 inset-x-0 z-40 bg-bg-secondary/90 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <CompanyLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-secondary text-sm hidden sm:inline-flex py-2 px-4">
              Iniciar sesión
            </Link>
            <Link to="/registro" className="btn-accent text-sm py-2 px-5 rounded-full">
              Reservar consulta
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-24 pb-0 px-4 bg-bg-secondary">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center min-h-[520px]">

            {/* Left — copy */}
            <div className="py-12 lg:py-20">
              <span className="inline-block text-xs font-bold tracking-widest text-brand uppercase mb-5">
                Médico online sin obra social
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-text-primary leading-[1.08] mb-6">
                Sin obra social no debería significar sin atención médica.
              </h1>
              <p className="text-lg text-text-secondary mb-8 max-w-lg">
                Elegí médico. Mirá el precio. Reservá en minutos.
                Profesionales verificados disponibles online.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <Link to="/registro"
                  className="btn-accent text-base px-8 py-3.5 rounded-full inline-flex items-center justify-center gap-2">
                  Reservar consulta <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/login"
                  className="btn-secondary text-base px-8 py-3.5 rounded-full inline-flex items-center justify-center">
                  Ya tengo cuenta
                </Link>
              </div>

              {/* Trust bar */}
              <div className="flex flex-wrap gap-5 text-sm text-text-secondary">
                {[
                  { icon: Tag,         text: 'Precio transparente' },
                  { icon: Clock,       text: 'Respuesta rápida' },
                  { icon: Lock,        text: 'Seguro y confidencial' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-brand" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — specialty panel */}
            <div className="hidden lg:block">
              <div className="bg-white rounded-3xl shadow-sm border border-border-default p-6 ml-auto max-w-[320px]">
                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest mb-4">
                  Consultas para:
                </p>
                <div className="space-y-2">
                  {SPECIALTIES.map(({ icon: Icon, label, href }) => (
                    <Link key={label} to={href}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-bg-primary transition-colors group">
                      <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-brand" />
                      </div>
                      <span className="text-sm font-medium text-text-primary group-hover:text-brand transition-colors">
                        {label}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  ))}
                </div>
                <p className="text-xs text-brand font-semibold mt-5 text-center">
                  Sin trámites. Sin sorpresas.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Disponible desde cualquier ciudad pill */}
        <div className="max-w-6xl mx-auto pb-4">
          <div className="inline-flex items-center gap-2 bg-white border border-border-default rounded-full px-4 py-2 text-sm text-text-secondary shadow-sm">
            <MapPin className="h-3.5 w-3.5 text-brand" />
            Disponible desde cualquier ciudad
          </div>
        </div>
      </section>

      {/* ── Pain section ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-xs font-bold tracking-widest text-brand uppercase mb-3">
              Sabemos lo que pasa
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary leading-tight mb-6">
              La salud no debería ser complicada ni impredecible.
            </h2>
            <Link to="/registro"
              className="btn-accent inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold">
              Empezar ahora <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {PAINS.map((pain, i) => (
              <div key={pain}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-border-default">
                <span className="text-sm font-bold text-brand/60 tabular-nums shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-sm text-text-primary">{pain}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-4 bg-bg-secondary">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-bold tracking-widest text-brand uppercase mb-3">
              Healthier es diferente
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary max-w-lg leading-tight">
              Atención médica clara, rápida y sin burocracia.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title}
                className="bg-white rounded-2xl border border-border-default p-6 flex flex-col gap-4">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-brand" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary mb-1">{title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}

            {/* Price card inline in the grid */}
            <div className="bg-brand rounded-2xl p-6 flex flex-col gap-4 text-white sm:col-span-2 lg:col-span-1">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-white/70 mb-1">
                  Consulta clínica online
                </p>
                <p className="text-4xl font-bold">$14.900</p>
              </div>
              <div className="space-y-2">
                {PRICE_INCLUDES.map(item => (
                  <div key={item} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-white/80 shrink-0" />
                    <span className="text-white/90">{item}</span>
                  </div>
                ))}
              </div>
              <Link to="/registro"
                className="mt-auto bg-white text-brand font-semibold text-sm px-5 py-2.5 rounded-full text-center hover:bg-bg-primary transition-colors">
                Reservar ahora
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── "Sin..." value props ── */}
      <section className="py-12 px-4 bg-bg-primary border-y border-border-default">
        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4">
          {SINS.map(({ title, desc }) => (
            <div key={title} className="text-center">
              <p className="font-semibold text-text-primary mb-1">{title}</p>
              <p className="text-xs text-text-secondary">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="py-20 px-4 bg-bg-secondary">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-bold tracking-widest text-brand uppercase mb-3">
              ¿Cómo funciona?
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary">
              En 4 pasos, sin complicaciones.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map(({ icon: Icon, num, title, desc }, i) => (
              <div key={num} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-5 left-[calc(100%-8px)] w-full h-px bg-border-default z-0" />
                )}
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-bold text-text-tertiary">{num}</span>
                  </div>
                  <h3 className="font-semibold text-text-primary mb-1">{title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mobile specialty links ── */}
      <section className="py-12 px-4 bg-bg-primary lg:hidden">
        <div className="max-w-md mx-auto">
          <p className="text-xs font-bold tracking-widest text-brand uppercase mb-4">
            Consultas para:
          </p>
          <div className="space-y-2">
            {SPECIALTIES.map(({ icon: Icon, label, href }) => (
              <Link key={label} to={href}
                className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-border-default hover:border-brand/30 transition-colors group">
                <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-brand" />
                </div>
                <span className="text-sm font-medium text-text-primary">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-text-tertiary ml-auto" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-20 px-4 bg-brand">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
            <Clock className="h-3.5 w-3.5" />
            Atención inmediata · 5 min
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Tu próxima consulta puede empezar hoy.
          </h2>
          <p className="text-white/80 text-lg mb-8">
            Atención médica de calidad, sin trámites ni sorpresas.
            Cuando la necesitás, a un tap de distancia.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/registro"
              className="bg-white text-brand font-semibold px-8 py-3.5 rounded-full hover:bg-bg-primary transition-colors inline-flex items-center justify-center gap-2">
              Reservar consulta <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login"
              className="border border-white/40 text-white font-semibold px-8 py-3.5 rounded-full hover:bg-white/10 transition-colors">
              Ya tengo cuenta
            </Link>
          </div>
          <p className="text-white/60 text-xs mt-6">
            Accedé desde cualquier ciudad, sin guardias ni trámites.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-text-primary text-text-tertiary py-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <CompanyLogo size="sm" inverted />
          <div className="flex gap-6 text-xs">
            <Link to="/terminos" className="hover:text-white transition-colors">Términos y condiciones</Link>
            <Link to="/login" className="hover:text-white transition-colors">Iniciar sesión</Link>
            <Link to="/registro?tipo=profesional" className="hover:text-white transition-colors">¿Sos profesional?</Link>
          </div>
          <p className="text-xs">© {new Date().getFullYear()} Healthier · Buenos Aires</p>
        </div>
      </footer>

    </div>
  )
}
