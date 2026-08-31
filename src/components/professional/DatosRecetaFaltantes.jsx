import { useState } from 'react'
import { Warning, CircleNotch, Check, PencilSimple } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { profilesService } from '../../services/profilesService'
import {
  faltanDatosProfesional, faltanDatosPaciente, listar, OPCIONES_SEXO,
} from '../../lib/datosReceta'
import { toast } from '../Toast'

/**
 * Los datos que faltan para emitir la receta, cargables acá mismo.
 *
 * Antes esto era un cartel sin salida: decía qué faltaba del paciente y agregaba
 * "se lo pedimos automáticamente la próxima vez que entre a una consulta". Para la
 * consulta que el profesional tiene adelante eso significa nunca — y es
 * exactamente cuando necesita la receta. Pedido de Mateo (2026-07-29): el
 * profesional tiene que poder cargar los datos DEL paciente aunque el paciente no
 * los haya dado.
 *
 * Dos caminos distintos a propósito:
 *  - Los datos del profesional se escriben directo: es su propio perfil, la RLS
 *    ya lo permite.
 *  - Los del paciente van por la RPC `complete_patient_rcta_data` (migración 075),
 *    que valida el vínculo, limita las columnas a tres, nunca sobreescribe algo
 *    que el paciente ya cargó y deja asiento de quién lo hizo.
 *
 * Vive en un componente propio porque lo usan las dos pantallas donde se receta:
 * el detalle de la consulta y el panel de la videollamada.
 */

const CAMPO_INPUT = {
  dni:       { label: 'DNI',                  type: 'text', placeholder: 'Sin puntos, ej: 30123456', inputMode: 'numeric' },
  gender:    { label: 'Sexo',                 type: 'select' },
  birthDate: { label: 'Fecha de nacimiento',  type: 'date' },
}

