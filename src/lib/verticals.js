import { Stethoscope, AppleLogo, Brain, Barbell, PawPrint, Pulse, Question, Tooth, Bone, Heartbeat, FirstAid, Eye, Siren } from '@phosphor-icons/react'
import Pacifier from '../components/icons/Pacifier'

// Especialidades (labels, mapeo a vertical, sub-especialidades) dejaron de
// vivir acá — migración 101 (`specialties`), editable desde
// /super-admin/verticales. Fuente: `useEspecialidades()` (src/hooks/useEspecialidades.js).
// Lo que sigue en este archivo es identidad visual + config que SÍ sigue siendo
// código (verticales del dashboard del paciente, categorías del onboarding).

// ── Identidad visual de las verticales ───────────────────────────────────────
// OJO: desde el 2026-07-31 esto NO decide qué vertical está habilitada. Eso vive
// en `vertical_settings` (migración 078) y se edita desde /super-admin/verticales,
// junto con el precio de la consulta inmediata. Para leer el estado real usá el
// hook `useVerticales()`, que mezcla esta identidad visual con la config de la
// base.
//
// El `comingSoon` de abajo quedó como **fallback** para el instante previo a que
// llegue el fetch (y para una caída de red): es el estado que era verdad hasta
// esa fecha. Si lo editás acá no cambia nada en producción — cambialo en el panel.
//
// Every field is a superset: id/nombre/icon/color/bg always; shadow+eta for
// Dashboard; price for the booking wizard; comingSoon gates interactivity.
// El campo `eta` ('3 min', '10 min', …) se eliminó el 2026-07-27: era un número
// inventado, sin ninguna medición detrás, y la ventana real del flujo on-demand
// es AUTH_WINDOW_SECONDS (10 min). OnDemand ahora deriva lo que muestra de esa
// constante. Si algún día se quiere mostrar una espera estimada de verdad, tiene
// que salir de datos reales, no de una constante escrita a mano.
export const VERTICALS = [
  { id: 'clinica',     img: '/images/landing/esp-medicina.jpg', nombre: 'Clínica',          icon: Stethoscope, color: '#b05a36', bg: '#fef9ef', shadow: 'rgba(176,90,54,0.15)'  },
  { id: 'pediatria',   img: '/images/landing/esp-pediatria.jpg', nombre: 'Pediatría',         icon: Pacifier,        color: '#DB2777', bg: '#FDF2F8', shadow: 'rgba(219,39,119,0.15)' },
  { id: 'nutricion',   img: '/images/landing/esp-nutricion.jpg', nombre: 'Nutrición',         icon: AppleLogo,   color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)', comingSoon: true },
  { id: 'mente',       img: '/images/landing/esp-psicologia.jpg', nombre: 'Psicología',        icon: Brain,       color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', comingSoon: true },
  { id: 'fisico',      img: '/images/landing/esp-entrenamiento.jpg', nombre: 'Kinesiología',      icon: Barbell,     color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  comingSoon: true },
  { id: 'veterinaria', nombre: 'Veterinaria',       icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  comingSoon: true },
  { id: 'preparador',  img: '/images/landing/esp-entrenamiento.jpg', nombre: 'Preparación física', icon: Pulse,       color: '#0F766E', bg: '#F0FDFA', shadow: 'rgba(15,118,110,0.15)', comingSoon: true },
]

// ── Verticales dinámicas (migración 199) ─────────────────────────────────────
// Desde el 2026-10-16 la identidad de una vertical (nombre, color de fondo,
// ícono, imagen) también vive en `vertical_settings` y se edita/crea desde
// /super-admin/verticales. La lista `VERTICALS` de arriba queda como fallback
// (instante previo al fetch, red caída) y como fuente del `color`/`bg` de marca
// que usan el mapa y las etiquetas para las siete de siempre.
//
// El ícono se guarda como CLAVE (no se puede serializar un componente). Mismas
// claves en mobile (`src/data/verticals.ts`). Una clave desconocida cae a
// Stethoscope.
export const ICONOS_VERTICAL = {
  stethoscope: { icon: Stethoscope, label: 'Estetoscopio' },
  baby:        { icon: Pacifier,    label: 'Pediatría' },
  apple:       { icon: AppleLogo,   label: 'Manzana' },
  brain:       { icon: Brain,       label: 'Mente' },
  bone:        { icon: Bone,        label: 'Hueso' },
  barbell:     { icon: Barbell,     label: 'Pesa' },
  paw:         { icon: PawPrint,    label: 'Huella' },
  pulse:       { icon: Pulse,       label: 'Pulso' },
  tooth:       { icon: Tooth,       label: 'Diente' },
  heartbeat:   { icon: Heartbeat,   label: 'Corazón' },
  firstaid:    { icon: FirstAid,    label: 'Botiquín' },
  eye:         { icon: Eye,         label: 'Ojo' },
  siren:       { icon: Siren,       label: 'Sirena' },
}
export const iconoDe = clave => ICONOS_VERTICAL[clave]?.icon ?? Stethoscope

// Presets del color de fondo (Felipe, 2026-10-16). Los cuatro primeros son los
// del carrusel aprobado en septiembre; los nuevos dan ≥ 3:1 contra blanco.
// `sugeridoPara` son raíces de nombre: al escribir "Odontología" se sugiere
// el celeste.
export const COLORES_PRESET = [
  { hex: '#7CB38B', nombre: 'Salvia',     sugeridoPara: ['clinica', 'medicina'] },
  { hex: '#D9699C', nombre: 'Rosa',       sugeridoPara: ['pediatr'] },
  { hex: '#E8927C', nombre: 'Coral',      sugeridoPara: ['nutric'] },
  { hex: '#9B8EC4', nombre: 'Lavanda',    sugeridoPara: ['psicolog', 'mente'] },
  { hex: '#5B95C9', nombre: 'Celeste',    sugeridoPara: ['odonto', 'dent'] },
  { hex: '#4F8A9B', nombre: 'Petróleo',   sugeridoPara: ['kinesio', 'fisio'] },
  { hex: '#A8803A', nombre: 'Ocre',       sugeridoPara: ['veterin'] },
  { hex: '#3F8A7C', nombre: 'Verde agua', sugeridoPara: ['prepara', 'entrena', 'deport'] },
  { hex: '#7E5A90', nombre: 'Ciruela',    sugeridoPara: ['psiquiat'] },
  { hex: '#B2633F', nombre: 'Terracota',  sugeridoPara: [] },
]

// Ícono sugerido por nombre, mismo criterio que el color.
const ICONO_SUGERIDO = [
  ['odonto', 'tooth'], ['dent', 'tooth'], ['pediatr', 'baby'], ['nutric', 'apple'],
  ['psicolog', 'brain'], ['psiquiat', 'brain'], ['kinesio', 'bone'], ['fisio', 'bone'],
  ['veterin', 'paw'], ['prepara', 'barbell'], ['entrena', 'barbell'], ['cardio', 'heartbeat'],
  ['oftalm', 'eye'], ['urgen', 'firstaid'], ['enfermer', 'firstaid'],
]

const normalizar = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Color preset sugerido para un nombre; si no hay match, el primero que no esté en uso. */
export function colorSugerido(nombre, enUso = []) {
  const n = normalizar(nombre)
  const match = n && COLORES_PRESET.find(p => p.sugeridoPara.some(r => n.includes(r)))
  if (match) return match.hex
  const usados = new Set(enUso.map(c => (c || '').toUpperCase()))
  return (COLORES_PRESET.find(p => !usados.has(p.hex.toUpperCase())) ?? COLORES_PRESET[0]).hex
}

export function iconoSugerido(nombre) {
  const n = normalizar(nombre)
  return ICONO_SUGERIDO.find(([r]) => n.includes(r))?.[1] ?? 'stethoscope'
}

/** Contraste WCAG de un hex contra blanco (texto blanco encima). */
export function contrasteConBlanco(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const canal = i => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4)
  return 1.05 / (L + 0.05)
}

