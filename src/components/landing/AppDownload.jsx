// Sección "la app en el celular" + badges oficiales de las tiendas.
// La usan la Home (paciente) y /landing/profesionales (profesional).
// Capturas: reales de la app (store/covers-v2/shots y simulador), montadas en el
// mismo marco de iPhone que las fichas de las tiendas.

export const STORE_LINKS = {
  ios: 'https://apps.apple.com/ar/app/id6803196385',
  android: 'https://play.google.com/store/apps/details?id=ar.com.healthier.app',
}

// Badges oficiales, servidos por Apple y Google sin modificar el dibujo.
// TODO: pasarlos a public/images/badges/ (falta el OK directo de Mateo para bajarlos).
const BADGE_APPLE = 'https://toolbox.marketingtools.apple.com/api/v2/badges/download-on-the-app-store/black/es-mx'
const BADGE_GOOGLE = 'https://play.google.com/intl/en_us/badges/static/images/badges/es-419_badge_web_generic.png'

const img = (name) => `/images/landing/app/${name}.webp`

// Cada página usa dos secciones (A y B) con capturas distintas: ninguna imagen se repite.
const CONTENT = {
  paciente: {
    title: 'Healthier,\nen tu celular',
    sub: 'Consultas, recetas e historia clínica, siempre a mano.',
    front: { src: img('paciente-inicio'), alt: 'Inicio de la app de Healthier: hablá con un médico ahora' },
    back: [{ src: img('paciente-agenda'), alt: 'Agenda de consultas en la app' }],
  },
  'paciente-b': {
    title: 'Tu salud,\nen un solo lugar',
    sub: 'Emergencias, recetas y estudios, desde el celular.',
    front: { src: img('paciente-boveda'), alt: 'Bóveda con la historia clínica en la app' },
    back: [
      { src: img('paciente-emergencia'), alt: 'Pedido de ambulancia en la app' },
      { src: img('paciente-receta'), alt: 'Receta electrónica en la app' },
    ],
  },
  profesional: {
    title: 'Atendé\ndesde el celular',
    sub: 'Tu agenda, tus pacientes y las consultas on-demand, donde estés.',
    front: { src: img('profesional-agenda'), alt: 'Agenda del día en la app para profesionales' },
    back: [],
  },
  'profesional-b': {
    title: 'Tu consultorio,\nen el bolsillo',
    sub: 'Historial, ganancias y derivaciones, en la app.',
    front: { src: img('profesional-menu'), alt: 'Menú de la app para profesionales' },
    back: [],
  },
}

export function StoreBadges({ className = '', center = false }) {
  return (
    <div className={`flex items-center gap-5 ${center ? 'justify-center' : ''} ${className}`}>
      <a href={STORE_LINKS.ios} target="_blank" rel="noreferrer" aria-label="Descargar Healthier en el App Store" className="shrink-0">
        <img src={BADGE_APPLE} alt="Descargar en el App Store" className="h-12 w-auto" />
      </a>
      {/* El PNG de Google trae aire transparente alrededor: se compensa para que el
          dibujo quede a la misma altura que el de Apple (regla de las dos guías). */}
      <a href={STORE_LINKS.android} target="_blank" rel="noreferrer" aria-label="Descargar Healthier en Google Play" className="shrink-0 -my-[7.5px] -mx-[8px]">
        <img src={BADGE_GOOGLE} alt="Disponible en Google Play" className="h-[63px] w-auto" />
      </a>
    </div>
  )
}

function Phone({ src, alt, className = '' }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`w-full h-auto drop-shadow-[0_30px_60px_rgba(38,51,31,0.28)] select-none ${className}`}
    />
  )
}

function Title({ text, className }) {
  const [a, b] = text.split('\n')
  return (
    <h2 className={className}>
      {a}<br />{b}
    </h2>
  )
}

// A — panel claro, texto a la izquierda, teléfonos saliendo por abajo (Mercado Pago).
function LayoutPanel({ c }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#DCE9C8] grid lg:grid-cols-2 lg:h-[560px]">
      <div className="relative z-[2] px-7 pt-12 sm:px-12 lg:px-16 lg:py-0 flex flex-col justify-center">
        <Title text={c.title} className="text-4xl sm:text-5xl font-light text-[#26331F] leading-[1.08] tracking-tight mb-5" />
        <p className="text-[#26331F]/75 text-lg leading-[1.45] max-w-md mb-9">{c.sub}</p>
        <StoreBadges />
      </div>
      <div className="relative h-[340px] sm:h-[460px] lg:h-full mt-10 lg:mt-0">
        {c.back[0] && (
          <div className="hidden sm:block absolute left-1/2 top-16 lg:top-28 w-[230px] lg:w-[250px] -translate-x-[95%]">
            <Phone src={c.back[0].src} alt={c.back[0].alt} />
          </div>
        )}
        <div className={`absolute left-1/2 top-0 lg:top-14 w-[230px] sm:w-[260px] lg:w-[280px] -translate-x-1/2 ${c.back[0] ? 'sm:-translate-x-[15%]' : ''}`}>
          <Phone src={c.front.src} alt={c.front.alt} />
        </div>
      </div>
    </div>
  )
}

// B — panel oscuro centrado, abanico de teléfonos abajo (Ualá).
function LayoutDark({ c }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#26331F]">
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_25%,rgba(217,230,188,0.22)_55%,transparent_80%)]" />
      <div className="relative z-[2] px-7 pt-14 sm:pt-20 text-center">
        <Title text={c.title} className="text-4xl sm:text-5xl lg:text-6xl font-light text-white leading-[1.08] tracking-tight mb-5" />
        <p className="text-white/75 text-lg leading-[1.45] max-w-md mx-auto mb-9">{c.sub}</p>
        <StoreBadges center />
      </div>
      <div className="relative h-[360px] sm:h-[420px] lg:h-[440px] mt-12">
        {c.back[0] && (
          <div className="hidden sm:block absolute left-1/2 top-16 w-[230px] lg:w-[250px] -translate-x-[150%]">
            <Phone src={c.back[0].src} alt={c.back[0].alt} />
          </div>
        )}
        {c.back[1] && (
          <div className="hidden sm:block absolute left-1/2 top-16 w-[230px] lg:w-[250px] translate-x-[50%]">
            <Phone src={c.back[1].src} alt={c.back[1].alt} />
          </div>
        )}
        <div className="absolute left-1/2 top-0 w-[240px] sm:w-[260px] lg:w-[280px] -translate-x-1/2">
          <Phone src={c.front.src} alt={c.front.alt} />
        </div>
      </div>
    </div>
  )
}

// layout "a" = panel claro (LayoutPanel) · "b" = panel oscuro centrado (LayoutDark)
export function AppDownload({ variant = 'paciente', layout = 'a', id, className = '' }) {
  const c = CONTENT[variant]
  return (
    <section id={id} className={`py-16 sm:py-24 px-4 sm:px-6 bg-white rounded-t-3xl ${className}`}>
      <div className="max-w-6xl mx-auto">
        {layout === 'b' ? <LayoutDark c={c} /> : <LayoutPanel c={c} />}
      </div>
    </section>
  )
}