function CampoEditable({ campo, value, onChange }) {
  const cfg = CAMPO_INPUT[campo]
  if (!cfg) return null

  return (
    <div>
      <label className="form-label text-xs">{cfg.label}</label>
      {cfg.type === 'select' ? (
        <select className="form-select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">— Seleccionar —</option>
          {OPCIONES_SEXO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={cfg.type}
          inputMode={cfg.inputMode}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={cfg.placeholder}
          className="form-input"
        />
      )}
    </div>
  )
}

export default function DatosRecetaFaltantes({
  profile, profProfile, paciente, patientId, consultationId, onActualizado,
}) {
  const [abierto, setAbierto] = useState(null) // 'paciente' | 'profesional' | null
  const [form, setForm] = useState({})
  const [guardando, setGuardando] = useState(false)
  // Lo que se acaba de guardar, superpuesto a los props. El `profile` del
  // profesional viene del árbol de App y no se refetchea solo; sin este parche el
  // cartel seguiría pidiendo un dato que ya está en la base hasta recargar la
  // página — y estamos en medio de una videollamada.
  const [guardado, setGuardado] = useState({ paciente: {}, profesional: {} })

  const faltaProfesional = faltanDatosProfesional({ ...profile, ...guardado.profesional }, profProfile)
  const faltaPaciente = faltanDatosPaciente(
    paciente || patientId ? { ...paciente, ...guardado.paciente } : null
  )

  if (faltaProfesional.length === 0 && faltaPaciente.length === 0) return null

  const abrir = quien => {
    setForm({})
    setAbierto(prev => (prev === quien ? null : quien))
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Sólo los campos que el profesional realmente completó. Mandar '' borraría
  // menos que nada: la RPC ignora vacíos, pero igual conviene no mandarlos.
  const conValor = campos => campos
    .filter(c => String(form[c.campo] ?? '').trim() !== '')
    .map(c => c.campo)

  async function guardarPaciente() {
    const llenos = conValor(faltaPaciente)
    if (llenos.length === 0) { toast.warning('Completá al menos un dato'); return }

    setGuardando(true)
    try {
      await profilesService.completeRctaData({
        patientId:      patientId ?? paciente?.id,
        consultationId: consultationId ?? null,
        dni:            llenos.includes('dni') ? String(form.dni).trim() : null,
        gender:         llenos.includes('gender') ? form.gender : null,
        birthDate:      llenos.includes('birthDate') ? form.birthDate : null,
      })
      setGuardado(g => ({
        ...g,
        paciente: { ...g.paciente, ...Object.fromEntries(llenos.map(k => [k, form[k]])) },
      }))
      toast.success('Datos del paciente actualizados')
      setAbierto(null)
      setForm({})
      onActualizado?.()
    } catch (err) {
      toast.error(err?.message ?? 'Error al guardar los datos del paciente')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarProfesional() {
    // El perfil propio: dni/gender en `profiles`, matrícula/domicilio en
    // `professional_profiles`. Los dos son filas propias, la RLS ya los permite.
    const propios = {}
    if (String(form.dni ?? '').trim()) propios.dni = String(form.dni).trim()
    if (form.gender) propios.gender = form.gender

    if (Object.keys(propios).length === 0) { toast.warning('Completá al menos un dato'); return }

    setGuardando(true)
    try {
      await profilesService.update(profile.id, propios)
      setGuardado(g => ({ ...g, profesional: { ...g.profesional, ...propios } }))
      toast.success('Tus datos fueron actualizados')
      setAbierto(null)
      setForm({})
      onActualizado?.()
    } catch {
      toast.error('Error al guardar tus datos')
    } finally {
      setGuardando(false)
    }
  }

  // La matrícula y el domicilio viven en el perfil profesional y tienen su propia
  // pantalla con validación de matrícula; no se duplican acá.
  const faltaProfEditableAqui = faltaProfesional.filter(c => CAMPO_INPUT[c.campo])
  const faltaProfEnConfig = faltaProfesional.filter(c => !CAMPO_INPUT[c.campo])

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Warning className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" weight="fill" />
        <p className="text-xs font-bold text-amber-900">
          Falta información para emitir la receta electrónica
        </p>
      </div>

      {/* ── Paciente ─────────────────────────────────────────────────────────── */}
      {faltaPaciente.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-amber-800">
              <strong>Del paciente:</strong> {listar(faltaPaciente)}
            </p>
            <button
              type="button"
              onClick={() => abrir('paciente')}
              className="flex items-center gap-1 text-[11px] font-semibold text-amber-900 underline shrink-0"
            >
              <PencilSimple className="h-3 w-3" />
              {abierto === 'paciente' ? 'Cerrar' : 'Cargarlos yo'}
            </button>
          </div>

          {abierto === 'paciente' && (
            <div className="rounded-lg bg-white border border-amber-200 p-3 space-y-3">
              <p className="text-[11px] text-text-secondary">
                Preguntáselos al paciente y cargalos acá. Quedan en su perfil y no se
                sobreescribe nada que él ya haya cargado.
              </p>
              {/* Una columna: este formulario vive tanto en el detalle de la
                  consulta (ancho) como en el panel de la videollamada (~300px), y
                  ahí dos columnas truncaban el placeholder del DNI y el select. */}
              <div className="space-y-2">
                {faltaPaciente.map(c => (
                  <CampoEditable key={c.campo} campo={c.campo} value={form[c.campo]} onChange={v => set(c.campo, v)} />
                ))}
              </div>
              <button
                type="button"
                onClick={guardarPaciente}
                disabled={guardando}
                className="btn-primary w-full py-2 flex items-center justify-center gap-1.5 text-sm"
              >
                {guardando
                  ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
                  : <><Check className="h-4 w-4" /> Guardar datos del paciente</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Profesional ──────────────────────────────────────────────────────── */}
      {faltaProfesional.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-amber-800">
              <strong>Tuyo:</strong> {listar(faltaProfesional)}
            </p>
            {faltaProfEditableAqui.length > 0 && (
              <button
                type="button"
                onClick={() => abrir('profesional')}
                className="flex items-center gap-1 text-[11px] font-semibold text-amber-900 underline shrink-0"
              >
                <PencilSimple className="h-3 w-3" />
                {abierto === 'profesional' ? 'Cerrar' : 'Completar acá'}
              </button>
            )}
          </div>

          {abierto === 'profesional' && (
            <div className="rounded-lg bg-white border border-amber-200 p-3 space-y-3">
              <div className="space-y-2">
                {faltaProfEditableAqui.map(c => (
                  <CampoEditable key={c.campo} campo={c.campo} value={form[c.campo]} onChange={v => set(c.campo, v)} />
                ))}
              </div>
              <button
                type="button"
                onClick={guardarProfesional}
                disabled={guardando}
                className="btn-primary w-full py-2 flex items-center justify-center gap-1.5 text-sm"
              >
                {guardando
                  ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
                  : <><Check className="h-4 w-4" /> Guardar mis datos</>}
              </button>
            </div>
          )}

          {faltaProfEnConfig.length > 0 && (
            <p className="text-[11px] text-amber-800">
              {listar(faltaProfEnConfig)} se cargan en{' '}
              <Link to="/profesional/configuracion" className="underline font-semibold">tu perfil</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