/** El mismo tono, oscurecido hasta llegar a `objetivo`:1 contra blanco. */
export function oscurecerHasta(hex, objetivo = 3) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  for (let k = 0; k < 40 && (contrasteConBlanco(aHex(r, g, b)) ?? 99) < objetivo; k++) {
    r = Math.round(r * 0.95); g = Math.round(g * 0.95); b = Math.round(b * 0.95)
  }
  return aHex(r, g, b)
}
const aHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()

/** `rgba()` de un hex — para `bg`/`shadow` de una vertical que no está en VERTICALS. */
export function conAlfa(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return `rgba(124,179,139,${a})`
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
}

// Keyed lookup and guard helper used across surfaces
export const VERTICALS_BY_ID = Object.fromEntries(VERTICALS.map(v => [v.id, v]))
export const isComingSoon = id => !!VERTICALS_BY_ID[id]?.comingSoon

// ── Áreas del onboarding del profesional = las verticales (2026-10-16) ───────
// Pedido de Mateo: el primer paso del onboarding tiene que ofrecer las MISMAS
// verticales que ve el paciente, así una vertical creada desde el super admin
// (ej. Odontología) aparece sola para que el profesional la elija. Antes esto
// era `PROFESSION_CATEGORIES`, una lista escrita en código (Médico, Nutrición,
// Psicología, Entrenamiento, Veterinaria, Otra) que no sabía nada de las
// verticales: una odontóloga real terminó registrada como "Otra".
//
// Cada área lista las especialidades activas de primer nivel cuyo
// `vertical_id` es esa vertical (las médicas —cardiología, dermatología…—
// cuelgan de Clínica desde la 151). Se muestran todas las verticales que
// tengan al menos una especialidad, estén o no habilitadas para el paciente:
// el profesional se puede registrar antes de que la vertical salga.
// "Otra" (slug `otra`) queda aparte, al final, como salida.
//
// No cambia lo que se guarda: `form.specialty` sigue siendo el slug.
const OTRA = { id: 'otra', label: 'Otra', icon: Question, specialtyValues: ['otra'] }

