/**
 * Tooltip de ayuda — explica un dato que el profesional ve pero no
 * necesariamente sabe leer (un código CIE-10, una sigla, un estado).
 *
 * Se abre en hover y también en foco de teclado: el profesional puede estar
 * navegando con Tab durante una consulta y el hover no le sirve.
 *
 * `align` decide de qué lado se ancla la burbuja — los chips de la
 * pre-consulta van pegados al borde derecho de la tarjeta, así que anclarla a
 * la izquierda la dejaría cortada fuera de pantalla.
 */
export default function InfoTooltip({ label, title, align = 'right', className = '', children }) {
  const anchor = align === 'left' ? 'left-0' : 'right-0'

  return (
    <span className={`group relative inline-flex ${className}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${anchor} top-full z-40 mt-1.5 w-64 rounded-lg bg-text-primary px-3 py-2 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100`}
      >
        {title && <span className="mb-0.5 block font-semibold">{title}</span>}
        {label}
      </span>
    </span>
  )
}
