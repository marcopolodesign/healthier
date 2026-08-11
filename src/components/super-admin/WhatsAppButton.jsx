import { useState } from 'react'
import WhatsAppMark from '../icons/WhatsAppMark'

/**
 * Ícono de WhatsApp para las tablas del super admin — hover muestra el
 * teléfono, click abre la conversación. Mismo criterio de saneo de número que
 * `ProfessionalModal.jsx` (patient-facing): sólo dígitos, sin agregar
 * prefijo de país — el admin ve el número crudo en el tooltip para poder
 * corregirlo a mano si wa.me no lo interpreta bien.
 */
export default function WhatsAppButton({ phone }) {
  const [hover, setHover] = useState(false)
  if (!phone) return null

  const num = phone.replace(/\D/g, '')

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          window.open(`https://wa.me/${num}`, '_blank', 'noopener')
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="p-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
        title={phone}
      >
        <WhatsAppMark className="w-4 h-4" />
      </button>
      {hover && (
        <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap px-2 py-1 rounded-lg bg-text-primary text-white text-xs shadow-lg">
          {phone}
        </div>
      )}
    </div>
  )
}
