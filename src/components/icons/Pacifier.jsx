// Chupete para la vertical Pediatría (Mateo, 2026-08-03). Ni Phosphor ni
// Lucide tienen un pacifier, así que es un SVG propio calcado al estilo de
// trazo de Phosphor regular (stroke redondeado sobre currentColor) para que
// conviva con el resto de los íconos. Firma compatible: acepta className y
// descarta props de Phosphor como `weight`.
export default function Pacifier({ className, weight: _weight, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* escudo */}
      <ellipse cx="12" cy="9.5" rx="8" ry="4.8" />
      {/* tetina (botón central) */}
      <circle cx="12" cy="9.5" r="2" />
      {/* aro */}
      <path d="M8.2 15.4a3.9 3.9 0 0 0 7.6 0" />
    </svg>
  )
}
