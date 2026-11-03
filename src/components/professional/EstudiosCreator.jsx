import { useState, useEffect, useRef } from 'react'
import { Plus, X, CircleNotch, TestTube, PaperPlaneTilt, Check } from '@phosphor-icons/react'
import { clinicalService } from '../../services/clinicalService'
import { ordenesEstudiosService } from '../../services/ordenesEstudiosService'
import { capitalizarNombreCatalogo } from '../../lib/format'
import { esSimulado } from '../../lib/simulacion'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { useFirmaDelProfesional } from '../../hooks/useFirmaDelProfesional'
import EstudioSearch from '../patient/EstudioSearch'
import FirmaSheet from './FirmaSheet'
import DatosRecetaFaltantes from './DatosRecetaFaltantes'
import Modal from '../Modal'
import { toast } from '../Toast'
import { mensajeDeError } from '../../lib/supabase'

const EMPTY_ESTUDIO = { nombre: '', codigo: null, catalogoId: null, categoria: null }
const TZ = 'America/Argentina/Buenos_Aires'

/**
 * "Recetar estudios": la orden de estudios de la consulta.
 *
 * Desde el 2026-11-03 (migración 227) la orden se EMITE por el servicio de
 * recetas, igual que la receta de medicamentos: sale con firma y sello, en PDF,
 * y le llega a la paciente (mail + aviso + Bóveda). Lo pidió una profesional:
 * "con los estudios después de guardar no me aparece nada, no puedo enviarlo".
 *
 *  · La orden se guarda primero en la HC (`clinical_entries`, 'order') y
 *    después se emite con la Edge Function `rcta-estudios`. Si la emisión
 *    falla, la orden queda en la HC con su botón "Emitir" para reintentar.
 *  · Cada estudio tiene que salir del listado: el servicio rechaza lo escrito
 *    a mano (QBI232). Las órdenes viejas, guardadas sin el id del listado, se
 *    emiten si su nombre coincide exacto; si no, se pide una orden nueva.
 *  · Quien no puede recetar (especialidad sin receta) y la práctica con
 *    paciente simulada siguen como antes: la orden queda sólo en la HC.
 */
