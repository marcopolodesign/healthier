import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Star, MagnifyingGlass, Calendar, Heart,
  ArrowRight, CaretRight, ArrowDown, Plus,
  Lightning, ClipboardText, ChartLine, Pill, Robot,
  CheckCircle, Users, CurrencyDollar, DeviceMobile,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { LandingFooter } from '../components/landing/LandingFooter'
import { captureUtms } from '../lib/utms'

const SPECIALTIES = [
  { img: '/images/landing/esp-medicina.jpg',      label: 'Medicina General', tint: 'from-brand/25' },
  { img: '/images/landing/esp-psicologia.jpg',    label: 'Psicología',       tint: 'from-brand-tertiary/25' },
  { img: '/images/landing/esp-nutricion.jpg',     label: 'Nutrición',        tint: 'from-amber-200/40' },
  { img: '/images/landing/esp-pediatria.jpg',     label: 'Pediatría',        tint: 'from-sky-200/40' },
  { img: '/images/landing/esp-urgencias.jpg',     label: 'Urgencias',        tint: 'from-accent/25' },
  { img: '/images/landing/esp-entrenamiento.jpg', label: 'Entrenamiento',    tint: 'from-emerald-200/40' },
]

const SMALL_CARDS = [
  { img: '/images/landing/esp-psicologia.jpg', pre: 'Cuidá tu',    bold: 'mente',     to: '/registro' },
  { img: '/images/landing/esp-nutricion.jpg',  pre: 'Mejorá tu',   bold: 'nutrición', to: '/registro' },
  { img: '/images/landing/esp-medicina.jpg',   pre: 'Hacete un',   bold: 'chequeo',   to: '/registro' },
]

const STEPS = [
  { num: '01', icon: MagnifyingGlass, title: 'Elegís tu especialidad',     desc: 'Filtrá por tipo de consulta, disponibilidad inmediata o próximos turnos.' },
  { num: '02', icon: Calendar,        title: 'Agendás o consultás ahora',  desc: 'Reservá en el horario que te convenga, o iniciá una consulta al instante.' },
  { num: '03', icon: Heart,           title: 'Tu salud, en un solo lugar', desc: 'Historia clínica, recetas y análisis guardados en tu cuenta, para siempre.' },
]

const PRO_BENEFITS = [
  { icon: Calendar,       text: 'Agenda integrada y configurable' },
  { icon: Lightning,      text: 'Consultas on-demand e inmediatas' },
  { icon: ClipboardText,  text: 'Historia clínica digital compartida' },
  { icon: CurrencyDollar, text: 'Cobros seguros vía MercadoPago' },
  { icon: Users,          text: 'Crecé tu base de pacientes' },
  { icon: DeviceMobile,   text: 'App y web — desde cualquier dispositivo' },
]

// Invented app trend chart — Biovisor-style line with area fill
function TrendChart({ className }) {
  return (
    <svg viewBox="0 0 400 120" fill="none" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d="M0 95 C55 90, 85 62, 135 64 S 225 82, 275 54 S 355 24, 400 18 L400 120 L0 120 Z" fill="currentColor" opacity="0.22" />
      <path d="M0 95 C55 90, 85 62, 135 64 S 225 82, 275 54 S 355 24, 400 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="135" cy="64" r="4" fill="currentColor" />
      <circle cx="275" cy="54" r="4" fill="currentColor" />
      <circle cx="400" cy="18" r="4" fill="currentColor" />
    </svg>
  )
}

// Invented floating app card — HC/Biovisor mockup for the dark gradient section
function AppCard() {
  return (
    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6 w-full max-w-md mx-auto text-left shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">Biovisor · Análisis de rutina</p>
        <span className="text-xs bg-[#C9E489]/20 text-[#C9E489] px-2.5 py-1 rounded-full font-medium">Mejorando</span>
      </div>
      <TrendChart className="w-full h-20 text-[#C9E489] mb-4" />
      <div className="flex gap-2 flex-wrap">
        {['Colesterol ↓ 12%', 'Glucemia estable', 'Vitamina D ↑'].map(chip => (
          <span key={chip} className="text-xs bg-white/10 text-white/80 border border-white/15 px-2.5 py-1 rounded-full">{chip}</span>
        ))}
      </div>
    </div>
  )
}

