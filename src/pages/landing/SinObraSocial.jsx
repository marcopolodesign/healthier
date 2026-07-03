import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Tag, Clock, Lock, Check, X, ArrowRight,
  MapPin, FileText, MagnifyingGlass, Calendar, Video,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { LandingFooter } from '../../components/landing/LandingFooter'
import { captureUtms } from '../../lib/utms'

const PAIN_ITEMS = [
  'Guardias con costos altísimos.',
  'Turnos que nunca conseguís.',
  'Trámites eternos y autorizaciones.',
  'Precios que no sabés hasta el final.',
  'Perdés tiempo que no tenés.',
]

const FEATURES = [
  { icon: Tag,         title: 'Precio visible',              desc: 'Sabés cuánto pagás antes de reservar. Sin letras chicas.', from: 'from-amber-50',          to: 'to-amber-100' },
  { icon: Clock,       title: 'Turnos en minutos',            desc: 'Atención rápida, cuando la necesitás.',                   from: 'from-brand/8',           to: 'to-brand/20' },
  { icon: MapPin,      title: 'Desde cualquier ciudad',       desc: 'Consultá desde tu casa, oficina o donde estés.',          from: 'from-sky-50',            to: 'to-sky-100' },
  { icon: FileText,    title: 'Receta digital al instante',   desc: 'La recibís y la usás sin moverte.',                       from: 'from-emerald-50',        to: 'to-emerald-100' },
  { icon: ShieldCheck, title: 'Profesionales de confianza',   desc: 'Médicos verificados y calificados.',                      from: 'from-brand-tertiary/8',  to: 'to-brand-tertiary/20' },
]

const STEPS = [
  { n: '01', icon: MagnifyingGlass, title: 'Elegís médico',     desc: 'Buscá por especialidad y mirá el precio antes de reservar.' },
  { n: '02', icon: Calendar,        title: 'Reservás',           desc: 'Elegís día y horario. En minutos.' },
  { n: '03', icon: Video,           title: 'Consultás online',   desc: 'Desde tu dispositivo, sin traslados.' },
  { n: '04', icon: FileText,        title: 'Recibís tu receta',  desc: 'Receta digital y resumen en tu historial al instante.' },
]

export default function LandingSinObraSocial() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-bg-primary">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-bg-primary/95 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo size="sm" /></Link>
          <div className="flex items-center gap-6 text-sm text-text-secondary">
            <a href="#como-funciona" className="hidden sm:block hover:text-text-primary transition-colors">¿Cómo funciona?</a>
            <Link to="/registro" className="btn-accent rounded-full text-sm px-5 py-2">Reservar consulta</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl font-light leading-tight text-text-primary mb-6">
                Sin obra social no debería significar sin atención médica.
              </h1>
              <p className="text-lg text-text-secondary mb-8 leading-relaxed">
                Médicos verificados. Precios claros.<br />
                Consulta online cuando lo necesitás.<br />
                Sin trámites. Sin sorpresas.
              </p>
              <Link to="/registro" className="btn-accent rounded-full px-7 py-3 text-base font-semibold inline-flex items-center gap-2 mb-10">
                Reservar consulta <ArrowRight weight="bold" size={16} />
              </Link>
              <div className="grid grid-cols-2 gap-4">
                {[[Tag, 'Precio transparente'], [Clock, 'Atención en minutos'], [FileText, 'Receta digital al instante'], [ShieldCheck, 'Profesionales verificados']].map(([Icon, label]) => (
                  <div key={label} className="flex items-center gap-2 text-sm text-text-secondary">
                    <Icon size={16} className="text-brand shrink-0" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — price card as forhers gradient card */}
            <div className="relative">
              <div className="absolute -inset-4 bg-brand/6 rounded-[2rem]" />
              <div className="relative bg-gradient-to-br from-brand to-brand-hover rounded-3xl overflow-hidden shadow-lg">
                <div className="p-7 text-white">
                  <p className="text-sm font-medium text-white/70 mb-1">Consulta clínica online</p>
                  <p className="text-5xl font-light mb-6">$14.900</p>
                  <ul className="space-y-3 mb-7">
                    {['Profesional verificado', 'Atención online', 'Receta digital incluida', 'Sin trámites', 'Sin sorpresas'].map(item => (
                      <li key={item} className="flex items-center gap-3 text-sm bg-white/10 rounded-xl px-4 py-2.5 border border-white/15">
                        <Check size={15} weight="bold" className="text-white/80 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link to="/registro" className="block w-full text-center bg-white text-brand font-semibold rounded-xl py-3 text-sm hover:bg-gray-50 transition-colors">
                    Reservar ahora
                  </Link>
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
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-3">Sabemos lo que vivís</p>
            <h2 className="text-2xl font-light text-text-primary mb-8 leading-tight">
              La salud no debería ser complicada ni impredecible.
            </h2>
            <ul className="space-y-4 mb-8">
              {PAIN_ITEMS.map(item => (
                <li key={item} className="flex items-start gap-3 text-text-secondary">
                  <X size={16} weight="bold" className="text-accent mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-3xl overflow-hidden border border-border-default img-grain">
              <img
                src="/images/landing/persona-celular.jpg"
                alt="Paciente reservando una consulta desde su celular"
                loading="lazy"
                className="w-full h-64 object-cover"
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-3">Healthier es diferente</p>
            <h2 className="text-2xl font-light text-text-primary mb-8 leading-tight">
              Atención médica clara, rápida y sin burocracia.
            </h2>
            <div className="space-y-3">
              {FEATURES.map(({ icon: Icon, title, desc, from, to }) => (
                <div key={title} className={`flex items-start gap-4 bg-gradient-to-br ${from} ${to} rounded-2xl border border-black/5 p-4`}>
                  <div className="w-10 h-10 rounded-xl bg-white/70 border border-white/80 flex items-center justify-center shrink-0">
                    <Icon size={18} className="text-brand" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-text-primary">{title}</p>
                    <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="py-20 px-6 bg-bg-primary">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase text-center mb-3">¿Cómo funciona?</p>
          <h2 className="text-3xl font-light text-text-primary text-center mb-14">En 4 pasos, sin complicaciones.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {STEPS.map(({ n, icon: Icon, title, desc }) => (
              <div key={n}>
                <div className="text-5xl font-light text-brand/10 mb-4 leading-none select-none">{n}</div>
                <div className="w-12 h-12 rounded-2xl bg-white border border-border-default shadow-sm flex items-center justify-center mb-4">
                  <Icon size={20} className="text-brand" />
                </div>
                <p className="font-semibold text-text-primary mb-1">{title}</p>
                <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="relative overflow-hidden py-24 px-6 bg-[#26331F]">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.32)_55%,transparent_80%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-4">Tu próxima consulta</p>
          <h2 className="text-3xl sm:text-4xl font-light text-white mb-5">Tu próxima consulta puede empezar hoy.</h2>
          <p className="text-white/75 mb-8 max-w-xl mx-auto">Atención médica de calidad, sin trámites ni sorpresas. Cuando la necesitás, a un tap de distancia.</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/registro" className="bg-white text-[#26331F] font-semibold rounded-xl px-8 py-3 text-sm hover:bg-gray-50 transition-colors inline-flex items-center gap-2">
              Reservar consulta <ArrowRight weight="bold" size={14} />
            </Link>
            <Link to="/login" className="border border-white/30 text-white font-semibold rounded-xl px-8 py-3 text-sm hover:bg-white/10 transition-colors">
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />

    </div>
  )
}
