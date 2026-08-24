import { useState, useEffect, useRef } from 'react'
import { Plus, X, CircleNotch, Check, TestTube, Info } from '@phosphor-icons/react'
import { clinicalService } from '../../services/clinicalService'
import { capitalizarNombreCatalogo } from '../../lib/format'
import InfoTooltip from '../common/InfoTooltip'
import EstudioSearch from '../patient/EstudioSearch'
import { toast } from '../Toast'

const EMPTY_ESTUDIO = { nombre: '', codigo: null }

/**
 * "Recetar estudios": deja asentada en la HC una orden de estudios (análisis,
 * imágenes, prácticas), separada de la receta de medicamentos.
 *
 * A diferencia de `PrescriptionCreator`, esto NO pasa por RCTA — el servicio
 * de recetas electrónicas (Innovamed) sólo emite para medicamentos. La orden
 * queda como un `clinical_entries` con `entryType: 'order'`, visible en la
 * historia del paciente, sin PDF ni firma electrónica.
 *
 * El buscador reutiliza `EstudioSearch` (ya construido para el BioVisor):
 * mismo catálogo de prácticas de Innovamed, con texto libre permitido — a
 * diferencia del vademécum de medicamentos, acá no hay ninguna API del otro
 * lado rechazando lo escrito a mano.
 *
 * @param {{ patientId: string, encounterId: string|null,
 *   ensureEncounter: () => Promise<string>, professionalId: string,
 *   profProfile: object|null, bloqueada?: boolean }} props
 *   `profProfile` en null significa "todavía está cargando" — nunca se manda
 *   un placeholder de matrícula, así que mientras no llegue el guardado queda
 *   deshabilitado (mismo criterio que el formulario de notas de VideoCall).
 */