export default function EstudiosCreator({
  patientId, encounterId, ensureEncounter, professionalId, profProfile, bloqueada = false, onEntryAdded,
  profile, paciente, consultationId, onDatosActualizados,
}) {
  const [ordenes, setOrdenes] = useState([])
  const [emisiones, setEmisiones] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [current, setCurrent] = useState(EMPTY_ESTUDIO)
  const [estudios, setEstudios] = useState([])
  const [indicaciones, setIndicaciones] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [saving, setSaving] = useState(false)
  const [emitiendo, setEmitiendo] = useState(null) // entryId en curso
  const [firmaPara, setFirmaPara] = useState(null) // entryId que espera la firma
  const [aAnular, setAAnular] = useState(null)
  const [anulando, setAnulando] = useState(false)

  const { puedeRecetar } = useEspecialidades()
  const enPractica = esSimulado(encounterId) || esSimulado(consultationId)
  const puedeEmitir = !enPractica && puedeRecetar(profProfile?.specialty)
  const { tieneFirma, marcar: marcarFirma } = useFirmaDelProfesional(professionalId)

  // La lista viva: `emitir` corre después de agregar una orden y su closure
  // tendría la lista vieja (sin la recién guardada).
  const ordenesRef = useRef(ordenes)
  useEffect(() => { ordenesRef.current = ordenes }, [ordenes])

  async function recargarEmisiones(lista = ordenesRef.current) {
    if (!puedeEmitir || !lista.length) { setEmisiones([]); return }
    try {
      setEmisiones(await ordenesEstudiosService.listarDeEntradas(lista.map(o => o.id)))
    } catch {
      setEmisiones([])
    }
  }

  useEffect(() => {
    if (!encounterId) { setLoading(false); return }
    setLoading(true)
    clinicalService.getEncounterWithDetail(encounterId)
      .then(async d => {
        const lista = (d.entries ?? []).filter(e => e.entryType === 'order').reverse()
        setOrdenes(lista)
        await recargarEmisiones(lista)
      })
      .catch(() => setOrdenes([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId, puedeEmitir])

  // Sin órdenes previas, el formulario abre solo (Mateo, 2026-08-24).
  const autoAbierto = useRef(false)
  useEffect(() => {
    if (loading || bloqueada || autoAbierto.current) return
    if (ordenes.length === 0) {
      autoAbierto.current = true
      setAddOpen(true)
    }
  }, [loading, bloqueada, ordenes.length])

  // Para emitir, cada estudio tiene que venir del listado (con su id).
  const faltaElegir = puedeEmitir && current.nombre.trim() && !current.catalogoId

  function agregarEstudioActual() {
    const nombre = current.nombre.trim()
    if (!nombre || faltaElegir) return
    setEstudios(prev => [...prev, {
      nombre: capitalizarNombreCatalogo(nombre),
      codigo: current.codigo ?? null,
      catalogoId: current.catalogoId ?? null,
      categoria: current.categoria ?? null,
    }])
    setCurrent(EMPTY_ESTUDIO)
  }

  function quitarEstudio(i) {
    setEstudios(prev => prev.filter((_, idx) => idx !== i))
  }

  function resetForm() {
    setCurrent(EMPTY_ESTUDIO)
    setEstudios([])
    setIndicaciones('')
    setDiagnostico('')
  }

  async function emitir(entryId, { firmaRecienCargada = false } = {}) {
    if (!tieneFirma && !firmaRecienCargada) { setFirmaPara(entryId); return }
    setEmitiendo(entryId)
    try {
      const { yaEstaba } = await ordenesEstudiosService.emitir(entryId)
      toast.success(yaEstaba ? 'Esta orden ya estaba emitida' : 'Orden emitida: le llegó a tu paciente')
    } catch (err) {
      if (err.code === 'RCTA_FIRMA_FALTANTE') setFirmaPara(entryId)
      else toast.error(`No se pudo emitir la orden: ${err.message}`)
    } finally {
      setEmitiendo(null)
      recargarEmisiones()
    }
  }

  async function handleSave() {
    if (!estudios.length) { toast.warning('Agregá al menos un estudio'); return }

    setSaving(true)
    let entry
    try {
      const eid = await ensureEncounter()
      const nombres = estudios.map(e => e.nombre).join(', ')
      const contentParts = [`Estudios solicitados: ${nombres}.`]
      if (diagnostico.trim()) contentParts.push(`Diagnóstico: ${diagnostico.trim()}.`)
      if (indicaciones.trim()) contentParts.push(`Indicaciones: ${indicaciones.trim()}`)

      entry = await clinicalService.addEntry(eid, {
        patientId,
        professionalId,
        entryType: 'order',
        content: contentParts.join(' '),
        data: {
          source: 'orden_estudios',
          estudios: estudios.map(e => ({ nombre: e.nombre, codigo: e.codigo ?? null, catalogoId: e.catalogoId ?? null, categoria: e.categoria ?? null })),
          indicaciones: indicaciones.trim() || null,
          diagnostico: diagnostico.trim() || null,
        },
      })

      const lista = [entry, ...ordenes]
      ordenesRef.current = lista
      setOrdenes(lista)
      onEntryAdded?.(entry)
      resetForm()
      setAddOpen(false)
      if (!puedeEmitir) toast.success('Orden de estudios guardada en la historia clínica')
    } catch (err) {
      toast.error(`No se pudo guardar la orden de estudios: ${mensajeDeError(err)}`)
    } finally {
      setSaving(false)
    }
    if (entry && puedeEmitir) await emitir(entry.id)
  }

  async function confirmarAnular() {
    setAnulando(true)
    try {
      const r = await ordenesEstudiosService.anular(aAnular.id)
      if (r.estado === 'error') toast.warning(`Quedó anulada en Healthier, pero el servicio no lo confirmó: ${r.detalle ?? ''}`)
      else toast.success('Orden anulada')
      setAAnular(null)
    } catch (err) {
      toast.error(`No se pudo anular: ${err.message}`)
    } finally {
      setAnulando(false)
      recargarEmisiones()
    }
  }

  const emisionDe = entryId => emisiones.find(e => e.entryId === entryId && e.status === 'issued')
    ?? emisiones.find(e => e.entryId === entryId && e.aRevisar)
    ?? emisiones.find(e => e.entryId === entryId && e.status === 'anulado')
  const fecha = iso => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })

  return (
    <div className="space-y-3">
      <Modal open={!!aAnular} onClose={anulando ? () => {} : () => setAAnular(null)} title="¿Anular esta orden?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Deja de estar disponible para tu paciente.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAAnular(null)} disabled={anulando} className="btn-secondary flex-1 py-2">Volver</button>
            <button type="button" onClick={confirmarAnular} disabled={anulando}
              className="btn-danger flex-1 py-2 flex items-center justify-center gap-1.5">
              {anulando ? <><CircleNotch className="h-4 w-4 animate-spin" /> Anulando…</> : 'Anular'}
            </button>
          </div>
        </div>
      </Modal>

      <FirmaSheet
        open={!!firmaPara}
        userId={professionalId}
        onClose={() => setFirmaPara(null)}
        onFirmada={() => { const id = firmaPara; setFirmaPara(null); marcarFirma(true); emitir(id, { firmaRecienCargada: true }) }}
      />

      {puedeEmitir && (
        <DatosRecetaFaltantes
          profile={profile}
          profProfile={profProfile}
          paciente={paciente}
          patientId={patientId}
          consultationId={consultationId}
          onActualizado={onDatosActualizados}
        />
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-14 rounded-xl border border-border-default bg-bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && ordenes.length > 0 && (
        <div className="space-y-2">
          {ordenes.map(o => {
            const em = puedeEmitir ? emisionDe(o.id) : null
            const emitida = em?.status === 'issued'
            const anulada = em?.status === 'anulado' && !em?.aRevisar
            return (
              <div key={o.id} data-testid="orden-estudios" className={`rounded-xl border border-border-default bg-bg-surface p-3 ${anulada ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <TestTube className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary leading-relaxed">{o.content}</p>
                    <p className="text-[11px] text-text-tertiary mt-1">
                      {emitida ? `Emitida el ${fecha(em.rctaIssuedAt ?? em.createdAt)}`
                        : anulada ? 'Anulada'
                        : o.createdAt ? fecha(o.createdAt) : null}
                    </p>
                  </div>
                </div>
                {puedeEmitir && (
                  em?.aRevisar ? (
                    <p className="text-xs text-amber-700 mt-2">Puede haber salido: lo revisa Healthier antes de emitirla de nuevo.</p>
                  ) : emitida ? (
                    <div className="flex items-center justify-end gap-4 mt-2">
                      {em.rctaPdfUrl && (
                        <a href={em.rctaPdfUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand">Ver PDF</a>
                      )}
                      {em.professionalId === professionalId && (
                        <button type="button" onClick={() => setAAnular(em)} className="text-sm text-text-tertiary hover:text-danger">Anular</button>
                      )}
                    </div>
                  ) : !anulada && o.professionalId === professionalId && (
                    <button type="button" onClick={() => emitir(o.id)} disabled={emitiendo === o.id}
                      data-testid="emitir-orden"
                      className="btn-primary w-full mt-3 py-2 flex items-center justify-center gap-1.5">
                      {emitiendo === o.id
                        ? <><CircleNotch className="h-4 w-4 animate-spin" /> Emitiendo…</>
                        : <><PaperPlaneTilt className="h-4 w-4" /> Emitir y enviar al paciente</>}
                    </button>
                  )
                )}
              </div>
            )
          })}
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

          <div>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <EstudioSearch value={current} onChange={setCurrent} disabled={saving} soloCatalogo={puedeEmitir} />
              </div>
              <button
                type="button"
                onClick={agregarEstudioActual}
                disabled={!current.nombre.trim() || faltaElegir || saving}
                aria-label="Agregar estudio"
                className="btn-secondary px-3 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
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

          {puedeEmitir && (
            <div>
              <label className="form-label text-xs" htmlFor="orden-dx">Diagnóstico <span className="text-text-tertiary font-normal">(opcional, va impreso)</span></label>
              <input id="orden-dx" type="text" maxLength={200} value={diagnostico} onChange={e => setDiagnostico(e.target.value)}
                placeholder="CIE-10 o texto, ej.: D50.9 Anemia ferropénica" className="form-input" />
            </div>
          )}

          <div>
            <label className="form-label text-xs" htmlFor="orden-ind">Indicaciones</label>
            <textarea id="orden-ind" value={indicaciones} onChange={e => setIndicaciones(e.target.value)} maxLength={1000}
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
              disabled={saving || !!emitiendo || estudios.length === 0}
              data-testid="guardar-orden"
              className="btn-primary flex-[2] py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving || emitiendo
                ? <CircleNotch className="h-4 w-4 animate-spin" />
                : puedeEmitir ? <PaperPlaneTilt className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {saving ? 'Guardando…' : emitiendo ? 'Emitiendo…' : puedeEmitir ? 'Emitir orden' : 'Guardar orden'}
            </button>
          </div>
          {puedeEmitir && (
            <p className="text-[11px] text-text-tertiary">Sale con tu firma y le llega a tu paciente por mail y en la app.</p>
          )}
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
