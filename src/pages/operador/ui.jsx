import { CircleNotch } from '@phosphor-icons/react'

/**
 * Piezas de la pantalla del operador (estilo Picnic, columna del medio de
 * docs/design/operador-medizin-2026-11-19): una columna, fondo ivory, títulos
 * grandes, tarjetas blancas SIN bordes ni sombras, un botón de ancho completo
 * abajo. Botones de 56px o más (pantalla de la calle).
 */
export function Pantalla({ children, pie }) {
  return (
    <div className="min-h-dvh bg-bg-primary flex flex-col">
      <div className="flex-1 w-full max-w-md mx-auto px-5 pt-8 pb-6 flex flex-col gap-6">{children}</div>
      {pie && <div className="w-full max-w-md mx-auto px-5 pb-8 flex flex-col gap-3">{pie}</div>}
    </div>
  )
}

const PUNTO = { ROJO: 'bg-danger', AMARILLO: 'bg-amber-500', VERDE: 'bg-brand' }
const COLOR_TEXTO = { ROJO: 'text-danger', AMARILLO: 'text-amber-600', VERDE: 'text-brand-hover' }

/** "● ROJO · UTM-7250 ............ EN CAMINO" */
export function Eyebrow({ codigo, despacho, estado }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-xs tracking-widest uppercase">
      <span className={`flex items-center gap-2 ${COLOR_TEXTO[codigo] ?? 'text-text-secondary'}`}>
        {codigo && <span className={`w-2 h-2 rounded-full ${PUNTO[codigo] ?? 'bg-text-secondary'}`} />}
        {[codigo, despacho].filter(Boolean).join(' · ')}
      </span>
      {estado && <span className="text-text-secondary">{estado}</span>}
    </div>
  )
}

export function Titulo({ children, sub }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-4xl leading-tight text-text-primary break-words">{children}</h1>
      {sub && <p className="text-base text-text-secondary leading-relaxed">{sub}</p>}
    </div>
  )
}

/** Pantalla de un solo mensaje: ícono arriba, título, una línea y algo extra. */
export function Centrado({ icono, children, sub, extra }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-5">
      {icono}
      <Titulo sub={sub}>{children}</Titulo>
      {extra}
    </div>
  )
}

export function Seccion({ titulo, children }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-xs tracking-widest uppercase text-text-secondary font-normal">{titulo}</h2>
      {children}
    </section>
  )
}

export function Tarjeta({ children, className = '' }) {
  return <div className={`bg-white rounded-3xl p-5 ${className}`}>{children}</div>
}

const COLORES = {
  oscuro: 'bg-midnight text-white',
  rojo: 'bg-danger text-white',
  claro: 'bg-white text-text-primary',
}

/** Botón de ancho completo, 56px o más. */
export function Boton({ children, onClick, color = 'oscuro', cargando = false, disabled = false, icono, testid, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={cargando || disabled}
      data-testid={testid}
      className={`w-full min-h-14 py-4 rounded-full text-lg font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 ${COLORES[color]}`}
    >
      {cargando ? <CircleNotch className="w-6 h-6 animate-spin" /> : <>{icono}{children}</>}
    </button>
  )
}

export function Campo({ id, etiqueta, ayuda, ...props }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-base font-semibold text-text-primary">{etiqueta}</label>
      <input id={id} className="w-full min-h-14 rounded-2xl bg-white px-5 text-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand" {...props} />
      {ayuda && <p className="text-sm text-text-secondary">{ayuda}</p>}
    </div>
  )
}

export function Cargando() {
  return (
    <div className="min-h-dvh bg-bg-primary flex items-center justify-center">
      <CircleNotch className="w-8 h-8 text-brand animate-spin" />
    </div>
  )
}

export function Aviso({ children, testid }) {
  return <p role="alert" data-testid={testid} className="rounded-2xl bg-danger-muted text-danger px-4 py-3 text-base">{children}</p>
}
