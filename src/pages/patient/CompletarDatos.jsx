import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IdentificationCard, CircleNotch, ArrowRight } from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import { faltanDatosPaciente, OPCIONES_SEXO } from '../../lib/datosReceta'
import { toast } from '../../components/Toast'
import { track } from '../../utils/analytics'

const DESTINO_POR_DEFECTO = '/paciente/dashboard'

/**
 * Los datos que faltan para poder recetar, pedidos justo antes de reservar.
 *
 * Sólo pregunta lo que falta: quien ya cargó el DNI en el onboarding no lo
 * vuelve a escribir. La lista sale de `lib/datosReceta`, que es la misma que usa
 * el profesional del otro lado — si algún día la API pide un campo más, se
 * agrega en un solo lugar y las dos pantallas lo piden.
 *
 * `?volverA=` guarda a dónde iba el paciente para devolverlo ahí y que no pierda
 * el profesional o la vertical que venía eligiendo.
 */
export default function CompletarDatos({ profile, onProfileUpdate }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [saving, setSaving] = useState(false)

  const volverA = params.get('volverA') || DESTINO_POR_DEFECTO
  // Se congela al montar: si se recalculara en cada render, los campos irían
  // desapareciendo del formulario a medida que el paciente los completa.
  const [faltan] = useState(() => faltanDatosPaciente(profile))

  const [form, setForm] = useState({
    dni:       profile?.dni       || '',
    gender:    profile?.gender    || '',
    birthDate: profile?.birthDate || '',
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const pide = campo => faltan.some(c => c.campo === campo)

  const submit = async e => {
    e.preventDefault()

    if (pide('dni') && form.dni.trim().length < 7) {
      toast.error('Ingresá tu DNI sin puntos (mínimo 7 dígitos).')
      return
    }
    if (pide('gender') && !form.gender) {
      toast.error('Elegí una opción de sexo.')
      return
    }
    if (pide('birthDate') && !form.birthDate) {
      toast.error('Ingresá tu fecha de nacimiento.')
      return
    }

    setSaving(true)
    try {
      // Sólo lo que se pidió acá. Mandar los campos que ya estaban cargados
      // sería reescribirlos con lo que quedó en el form.
      const updates = {}
      if (pide('dni'))       updates.dni        = form.dni.trim()
      if (pide('gender'))    updates.gender     = form.gender
      if (pide('birthDate')) updates.birth_date = form.birthDate

      const actualizado = await profilesService.update(profile.id, updates)
      // Sin esto App.jsx sigue con el perfil viejo en memoria y el guard vuelve
      // a mandar acá al paciente que acaba de completar los datos.
      onProfileUpdate?.(actualizado)
      track('datos_receta_completados', { campos: faltan.map(c => c.campo).join(','), flow: 'paciente' })
      navigate(volverA, { replace: true })
    } catch (err) {
      toast.error(err.message || 'No pudimos guardar tus datos')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute inset-0 overflow-y-auto pb-32">
      <div className="px-5 pt-8 sm:pt-10 max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-brand-muted flex items-center justify-center mb-5">
          <IdentificationCard className="h-6 w-6 text-brand" />
        </div>

        <h1 className="text-3xl font-light tracking-tight text-text-primary">
          Antes de reservar, unos datos
        </h1>
        <p className="text-text-secondary text-sm mt-2 leading-relaxed">
          Son los que exige la receta electrónica. Cargándolos ahora, tu profesional te
          puede recetar durante la consulta sin tener que frenar a pedírtelos.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {pide('dni') && (
            <div>
              <label className="form-label" htmlFor="dni">DNI</label>
              <input
                id="dni"
                className="form-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Sin puntos, ej: 30123456"
                value={form.dni}
                onChange={e => set('dni', e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}

          {pide('gender') && (
            <div>
              <label className="form-label" htmlFor="gender">Sexo</label>
              <select
                id="gender"
                className="form-select"
                value={form.gender}
                onChange={e => set('gender', e.target.value)}
              >
                <option value="">Elegí una opción…</option>
                {OPCIONES_SEXO.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-text-tertiary mt-1.5">
                Es el dato que figura en tu documento — la receta lo necesita tal cual.
              </p>
            </div>
          )}

          {pide('birthDate') && (
            <div>
              <label className="form-label" htmlFor="birthDate">Fecha de nacimiento</label>
              <input
                id="birthDate"
                type="date"
                className="form-input"
                value={form.birthDate}
                onChange={e => set('birthDate', e.target.value)}
              />
            </div>
          )}

          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving
              ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
              : <>Continuar <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        <p className="text-xs text-text-tertiary mt-6 leading-relaxed">
          Sólo se usan para emitir tus recetas y quedan en tu perfil. Podés
          cambiarlos cuando quieras desde Perfil.
        </p>
      </div>
    </div>
  )
}