export default function EstudiosCreator({ patientId, encounterId, ensureEncounter, professionalId, profProfile, bloqueada = false, onEntryAdded }) {
  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [current, setCurrent] = useState(EMPTY_ESTUDIO)
  const [estudios, setEstudios] = useState([])
  const [indicaciones, setIndicaciones] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!encounterId) { setLoading(false); return }
    setLoading(true)
    clinicalService.getEncounterWithDetail(encounterId)
      .then(d => setOrdenes((d.entries ?? []).filter(e => e.entryType === 'order').reverse()))
      .catch(() => setOrdenes([]))
      .finally(() => setLoading(false))
  }, [encounterId])

  // Mismo criterio que PrescriptionCreator (Mateo, 2026-08-24): sin órdenes
  // previas, el formulario abre solo — sin el empty state + botón como paso
  // intermedio. `autoAbierto` evita reabrirlo si el profesional cancela y la
  // lista sigue vacía.
  const autoAbierto = useRef(false)
  useEffect(() => {
    if (loading || bloqueada || autoAbierto.current) return
    if (ordenes.length === 0) {
      autoAbierto.current = true
      setAddOpen(true)
    }
  }, [loading, bloqueada, ordenes.length])

  function agregarEstudioActual() {
    const nombre = current.nombre.trim()
    if (!nombre) return
    // Capitalizado ya al guardarse: el catálogo devuelve cualquier casing y
    // este nombre termina en la HC que ve el paciente. El código SNOMED viaja
    // aparte, así que normalizar el texto no rompe nada. (Mateo, 2026-08-24)
    setEstudios(prev => [...prev, { nombre: capitalizarNombreCatalogo(nombre), codigo: current.codigo ?? null }])
    setCurrent(EMPTY_ESTUDIO)
  }

  function quitarEstudio(i) {
    setEstudios(prev => prev.filter((_, idx) => idx !== i))
  }

  function resetForm() {
    setCurrent(EMPTY_ESTUDIO)
    setEstudios([])
    setIndicaciones('')
  }

  async function handleSave() {
    if (!estudios.length) { toast.warning('Agregá al menos un estudio'); return }
    if (!profProfile) return // el botón ya queda deshabilitado mientras esto sea null

    setSaving(true)
    try {
      const eid = await ensureEncounter()
      const nombres = estudios.map(e => e.nombre).join(', ')
      const contentParts = [`Estudios solicitados: ${nombres}.`]
      if (indicaciones.trim()) contentParts.push(`Indicaciones: ${indicaciones.trim()}`)

      const entry = await clinicalService.addEntry(eid, {
        patientId,
        professionalId,
        entryType: 'order',
        content: contentParts.join(' '),
        data: {
          source: 'orden_estudios',
          estudios: estudios.map(e => ({ nombre: e.nombre, codigo: e.codigo ?? null })),
          indicaciones: indicaciones.trim() || null,
        },
        licenseType: profProfile.licenseType,
        licenseNumber: profProfile.licenseNumber,
      })

      setOrdenes(prev => [entry, ...prev])
      // La planilla de Notas del panel lista TODAS las entradas del encuentro;
      // sin avisarle, la orden recién guardada no aparece ahí hasta recargar.
      onEntryAdded?.(entry)
      resetForm()
      setAddOpen(false)
      toast.success('Orden de estudios guardada en la historia clínica')
    } catch {
      toast.error('Error al guardar la orden de estudios')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-14 rounded-xl border border-border-default bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && ordenes.length > 0 && (
        <div className="space-y-2">
          {ordenes.map(o => (
            <div key={o.id} className="rounded-xl border border-border-default bg-bg-surface p-3">
              <div className="flex items-start gap-2">
                <TestTube className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary leading-relaxed">{o.content}</p>
                  {o.createdAt && (
                    <p className="text-[11px] text-text-tertiary mt-1">
                      {new Date(o.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && ordenes.length === 0 && !addOpen && (
        <p className="text-sm text-text-muted py-2">Sin estudios pedidos en esta consulta.</p>
      )}

      {bloqueada && (
        <p className="text-[11px] text-text-tertiary">
          La consulta está cerrada: no se pueden agregar órdenes de estudios.
        </p>
      )}

      {addOpen && !bloqueada ? (
        <div className="mt-2 pt-4 border-t border-border-default space-y-3">
          <p className="text-sm font-semibold text-text-primary">Nueva orden de estudios</p>

          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <EstudioSearch value={current} onChange={setCurrent} disabled={saving} />
            </div>
            <button
              type="button"
              onClick={agregarEstudioActual}
              disabled={!current.nombre.trim() || saving}
              className="btn-secondary px-3 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {estudios.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {estudios.map((e, i) => (
                <span key={`${e.nombre}-${i}`} className="inline-flex items-center gap-1.5 text-xs bg-brand-muted/30 text-text-primary pl-2.5 pr-1.5 py-1 rounded-full">
                  {e.nombre}
                  <button type="button" onClick={() => quitarEstudio(i)} aria-label={`Quitar ${e.nombre}`}
                    className="text-text-tertiary hover:text-danger">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div>
            <label className="form-label text-xs">Indicaciones</label>
            <textarea value={indicaciones} onChange={e => setIndicaciones(e.target.value)}
              placeholder="Ej: En ayunas de 8 horas. Traer estudios previos si tiene."
              rows={2} className="form-textarea resize-none" />
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setAddOpen(false); resetForm() }}
              className="btn-secondary flex-1 py-2 flex items-center justify-center gap-1">
              <X className="h-4 w-4" /> Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !profProfile || estudios.length === 0}
              title={!profProfile ? 'Esperando el perfil profesional…' : undefined}
              className="btn-primary flex-1 py-2 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(saving || !profProfile)
                ? <CircleNotch className="h-4 w-4 animate-spin" />
                : <Check className="h-4 w-4" />}
              {saving ? 'Guardando…' : 'Guardar orden'}
            </button>
            <InfoTooltip
              title="Qué pasa con esta orden"
              label="Queda asentada en la historia clínica del paciente, que la ve en su historia. A diferencia de la receta de medicamentos, no genera un PDF: el servicio de recetas electrónicas sólo emite para medicamentos."
            >
              <Info className="h-4 w-4 text-text-tertiary cursor-help" />
            </InfoTooltip>
          </div>
        </div>
      ) : (
        !loading && !bloqueada && (
          <button type="button" onClick={() => setAddOpen(true)}
            className={ordenes.length > 0
              ? 'flex items-center gap-1.5 text-sm text-brand hover:underline mt-1'
              : 'flex items-center justify-center gap-1.5 w-full mt-1 py-2.5 rounded-lg border border-brand/40 text-sm font-semibold text-brand hover:bg-brand/10 transition-colors'}>
            <Plus className="h-4 w-4" />
            Nueva orden de estudios
          </button>
        )
      )}
    </div>
  )
}
