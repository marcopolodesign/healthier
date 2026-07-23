import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ShieldCheck, Star, Calendar, Lightning, ClipboardText,
  CurrencyDollar, Users, DeviceMobile, Pill, Lock, FileText,
  ChartLineUp, CheckCircle, Scales,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../../components/common/CompanyLogo'
import { LandingFooter } from '../../components/landing/LandingFooter'
import { AnimatedHeadline } from '../../components/landing/AnimatedHeadline'
import { captureUtms } from '../../lib/utms'

const FEATURES = [
  {
    icon: Calendar,
    title: 'Agenda integrada y configurable',
    desc: 'Definí tus horarios de atención, modalidades y duración de consulta. Tus pacientes reservan directo, sin idas y vueltas por WhatsApp.',
    img: '/images/landing/pro-agenda.jpg',
  },
  {
    icon: Lightning,
    title: 'Consultas on-demand e inmediatas',
    desc: 'Sumate a la guardia online y atendé consultas urgentes apenas entran. Cada consulta atendida construye tu reputación y tu base de pacientes.',
    img: '/images/landing/pro-ondemand.jpg',
  },
  {
    icon: ClipboardText,
    title: 'Historia clínica digital compartida',
    desc: 'Accedé al historial completo del paciente antes de atenderlo: antecedentes, medicación, alergias y consultas previas. Sin repetir preguntas.',
    img: '/images/landing/pro-historia-clinica.jpg',
  },
  {
    icon: Pill,
    title: 'Receta electrónica',
    desc: 'Emitís la receta al cierre de la consulta y llega al instante al paciente, válida en todo el país. Sin papel, sin demoras.',
    img: '/images/landing/pro-receta.jpg',
  },
]

const TRUST = [
  { icon: ShieldCheck, title: 'Matrícula verificada', desc: 'Validamos tu matrícula, título y antecedentes antes de publicar tu perfil.' },
  { icon: FileText,    title: 'Historia clínica según Ley 26.529', desc: 'Registro clínico digital conforme a la normativa de derechos del paciente.' },
  { icon: Lock,        title: 'Datos protegidos — Ley 25.326', desc: 'La información de tus pacientes se almacena y procesa de forma segura.' },
  { icon: CurrencyDollar, title: 'Cobrás al instante vía MercadoPago', desc: 'Tus honorarios se acreditan apenas termina la consulta — no esperás días ni gestionás pagos manualmente.' },
]

const STATS = [
  { value: '500+', label: 'Profesionales activos' },
  { value: '4.9', label: 'Satisfacción promedio' },
  { value: '24/7', label: 'Consultas on-demand' },
]