export function categoriasDeOnboarding(verticales = [], especialidades = []) {
  const activas = especialidades
    .filter(e => e.active && !e.parentId && e.slug !== 'otra')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const areas = verticales
    .map(v => ({
      id: v.id,
      label: v.nombre,
      icon: v.icon,
      specialtyValues: activas.filter(e => e.verticalId === v.id).map(e => e.slug),
    }))
    .filter(a => a.specialtyValues.length > 0)
  return [...areas, OTRA]
}

// Specialty options for a given category id, en forma {value,label}. `porSlug`
// viene de `useEspecialidades()`; `categorias` de `categoriasDeOnboarding()`.
export function specialtiesForCategory(categoryId, porSlug = {}, categorias = []) {
  const category = categorias.find(c => c.id === categoryId)
  if (!category) return []
  return category.specialtyValues.map(value => ({ value, label: porSlug[value] ?? value }))
}

// Reverse lookup — which category a given specialty slug belongs to (used to
// preselect the category chip when resubmitting/editing an existing profile)
export function categoryForSpecialty(specialtyValue, categorias = []) {
  return categorias.find(c => c.specialtyValues.includes(specialtyValue))?.id ?? null
}

// A qué vertical pertenece una especialidad, según el catálogo (migración 101,
// columna `specialties.vertical_id`). `especialidades` viene de
// `useEspecialidades()`. Hace falta cuando la reserva arranca desde el perfil de
// un profesional en vez del wizard: ahí no hay selector de vertical, pero
// `consultations.vertical` se llena igual y es lo que agrupa la consulta.
export function verticalForSpecialty(specialty, especialidades = []) {
  return especialidades.find(e => e.slug === specialty)?.verticalId ?? null
}

// Returns the first pro in `pool` whose specialty matches any slug for the
// given verticalId. Prefers professionals who can actually receive paid
// bookings (mp_connected) — spec Sección D4 — falling back to any match so
// the map still shows a marker rather than nothing. `porVertical` viene de
// `useEspecialidades()` (verticalId → [slugs]); antes era el VERTICAL_SPECIALTIES
// hardcodeado.
export function pickProForVertical(pool, verticalId, porVertical = {}) {
  const slugs = porVertical[verticalId] || []
  const matches = pool.filter(p => slugs.includes(p.specialty))
  return matches.find(p => p.mpConnected !== false) || matches[0] || null
}