export default function Landing() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-white">

      {/* ── Announcement bar (forhers chip bar) ── */}
      <div className="bg-[#DCE9C8] text-center py-2.5 px-4">
        <span className="text-sm text-[#2D3A26] font-medium">
          La receta electrónica llegó a Healthier.{' '}
          <Link to="/registro" className="inline-flex items-center gap-1 bg-[#2D3A26]/10 hover:bg-[#2D3A26]/15 transition-colors rounded-full px-3 py-1 font-semibold ml-1">
            Conocela <ArrowRight size={13} weight="bold" />
          </Link>
        </span>
      </div>

      {/* ── Navbar (minimal: logo + login pill + burger) ── */}
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur rounded-b-3xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <CompanyLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link to="/registro" className="bg-white border border-border-default hover:border-border-hover transition-colors rounded-full px-5 py-2 text-sm font-semibold text-text-primary shadow-sm">
              Registrarse
            </Link>
            <Link to="/login" className="bg-brand hover:bg-brand-hover transition-colors rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero: big headline + bento grid (forhers home) ── */}
      <section className="pt-10 pb-6 px-4 sm:px-6 rounded-t-3xl">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-light text-text-primary tracking-tight leading-[1.02] mb-10">
            El cuidado que<br />siempre mereciste
          </h1>

          {/* Row 1 — two large cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
            {/* Card A — dark sage, app graph behind */}
            <Link to="/registro" className="relative rounded-2xl overflow-hidden bg-[#33493A] h-[300px] p-7 flex flex-col justify-between group">
              <TrendChart className="absolute -right-6 bottom-6 w-3/4 h-32 text-[#C9E489] opacity-50" />
              <p className="relative text-[#D6E8C4] text-2xl font-semibold leading-snug">
                Empezá tu<br />consulta hoy
              </p>
              <div className="relative flex items-center justify-between">
                <span className="text-white font-medium text-sm">Encontrá tu especialista</span>
                <CaretRight size={18} weight="bold" className="text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>

            {/* Card B — photo with graph overlay */}
            <Link to="/registro" className="relative rounded-2xl overflow-hidden h-[300px] p-7 flex flex-col justify-between group img-grain">
              <img
                src="/images/landing/hero-main.jpg"
                alt="Paciente en videoconsulta desde su casa"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/40" />
              <TrendChart className="absolute inset-x-0 bottom-0 w-full h-24 text-[#C9E489] opacity-80" />
              <p className="relative z-[2] text-white text-2xl font-semibold leading-snug drop-shadow">
                Mirá tu salud<br />mejorar
              </p>
              <div className="relative z-[2] flex items-center justify-between">
                <span className="text-white font-medium text-sm inline-flex items-center gap-1.5">
                  <ArrowDown size={14} weight="bold" className="text-[#C9E489]" />
                  Biovisor: tus análisis en tendencia
                </span>
                <CaretRight size={18} weight="bold" className="text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          </div>

          {/* Row 2 — four small cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {SMALL_CARDS.map(c => (
              <Link
                key={c.bold}
                to={c.to}
                className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-bg-primary to-brand/10 border border-black/5 p-5 group"
              >
                <span className="text-text-primary text-sm sm:text-base">
                  {c.pre} <span className="font-light">{c.bold}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="w-12 h-12 rounded-xl overflow-hidden img-grain hidden sm:block">
                    <img src={c.img} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </span>
                  <CaretRight size={16} weight="bold" className="text-text-secondary group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
            <Link
              to="/registro"
              className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-bg-primary to-brand/10 border border-black/5 p-5 group"
            >
              <span className="text-text-primary text-sm sm:text-base">
                ¿No sabés por dónde empezar?<br /><span className="font-light">Empezá acá</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="w-12 h-12 rounded-xl overflow-hidden img-grain hidden sm:block">
                  <img src="/images/landing/doctora-online.jpg" alt="" loading="lazy" className="w-full h-full object-cover" />
                </span>
                <span className="w-8 h-8 rounded-full bg-[#2D2A26] flex items-center justify-center">
                  <Plus size={14} weight="bold" className="text-white" />
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Especialidades — photo category grid ── */}
      <section className="py-16 px-4 sm:px-6 bg-white rounded-t-3xl">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-light text-text-primary mb-2">Especialidades disponibles</h2>
              <p className="text-text-secondary">Médicos, psicólogos, nutricionistas y más</p>
            </div>
            <Link to="/registro" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover transition-colors">
              Ver todas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SPECIALTIES.map(s => (
              <Link key={s.label} to="/registro" className="relative rounded-2xl overflow-hidden min-h-[210px] border border-black/5 group img-grain">
                <img
                  src={s.img}
                  alt={s.label}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
                />
                <div className={`absolute inset-0 bg-gradient-to-b ${s.tint} to-transparent`} />
                <span className="absolute top-3 left-3 z-[2] text-sm font-semibold text-text-primary leading-snug drop-shadow-sm">{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Breakthrough — full-bleed dark gradient with light beam (forhers) ── */}
      <section className="relative overflow-hidden bg-[#26331F] py-32 sm:py-44 px-4 rounded-t-3xl">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,#26331F_0%,#26331F_28%,#D9E6BC_52%,#26331F_78%,#26331F_100%)] opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(38,51,31,0.55)_100%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-light leading-tight mb-6">
            <span className="text-white drop-shadow-md">Tu historia clínica</span><br />
            <span className="text-[#C9E489] drop-shadow-md">digital ya está acá</span>
          </h2>
          <p className="text-white/85 text-lg max-w-xl mx-auto mb-12 drop-shadow">
            Cada consulta, receta y análisis queda guardado en tu cuenta. Protegida por ley, disponible para siempre.
          </p>
          <AppCard />
          <div className="mt-12">
            <Link to="/registro" className="inline-flex items-center gap-2 bg-white text-[#26331F] font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-gray-100 transition-colors">
              Crear mi cuenta gratis <ArrowRight size={15} weight="bold" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Full-screen photo + blur transition to solid (forhers hair page) ── */}
      <section className="relative rounded-t-3xl">
        {/* Photo zone */}
        <div className="relative min-h-[95vh] flex flex-col img-grain">
          <img
            src="/images/landing/full-hero.jpg"
            alt="Paciente de Healthier al aire libre"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="relative z-[2] pt-24 px-4 text-center">
            <h2 className="text-4xl sm:text-5xl font-light text-white drop-shadow-lg leading-tight mb-10">
              Tu médico,<br />sin salir de casa
            </h2>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/registro" className="bg-white text-text-primary font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-gray-100 transition-colors shadow-lg">
                Reservar consulta
              </Link>
              <Link to="/login" className="bg-white/25 backdrop-blur-md border border-white/30 text-white font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-white/35 transition-colors">
                Ya tengo cuenta
              </Link>
            </div>
          </div>

          {/* Glass cards straddling the photo→solid boundary */}
          <div className="relative z-[2] mt-auto px-4 sm:px-6 pt-40">
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 translate-y-16">
              <div className="backdrop-blur-2xl bg-[#5F7A6D]/55 border border-white/10 rounded-3xl p-8 text-white">
                <h3 className="text-2xl font-semibold mb-3 leading-snug">Consultá con quien ya te conoce</h3>
                <p className="text-white/80 text-sm leading-relaxed mb-6">
                  Tu profesional accede a tu historia clínica completa antes de atenderte. Sin repetir tu historia en cada consulta.
                </p>
                <TrendChart className="w-full h-16 text-[#C9E489] opacity-90" />
              </div>
              <div className="backdrop-blur-2xl bg-[#5F7A6D]/55 border border-white/10 rounded-3xl p-8 text-white flex flex-col">
                <blockquote className="text-lg leading-relaxed mb-6">
                  "Empecé con una consulta rápida y terminé usando el Biovisor para entender mis análisis. <span className="text-[#C9E489]">Tener todo en un solo lugar cambió cómo cuido mi salud.</span>"
                </blockquote>
                <div className="mt-auto flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl overflow-hidden img-grain shrink-0">
                    <img src="/images/landing/quote-valentina.jpg" alt="Valentina R." loading="lazy" className="w-full h-full object-cover" />
                  </span>
                  <div>
                    <p className="font-semibold text-sm">Valentina R.</p>
                    <p className="text-white/60 text-xs">Paciente · Buenos Aires</p>
                  </div>
                  <div className="ml-auto flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} weight="fill" className="h-3.5 w-3.5 text-[#C9E489]" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Solid continuation — same hue as the glass tint */}
        <div className="bg-[#5F7A6D] pt-40 pb-24 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-light text-white mb-3">¿Cómo funciona?</h2>
            <p className="text-white/70 mb-12">Tres pasos para cuidar tu salud</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              {STEPS.map(step => (
                <div key={step.num}>
                  <div className="text-6xl font-light text-white/10 mb-4 leading-none select-none">{step.num}</div>
                  <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-4">
                    <step.icon className="h-7 w-7 text-[#C9E489]" />
                  </div>
                  <h3 className="font-semibold text-white mb-2 text-lg">{step.title}</h3>
                  <p className="text-sm text-white/70 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Para profesionales — dark olive with light beam, lime accents ── */}
      <section className="relative overflow-hidden py-28 px-4 sm:px-6 bg-[#26331F] rounded-t-3xl">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.32)_55%,transparent_80%)]" />
        <div className="relative max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-sm text-[#C9E489] uppercase tracking-widest mb-5 block">Para profesionales</span>
              <h2 className="text-4xl sm:text-5xl font-light text-white mb-6 leading-tight">
                Hacé crecer tu práctica<br />
                <span className="text-[#C9E489]">con Healthier</span>
              </h2>
              <p className="text-white/75 mb-5 leading-relaxed">
                Gestioná tu agenda, ofrecé consultas inmediatas y construí tu reputación online. Con historia clínica integrada, recetas digitales y pagos automáticos.
              </p>
              <p className="text-white/50 mb-9 leading-relaxed text-sm">
                Más de 500 profesionales ya atienden en Healthier. Tu matrícula se verifica antes de publicar tu perfil.
              </p>
              <Link
                to="/registro?tipo=profesional"
                className="bg-white text-[#26331F] font-semibold px-8 py-3.5 rounded-full hover:bg-gray-100 transition-colors inline-flex items-center gap-2 text-sm"
              >
                Sumá tu práctica
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="rounded-3xl overflow-hidden border border-white/15">
              <div className="img-grain">
                <img
                  src="/images/landing/pro-doctor.jpg"
                  alt="Profesional de la salud en Healthier"
                  loading="lazy"
                  className="w-full h-56 object-cover object-top"
                />
              </div>
              <div className="bg-white/5 backdrop-blur-xl p-6 space-y-3.5 border-t border-white/10">
                {PRO_BENEFITS.map(b => (
                  <div key={b.text} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                      <b.icon className="h-4 w-4 text-[#C9E489]" />
                    </div>
                    <span className="text-sm text-white/85 flex-1">{b.text}</span>
                    <CheckCircle className="h-4 w-4 text-[#C9E489]/60 shrink-0" weight="fill" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-20 px-4 bg-bg-primary rounded-t-3xl">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-5">
            Empezá hoy · Es gratis
          </span>
          <h2 className="text-3xl sm:text-4xl font-light text-text-primary mb-4">
            Tu salud, cuando la necesitás
          </h2>
          <p className="text-text-secondary text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Registrate gratis y accedé a médicos verificados, historia clínica digital y herramientas de salud inteligentes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/registro" className="btn-accent text-base px-8 py-3.5 rounded-full inline-flex items-center justify-center gap-2">
              Crear cuenta gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn-secondary text-base px-8 py-3.5 rounded-full text-center">
              Ya tengo cuenta
            </Link>
          </div>
          <div className="flex flex-wrap gap-5 justify-center mt-10 text-sm text-text-secondary">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand" weight="fill" /> Matrícula verificada</span>
            <span className="flex items-center gap-1.5"><Star className="h-4 w-4 text-yellow-400" weight="fill" /> 4.9 de satisfacción</span>
            <span className="flex items-center gap-1.5"><Pill className="h-4 w-4 text-brand" /> Receta electrónica</span>
            <span className="flex items-center gap-1.5"><ChartLine className="h-4 w-4 text-brand" /> Biovisor</span>
            <span className="flex items-center gap-1.5"><Robot className="h-4 w-4 text-brand" /> Healthy IA</span>
          </div>
        </div>
      </section>

      <LandingFooter />

    </div>
  )
}
