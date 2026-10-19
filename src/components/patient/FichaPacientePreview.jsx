import { LockKey, UserCheck, Trash } from '@phosphor-icons/react'
import { OPCIONES_SEXO } from '../../lib/datosReceta'

/**
 * Panel derecho del onboarding del paciente: su ficha llenándose en vivo
 * (pedido de Felipe, 2026-10-18 — superficie marfil como OnboardingPreview,
 * nada de "carnet de obra social"). El grupo de datos del paso que se está
 * editando se resalta con fondo sage suave, sin borde.
 *
 * En el paso de consentimiento la ficha todavía está vacía, así que en vez de
 * campos en blanco se cuenta quién ve los datos.
 */

const fechaAR = iso => {
  if (!iso) return null
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : null
}

const sexo = g => (g === 'no_binario' ? 'X' : OPCIONES_SEXO.find(o => o.value === g)?.label ?? (g === 'prefiero_no_decir' ? 'Prefiero no decir' : null))

function Dato({ label, valor }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className={`text-base mt-0.5 ${valor ? 'text-text-primary' : 'text-text-tertiary'}`}>{valor || '—'}</p>
    </div>
  )
}

function Grupo({ activo, children }) {
  return (
    <div className={`grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl p-4 -mx-4 transition-colors ${activo ? 'bg-brand/10' : ''}`}>
      {children}
    </div>
  )
}

const PRIVACIDAD = [
  { Icon: UserCheck, texto: 'Tus datos los ven sólo los profesionales que te atienden.' },
  { Icon: LockKey,   texto: 'Se guardan cifrados, en servidores en São Paulo.' },
  { Icon: Trash,     texto: 'Podés pedir verlos, corregirlos o borrarlos cuando quieras.' },
]

export default function FichaPacientePreview({ paciente: p, pasoActivo, compacta = false }) {
  const cobertura = p?.coverageType === 'particular'
    ? 'Particular'
    : p?.coverageType === 'financiador' ? (p?.insuranceName || 'Obra social sin elegir') : null

  return (
    <div className={`flex flex-col w-full bg-bg-surface rounded-[1.5rem] border border-border-default ${compacta ? 'p-6' : 'p-8 h-full overflow-y-auto'}`}>
      <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">Tu ficha</p>
      <h3 className="font-serif font-light text-2xl text-text-primary mb-6">{p?.fullName || 'Tu nombre'}</h3>

      {pasoActivo === 'consentimiento' ? (
        <ul className="space-y-5">
          {PRIVACIDAD.map(({ Icon, texto }) => (
            <li key={texto} className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-brand-muted text-brand flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-base text-text-secondary pt-1.5">{texto}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          <Grupo activo={pasoActivo === 'datos'}>
            <Dato label="DNI" valor={p?.dni} />
            <Dato label="Sexo" valor={sexo(p?.gender)} />
            <Dato label="Nacimiento" valor={fechaAR(p?.birthDate)} />
          </Grupo>
          <Grupo activo={pasoActivo === 'cobertura'}>
            <Dato label="Cobertura" valor={cobertura} />
            <Dato label="Afiliado" valor={p?.coverageType === 'financiador' ? p?.insuranceNum : null} />
          </Grupo>
          <Grupo activo={pasoActivo === 'salud'}>
            <Dato label="Altura" valor={p?.heightCm ? `${p.heightCm} cm` : null} />
            <Dato label="Peso" valor={p?.weightKg ? `${p.weightKg} kg` : null} />
            <Dato label="Grupo sanguíneo" valor={p?.bloodType === 'desconocido' ? 'No sé' : p?.bloodType} />
            <Dato label="Alergias" valor={p?.allergies} />
          </Grupo>
          <Grupo activo={pasoActivo === 'emergencia'}>
            <Dato label="Contacto de emergencia" valor={p?.emergencyName} />
            <Dato label="Teléfono" valor={p?.emergencyPhone} />
          </Grupo>
        </div>
      )}
    </div>
  )
}
