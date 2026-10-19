import { X, Check, Circle } from '@phosphor-icons/react'
import { toCamelCase } from '../../lib/supabase'
import { completitudPaciente, PASOS_PACIENTE } from '../../lib/pacienteOnboarding'
import WhatsAppButton from './WhatsAppButton'

/**
 * Detalle del onboarding de un paciente para el super admin (2026-10-18):
 * paso por paso, qué cargó y qué le falta, hasta dónde llegó en el wizard y
 * cuándo lo terminó.
 *
 * Privacidad: DNI y cobertura se muestran (hacen falta para soporte: "no me
 * deja recetar"); los datos de salud y el contacto de emergencia sólo como
 * Cargado / Pendiente, nunca el valor (recomendación de Felipe, a confirmar
 * con Mateo).
 */

const fecha = ts => (ts
  ? new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  : '—')

const fechaNac = iso => {
  if (!iso) return null
  const [y, m, d] = String(iso).split('-')
  return `${d}/${m}/${y}`
}

function detalleDelPaso(key, p) {
  switch (key) {
    case 'consentimiento':
      return p.consentimientoAt ? `Aceptó el ${fecha(p.consentimientoAt)} (versión ${p.consentimientoVersion ?? '—'})` : null
    case 'datos':
      return [p.dni && `DNI ${p.dni}`, p.gender && `sexo ${p.gender === 'no_binario' ? 'X' : p.gender}`, fechaNac(p.birthDate) && `nació el ${fechaNac(p.birthDate)}`]
        .filter(Boolean).join(' · ') || null
    case 'cobertura':
      if (p.coverageType === 'particular') return 'Particular'
      if (p.coverageType === 'financiador') return [p.insuranceName || 'Obra social sin elegir del listado', p.insuranceNum && `afiliado ${p.insuranceNum}`].filter(Boolean).join(' · ')
      return null
    default:
      return null
  }
}

export default function PacienteOnboardingDrawer({ paciente, onClose }) {
  const p = toCamelCase(paciente)
  const c = completitudPaciente(p)
  const llego = p.pacientePasoOnboarding

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{p.fullName || '(Sin nombre)'}</p>
            <p className="text-sm text-gray-500 truncate">{p.email}</p>
            <p className="text-sm text-gray-500 mt-1">
              {c.obligatoriosCompletos ? 'Perfil completo' : `Le faltan ${c.faltan.length} dato${c.faltan.length === 1 ? '' : 's'} obligatorio${c.faltan.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Teléfono</p>
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-gray-800">{p.phone || '—'}</p>
                <WhatsAppButton phone={p.phone} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Registro</p>
              <p className="font-medium text-gray-800">{fecha(p.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Llegó hasta</p>
              <p className="font-medium text-gray-800">
                {llego == null ? 'No abrió el wizard nuevo' : PASOS_PACIENTE[llego]?.corto ?? `Paso ${llego + 1}`}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Terminó el wizard</p>
              <p className="font-medium text-gray-800">{fecha(p.onboardingCompletadoAt)}</p>
            </div>
          </div>

          {p.titularId && (
            <p className="text-sm text-gray-600 rounded-xl bg-gray-50 px-4 py-3">
              Familiar a cargo: lo completa el titular desde su ficha, no recibe el wizard.
            </p>
          )}

          <ol className="space-y-3">
            {c.pasos.map((s, i) => {
              const det = detalleDelPaso(s.key, p)
              return (
                <li key={s.key} className="flex items-start gap-3">
                  <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${s.done ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {s.done ? <Check className="h-3.5 w-3.5" weight="bold" /> : <Circle className="h-2 w-2" weight="fill" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {i + 1}. {s.corto}
                      {!s.obligatorio && <span className="ml-1.5 text-gray-400 font-normal">opcional</span>}
                    </p>
                    <p className="text-sm text-gray-500">
                      {det ?? (s.done ? 'Cargado' : s.faltan.length ? s.faltan.join(' · ') : 'Pendiente')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