export default function LandingProfesionales() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-white">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-[#26331F]/95 backdrop-blur border-b border-white/10 rounded-b-3xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><CompanyLogo size="sm" inverted /></Link>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden sm:block text-sm text-white/70 hover:text-white transition-colors">
              Ya soy profesional
            </Link>
            <Link to="/registro-profesional" className="bg-white text-[#26331F] font-semibold rounded-full px-5 py-2 text-sm hover:bg-gray-100 transition-colors">
              Sumá tu práctica
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — full-bleed photo background, animated headline, dark overlay for legibility */}
      <section className="relative overflow-hidden bg-[#26331F] pt-40 pb-28 px-4 sm:px-6 rounded-t-3xl">
        <img
          src="/images/landing/pro-hero-remote.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover img-grain"
        />
        <div className="absolute inset-0 bg-[#182116]/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgba(24,33,22,0.75)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,rgba(217,230,188,0.18)_50%,transparent_75%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <span className="text-sm text-[#C9E489] uppercase tracking-widest mb-6 block">Para profesionales de la salud</span>
          <AnimatedHeadline
            text="Trabajá de donde quieras, cuando quieras"
            className="text-4xl sm:text-6xl lg:text-7xl font-light text-white leading-[1.05] mb-6 drop-shadow-md"
          />
          <p className="text-white/80 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Agenda, historia clínica, recetas y cobros al instante en una sola plataforma. Tu matrícula se verifica antes de publicar tu perfil.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mb-14">
            <Link to="/registro-profesional" className="bg-white text-[#26331F] font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-gray-100 transition-colors inline-flex items-center gap-2">
              Sumá tu práctica <ArrowRight size={15} weight="bold" />
            </Link>
            <a href="#funcionalidades" className="bg-white/10 backdrop-blur-md border border-white/25 text-white font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-white/20 transition-colors">
              Ver cómo funciona
            </a>
          </div>
          <div className="flex flex-wrap gap-8 justify-center">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-light text-[#C9E489]">{s.value}</p>
                <p className="text-xs text-white/60 uppercase tracking-wide mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature sections — alternating image/text, Tandem product-page style */}
      <section id="funcionalidades" className="py-24 px-4 sm:px-6 bg-white rounded-t-3xl">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-20">
            <span className="text-xs font-semibold tracking-widest text-brand uppercase mb-4 block">Funcionalidades</span>
            <h2 className="text-3xl sm:text-4xl font-light text-text-primary leading-tight">
              Todo lo que necesitás para atender, en un solo lugar
            </h2>
          </div>

          <div className="space-y-24">
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${i % 2 === 1 ? 'lg:[direction:rtl]' : ''}`}>
                <div className={i % 2 === 1 ? 'lg:[direction:ltr]' : ''}>
                  <div className="w-12 h-12 rounded-2xl bg-brand-muted flex items-center justify-center mb-5">
                    <f.icon className="h-6 w-6 text-brand" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-light text-text-primary mb-4 leading-snug">{f.title}</h3>
                  <p className="text-text-secondary leading-relaxed text-lg">{f.desc}</p>
                </div>
                <div className={`rounded-3xl overflow-hidden border border-black/5 img-grain ${i % 2 === 1 ? 'lg:[direction:ltr]' : ''}`}>
                  <img src={f.img} alt={f.title} loading="lazy" className="w-full h-72 object-cover" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & compliance */}
      <section className="py-24 px-4 sm:px-6 bg-bg-primary rounded-t-3xl">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs font-semibold tracking-widest text-brand uppercase mb-4 block">Confianza y cumplimiento</span>
            <h2 className="text-3xl sm:text-4xl font-light text-text-primary leading-tight">
              Diseñado para la práctica clínica real
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {TRUST.map(t => (
              <div key={t.title} className="bg-white rounded-2xl border border-border-default p-6">
                <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center mb-4">
                  <t.icon className="h-5 w-5 text-brand" />
                </div>
                <h3 className="font-semibold text-text-primary mb-2">{t.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="py-24 px-4 sm:px-6 bg-white rounded-t-3xl">
        <div className="max-w-4xl mx-auto">
          <div className="bg-[#5F7A6D] rounded-3xl p-10 sm:p-14 text-white">
            <div className="flex gap-0.5 mb-6">
              {[...Array(5)].map((_, i) => (
                <Star key={i} weight="fill" className="h-4 w-4 text-[#C9E489]" />
              ))}
            </div>
            <blockquote className="text-xl sm:text-2xl font-light leading-relaxed mb-8">
              "Empecé atendiendo un par de consultas on-demand y hoy tengo agenda llena todas las semanas. La historia clínica compartida me ahorra media consulta de preguntas que ya sé."
            </blockquote>
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-xl overflow-hidden img-grain shrink-0">
                <img src="/images/landing/pro-testimonial.jpg" alt="Dr. Martín Suárez" loading="lazy" className="w-full h-full object-cover object-top" />
              </span>
              <div>
                <p className="font-semibold text-sm">Dr. Martín Suárez</p>
                <p className="text-white/60 text-xs">Medicina General · Healthier</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Growth callout — reuses PRO_BENEFITS icon language from main landing */}
      <section className="py-20 px-4 sm:px-6 bg-bg-primary rounded-t-3xl">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white border border-border-default rounded-full px-5 py-2 text-sm text-text-secondary mb-8">
            <ChartLineUp className="h-4 w-4 text-brand" />
            Crecé tu base de pacientes mes a mes
          </div>
          <div className="grid sm:grid-cols-3 gap-6 text-left">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-brand shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">Más visibilidad: aparecés en las búsquedas por especialidad y disponibilidad inmediata.</p>
            </div>
            <div className="flex items-start gap-3">
              <DeviceMobile className="h-5 w-5 text-brand shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">Atendé desde el celular o la computadora, en consultorio o de guardia.</p>
            </div>
            <div className="flex items-start gap-3">
              <Scales className="h-5 w-5 text-brand shrink-0 mt-0.5" />
              <p className="text-sm text-text-secondary">Vos definís tus tarifas y tu disponibilidad — sin exclusividad.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden py-24 px-4 sm:px-6 bg-[#26331F] rounded-t-3xl">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.32)_55%,transparent_80%)]" />
        <div className="relative max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-light text-white mb-5 leading-tight">
            Empezá a atender en <span className="text-[#C9E489]">Healthier</span> hoy
          </h2>
          <p className="text-white/70 mb-10 max-w-xl mx-auto leading-relaxed">
            El alta es gratuita. Validamos tu matrícula y publicamos tu perfil en menos de 48&nbsp;hs.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/registro-profesional" className="bg-white text-[#26331F] font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-gray-100 transition-colors inline-flex items-center gap-2">
              Sumá tu práctica <ArrowRight size={15} weight="bold" />
            </Link>
            <Link to="/login" className="border border-white/30 text-white font-semibold rounded-full px-8 py-3.5 text-sm hover:bg-white/10 transition-colors">
              Ya tengo cuenta
            </Link>
          </div>
          <div className="flex items-center justify-center gap-2 mt-8 text-white/50 text-xs">
            <CheckCircle className="h-4 w-4 text-[#C9E489]" weight="fill" />
            Sin costos de alta · Sin exclusividad
          </div>
        </div>
      </section>

      <LandingFooter />

    </div>
  )
}
