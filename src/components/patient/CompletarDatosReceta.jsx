import { useState } from 'react'
import { IdentificationCard, CircleNotch } from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import { faltanDatosPaciente, listar, OPCIONES_SEXO } from '../../lib/datosReceta'
import { toast } from '../Toast'
import { track } from '../../utils/analytics'

/**
 * Los datos que la receta electrónica exige, pedidos al paciente en el momento
 * en que hacen falta.
 *
 * Se piden ANTES de reservar y no al registrarse a propósito: en el alta son
 * tres campos más que sólo suben el abandono, y la mayoría de la gente que se
 * registra todavía no sabe si va a sacar turno. Acá ya decidió, así que el
 * costo de completarlos se paga contra algo que quiere.
 *
 * El profesional también los puede cargar desde la consulta
 * (`DatosRecetaFaltantes`), pero eso es el plan B — para cuando esto no pasó.
 * Las dos pantallas comparten la definición de qué falta (`lib/datosReceta.js`)
 * para que no existan dos ideas distintas de "datos completos".
 */
const CAMPO_INPUT = {
  dni:       { label: 'DNI',                 type: 'text', placeholder: 'Sin puntos, ej: 30123456', inputMode: 'numeric' },
  gender:    { label: 'Sexo',                type: 'select' },
  birthDate: { label: 'Fecha de nacimiento', type: 'date' },
}

export default function CompletarDatosReceta({ profile, faltan, onListo, onCancelar }) {
  const [form, setForm] = useState({ dni: '', gender: '', birthDate: '' })
  const [guardando, setGuardando] = useState(false)

  const set = (campo, valor) => setForm(f => ({ ...f, [campo]: valor }))

  const incompletos = faltan.filter(c => String(form[c.campo] ?? '').trim() === '')

  const guardar = async () => {
    if (incompletos.length) {
      toast.error(`Falta ${listar(incompletos)}`)
      return
    }
    setGuardando(true)
    try {
      const updates = {}
      faltan.forEach(c => {
        const v = String(form[c.campo]).trim()
        updates[c.campo === 'birthDate' ? 'birth_date' : c.campo] = v
      })
      const actualizado = await profilesService.update(profile.id, updates)
      track('patient_rcta_data_completed', { campos: faltan.map(c => c.campo).join(',') })
      onListo(actualizado)
    } catch (err) {
      // El mensaje real, no uno genérico: si la base rechaza el DNI por
      // duplicado o formato, el paciente tiene que poder entenderlo.
      toast.error(err.message || 'No pudimos guardar tus datos')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-brand-muted flex items-center justify-center shrink-0">
          <IdentificationCard className="h-6 w-6 text-brand" />
        </div>
        <div>
          <h1 className="font-serif font-bold text-2xl text-text-primary leading-tight">
            Antes de reservar, completá tus datos
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {listar(faltan)} {faltan.length === 1 ? 'es obligatorio' : 'son obligatorios'} para
            que tu profesional pueda emitirte una receta electrónica. Se te piden una sola vez.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {faltan.map(c => {
          const cfg = CAMPO_INPUT[c.campo]
          if (!cfg) return null
          return (
            <div key={c.campo}>
              <label className="form-label" htmlFor={`campo-${c.campo}`}>{cfg.label}</label>
              {cfg.type === 'select' ? (
                <select
                  id={`campo-${c.campo}`}
                  className="form-select"
                  value={form[c.campo]}
                  onChange={e => set(c.campo, e.target.value)}
                >
                  <option value="">Elegí una opción</option>
                  {OPCIONES_SEXO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id={`campo-${c.campo}`}
                  type={cfg.type}
                  inputMode={cfg.inputMode}
                  placeholder={cfg.placeholder}
                  className="form-input"
                  value={form[c.campo]}
                  onChange={e => set(c.campo, e.target.value)}
                />
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={guardar}
        disabled={guardando || incompletos.length > 0}
        className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {guardando
          ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
          : 'Guardar y seguir'}
      </button>

      {onCancelar && (
        <button type="button" onClick={onCancelar} className="w-full text-sm text-text-tertiary py-2">
          Volver
        </button>
      )}
    </>
  )
}

/** Re-export para que quien monta el paso no tenga que importar dos módulos. */
export { faltanDatosPaciente }
