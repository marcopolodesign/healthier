import { ArrowSquareOut } from '@phosphor-icons/react'
import { toast } from '../Toast'

const REFEPS_URL = 'https://www.argentina.gob.ar/salud/buscador-nacional-de-profesionales-de-la-salud'

async function copyValue(value, label) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    toast.success('Copiado')
  } catch {
    toast.error(`No se pudo copiar ${label}`)
  }
}

// Manual-check companion for the national health professionals registry (REFEPS).
// The buscador is a Drupal POST form with CSRF protection — it cannot be pre-filled
// via URL, so we give the reviewer copy-to-clipboard chips to paste name/DNI there.
export default function RefepsCheckLink({ fullName, dni }) {
  return (
    <div className="space-y-2">
      <a
        href={REFEPS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        Verificar en el Buscador Nacional de Profesionales (REFEPS)
        <ArrowSquareOut className="h-3.5 w-3.5 shrink-0" />
      </a>
      <div className="flex flex-wrap gap-2">
        {fullName && (
          <button
            type="button"
            onClick={() => copyValue(fullName, 'el nombre')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Copiar nombre
          </button>
        )}
        {dni && (
          <button
            type="button"
            onClick={() => copyValue(dni, 'el DNI')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Copiar DNI
          </button>
        )}
      </div>
    </div>
  )
}
