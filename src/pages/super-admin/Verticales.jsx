import { useState, useEffect, useMemo } from 'react'
import { CircleNotch, Check, Warning, Siren, Plus, PencilSimple, CaretUp, CaretDown, TreeStructure, Trash } from '@phosphor-icons/react'
import { VERTICALS } from '../../lib/verticals'
import { verticalsService } from '../../services/verticalsService'
import { especialidadesService } from '../../services/especialidadesService'
import { invalidarVerticales } from '../../hooks/useVerticales'
import { useEspecialidades, invalidarEspecialidades } from '../../hooks/useEspecialidades'
import { toast } from '../../components/Toast'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import BulkActionBar from '../../components/super-admin/BulkActionBar'
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog'

/**
 * Habilitación y precio on-demand de cada vertical.
 *
 * Página propia y no una sección más de /super-admin/settings: Settings es un
 * formulario de perillas globales que se guardan juntas, y esto es una lista con
 * dos decisiones por fila que se guardan de a una. Meterlo ahí obligaba a un
 * "Guardar" que aplicara siete filas a la vez, que es justo lo que hace que
 * nadie toque nada por miedo.
 *
 * Lo que se edita acá sale de `vertical_settings` (migración 078). El nombre, el
 * ícono y los colores vienen del código: crear una vertical nueva necesita
 * diseño, habilitarla no.
 *
 * La sección "Servicio de emergencias" de abajo edita la fila 'sos' de la misma
 * tabla (migración 087) — mismo componente `FilaVertical`, reusado con un
 * pseudo-vertical hardcodeado acá (no vive en `VERTICALS`/`verticals.js` porque
 * no es una vertical clínica: no tiene especialidad ni aparece en la grilla del
 * paciente). Ver el comentario de la migración 087 para el detalle de por qué
 * S.O.S. reusa `vertical_settings` en vez de tener tabla propia.
 */

const SOS_PSEUDO_VERTICAL = { id: 'sos', nombre: 'Emergencias S.O.S', icon: Siren }

const formatARS = n =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(Number(n ?? 0))

function FilaVertical({ vertical, config, onGuardado, danger = false, priceLabel = 'Precio on-demand', toggleLabel }) {
  const [enabled, setEnabled] = useState(config?.enabled ?? false)
  const [precio, setPrecio] = useState(config?.ondemandPrice ?? '')
  const [guardando, setGuardando] = useState(false)

  const precioNum = precio === '' ? null : Number(precio)
  const sinPrecio = precioNum === null || Number.isNaN(precioNum) || precioNum <= 0
  const sucio =
    enabled !== (config?.enabled ?? false) ||
    (precioNum ?? null) !== (config?.ondemandPrice ?? null)

  const guardar = async () => {
    // Habilitar sin precio deja una vertical que el paciente ve y no puede
    // contratar: se corta acá y no en el checkout.
    if (enabled && sinPrecio) {
      toast.warning(`Poné un precio para habilitar ${vertical.nombre}`)
      return
    }
    setGuardando(true)
    try {
      const actualizado = await verticalsService.update(vertical.id, {
        enabled,
        ondemandPrice: sinPrecio ? null : precioNum,
      })
      onGuardado(actualizado)
      toast.success(`${vertical.nombre} actualizada`)
    } catch (err) {
      toast.error(err?.message || 'No pudimos guardar el cambio')
      setEnabled(config?.enabled ?? false)
      setPrecio(config?.ondemandPrice ?? '')
    } finally {
      setGuardando(false)
    }
  }

  const Icono = vertical.icon

  return (
    <div className={`card flex flex-col sm:flex-row sm:items-center gap-4 ${enabled ? '' : 'opacity-75'} ${danger ? 'border-danger/20' : ''}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-danger/10' : 'bg-bg-surface'}`}>
          <Icono className={`h-5 w-5 ${danger ? 'text-danger' : 'text-text-secondary'}`} weight={danger ? 'fill' : 'regular'} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">{vertical.nombre}</p>
          <p className="text-xs text-text-tertiary">
            {enabled
              ? config?.ondemandPrice
                ? `Consulta inmediata a ${formatARS(config.ondemandPrice)}`
                : 'Habilitada sin precio — no se puede contratar'
              : 'No se muestra a los pacientes'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div>
          <label className="form-label text-xs">{priceLabel}</label>
          <input
            type="number"
            min="1"
            step="1"
            value={precio}
            onChange={e => setPrecio(e.target.value)}
            placeholder="—"
            className="form-input w-32 text-sm"
          />
        </div>

        <div>
          {/* `toggleLabel`, cuando viene, hace doble función: label visible arriba
              del switch (mismo patrón que el precio) y fuente del aria-label. Sin
              él, las filas de siempre se quedan igual: sin label visible, con el
              aria-label genérico "Habilitar {nombre}". */}
          {toggleLabel && <label className="form-label text-xs block">{toggleLabel}</label>}
          <div className={toggleLabel ? '' : 'pt-5'}>
            <button
              type="button"
              onClick={() => setEnabled(v => !v)}
              aria-pressed={enabled}
              aria-label={toggleLabel ?? `Habilitar ${vertical.nombre}`}
              className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${enabled ? (danger ? 'bg-danger' : 'bg-brand') : 'bg-gray-300'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="pt-5">
          <button
            type="button"
            onClick={guardar}
            disabled={!sucio || guardando}
            className={`py-2 px-4 text-sm flex items-center gap-1.5 disabled:opacity-40 ${danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {guardando
              ? <><CircleNotch className="h-4 w-4 animate-spin" /> Guardando…</>
              : <><Check className="h-4 w-4" /> Guardar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Especialidades (migración 101) ──────────────────────────────────────────
//
// Reemplaza los catálogos hardcodeados `SPECIALTY_LABELS` (verticals.js) y
// `SPECIALTIES`/`SPECIALTY_COLORS` (specialties.js, eliminado). Vive en esta
// misma pantalla y no en una ruta propia porque cada especialidad cuelga de
// una de las verticales de arriba — es la misma relación, una fila más de
// configuración, no una sección aparte de la administración.
//
// Diseño de la tabla (`specialties`, migración 101): una sola tabla con
// auto-referencia (`parent_id`) para sub-especialidades — no hay ningún atributo
// que distinga estructuralmente una sub-especialidad de una especialidad de
// primer nivel además de tener padre, así que una segunda tabla sólo hubiera
// duplicado columnas y pantallas.

function slugify(label) {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function FormNuevaEspecialidad({ parent, onCreated, onCancel }) {
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [verticalId, setVerticalId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async e => {
    e.preventDefault()
    const slugFinal = (slug || slugify(label)).trim()
    if (!label.trim() || !slugFinal) return
    setGuardando(true)
    try {
      const creada = await especialidadesService.create({
        slug: slugFinal,
        label: label.trim(),
        verticalId: parent ? null : (verticalId || null),
        parentId: parent?.id ?? null,
      })
      toast.success(`${creada.label} agregada`)
      onCreated()
    } catch (err) {
      toast.error(err?.message?.includes('duplicate') || err?.code === '23505'
        ? 'Ya existe una especialidad con ese slug'
        : 'No pudimos guardar la especialidad')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="card flex flex-col sm:flex-row gap-3 sm:items-end bg-bg-surface">
      <div className="flex-1">
        <label className="form-label text-xs">
          {parent ? `Nueva sub-especialidad de ${parent.label}` : 'Nombre para mostrar'}
        </label>
        <input
          type="text"
          value={label}
          onChange={e => {
            setLabel(e.target.value)
            if (!slugTocado) setSlug(slugify(e.target.value))
          }}
          placeholder={parent ? 'Ej: Cardiología Clínica' : 'Ej: Otorrinolaringología'}
          className="form-input"
          autoFocus
        />
      </div>
      <div className="sm:w-40">
        <label className="form-label text-xs">Slug (clave estable)</label>
        <input
          type="text"
          value={slug}
          onChange={e => { setSlug(e.target.value); setSlugTocado(true) }}
          placeholder="auto"
          className="form-input font-mono text-xs"
        />
      </div>
      {!parent && (
        <div className="sm:w-44">
          <label className="form-label text-xs">Vertical</label>
          <select value={verticalId} onChange={e => setVerticalId(e.target.value)} className="form-select text-sm">
            <option value="">Ninguna</option>
            {VERTICALS.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
      )}
      <div className="flex gap-2 shrink-0">
        <button type="submit" disabled={guardando || !label.trim()} className="btn-primary text-sm py-2 px-4">
          {guardando ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-sm py-2 px-4">Cancelar</button>
      </div>
    </form>
  )
}

function EspecialidadRow({ especialidad, siblings, sub = false, onReload, onAddSub, addingSubTo, selection, onDeleteOne }) {
  const [editando, setEditando] = useState(false)
  const [label, setLabel] = useState(especialidad.label)
  const [verticalId, setVerticalId] = useState(especialidad.verticalId ?? '')
  const [guardando, setGuardando] = useState(false)

  const idx = siblings.findIndex(s => s.id === especialidad.id)
  const puedeSubir = idx > 0
  const puedeBajar = idx >= 0 && idx < siblings.length - 1

  const toggleActive = async () => {
    try {
      await especialidadesService.setActive(especialidad.id, !especialidad.active)
      onReload()
    } catch {
      toast.error('No pudimos actualizar el estado')
    }
  }

  const mover = async direccion => {
    const otro = siblings[idx + direccion]
    if (!otro) return
    try {
      await especialidadesService.reorder([
        { id: especialidad.id, sortOrder: otro.sortOrder },
        { id: otro.id, sortOrder: especialidad.sortOrder },
      ])
      onReload()
    } catch {
      toast.error('No pudimos reordenar')
    }
  }

  const guardarEdicion = async () => {
    if (!label.trim()) return
    setGuardando(true)
    try {
      await especialidadesService.update(especialidad.id, {
        label: label.trim(),
        verticalId: sub ? especialidad.verticalId : (verticalId || null),
      })
      toast.success('Especialidad actualizada')
      setEditando(false)
      onReload()
    } catch {
      toast.error('No pudimos guardar los cambios')
    } finally {
      setGuardando(false)
    }
  }

  const vertical = VERTICALS.find(v => v.id === especialidad.verticalId)

  return (
    <div className={`flex flex-col gap-2 py-2.5 ${sub ? 'pl-8 border-l-2 border-border-default ml-4' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col shrink-0">
          <button type="button" onClick={() => mover(-1)} disabled={!puedeSubir} className="disabled:opacity-20 text-text-tertiary hover:text-text-primary">
            <CaretUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => mover(1)} disabled={!puedeBajar} className="disabled:opacity-20 text-text-tertiary hover:text-text-primary">
            <CaretDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <input type="checkbox" checked={selection.isSelected(especialidad.id)} onChange={() => selection.toggle(especialidad.id)} className="rounded border-border-default shrink-0" />

        {editando ? (
          <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:items-center">
            <input value={label} onChange={e => setLabel(e.target.value)} className="form-input text-sm flex-1" autoFocus />
            {!sub && (
              <select value={verticalId} onChange={e => setVerticalId(e.target.value)} className="form-select text-sm sm:w-40">
                <option value="">Sin vertical</option>
                {VERTICALS.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            )}
            <div className="flex gap-1.5 shrink-0">
              <button onClick={guardarEdicion} disabled={guardando} className="btn-primary text-xs py-1.5 px-3">
                {guardando ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => { setEditando(false); setLabel(especialidad.label); setVerticalId(especialidad.verticalId ?? '') }} className="btn-secondary text-xs py-1.5 px-3">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`flex-1 min-w-0 ${especialidad.active ? '' : 'opacity-50'}`}>
              <span className="font-medium text-text-primary text-sm">{especialidad.label}</span>
              <span className="text-text-tertiary text-xs ml-2 font-mono">{especialidad.slug}</span>
              {vertical && (
                <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: vertical.bg, color: vertical.color }}>
                  {vertical.nombre}
                </span>
              )}
              {!especialidad.active && (
                <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactiva</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!sub && (
                <button
                  type="button"
                  onClick={() => onAddSub(especialidad)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-brand hover:bg-brand/10"
                  title="Agregar sub-especialidad"
                >
                  <TreeStructure className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={() => setEditando(true)} className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-surface" title="Editar">
                <PencilSimple className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleActive}
                className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${especialidad.active ? 'bg-brand' : 'bg-gray-300'}`}
                aria-pressed={especialidad.active}
                aria-label={especialidad.active ? 'Desactivar' : 'Activar'}
              >
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${especialidad.active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <button type="button" onClick={() => onDeleteOne(especialidad.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-danger hover:bg-danger-muted" title="Eliminar">
                <Trash className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {addingSubTo === especialidad.id && (
        <div className="pl-8 ml-4">
          <FormNuevaEspecialidad parent={especialidad} onCreated={() => { onReload(); onAddSub(especialidad) }} onCancel={() => onAddSub(especialidad)} />
        </div>
      )}
    </div>
  )
}

function EspecialidadesPanel() {
  const { especialidades, subEspecialidadesDe, cargando } = useEspecialidades()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [addingSubTo, setAddingSubTo] = useState(null)

  const topLevel = useMemo(
    () => especialidades.filter(e => !e.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [especialidades]
  )

  const recargar = () => invalidarEspecialidades()

  const allIds = useMemo(
    () => especialidades.map(e => e.id),
    [especialidades]
  )
  const selection = useBulkSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const deleteSelected = async (ids) => {
    setDeleting(true)
    try {
      await especialidadesService.deleteMany(ids)
      selection.clear()
      setConfirmOpen(false)
      recargar()
      toast.success(`${ids.length} especialidad${ids.length === 1 ? '' : 'es'} eliminada${ids.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar')
    } finally {
      setDeleting(false)
    }
  }

  const onDeleteOne = (id) => { selection.toggle(id); setConfirmOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <Warning className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" weight="fill" />
        <p className="text-xs text-amber-800">
          Esto reemplaza las especialidades que antes estaban escritas en el código. El
          catálogo se sembró con todo lo que ya estaba en uso — algunas quedaron
          <strong> inactivas</strong> por ser el mismo concepto que otra con otro nombre
          (p. ej. "Medicina Clínica" y "Medicina General"). Activalas sólo si de verdad
          hace falta la distinción; si no, dejalas así y usá la que ya está activa.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {topLevel.filter(e => e.active).length} activas / {topLevel.length} en total
        </p>
        <button onClick={() => setMostrarForm(v => !v)} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Nueva especialidad
        </button>
      </div>

      {mostrarForm && (
        <FormNuevaEspecialidad onCreated={() => { recargar(); setMostrarForm(false) }} onCancel={() => setMostrarForm(false)} />
      )}

      {cargando ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-10 card animate-pulse" />)}
        </div>
      ) : (
        <div className="card divide-y divide-border-default p-3">
          {topLevel.map(esp => (
            <div key={esp.id}>
              <EspecialidadRow
                especialidad={esp}
                siblings={topLevel}
                onReload={recargar}
                onAddSub={target => setAddingSubTo(prev => (prev === target.id ? null : target.id))}
                addingSubTo={addingSubTo}
                selection={selection}
                onDeleteOne={onDeleteOne}
              />
              {(subEspecialidadesDe[esp.id] || []).map(sub => (
                <EspecialidadRow
                  key={sub.id}
                  especialidad={sub}
                  siblings={subEspecialidadesDe[esp.id]}
                  sub
                  onReload={recargar}
                  onAddSub={() => {}}
                  addingSubTo={addingSubTo}
                  selection={selection}
                  onDeleteOne={onDeleteOne}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} especialidad${selection.count === 1 ? '' : 'es'}`}
        message="Las sub-especialidades hijas de una especialidad borrada quedan sin categoría padre."
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

export default function SuperAdminVerticales() {
  const [tab, setTab] = useState('verticales')
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    verticalsService.getAll()
      .then(setConfig)
      .catch(() => toast.error('No pudimos cargar las verticales'))
      .finally(() => setLoading(false))
  }, [])

  const alGuardar = actualizado => {
    setConfig(prev => (prev ?? []).map(c => (c.id === actualizado.id ? actualizado : c)))
    // El caché del hook lo comparten las cinco pantallas del paciente: si no se
    // invalida, siguen mostrando lo viejo hasta que alguien recargue.
    invalidarVerticales()
  }

  const porId = Object.fromEntries((config ?? []).map(c => [c.id, c]))

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Verticales</h1>
        <p className="text-text-secondary mt-1">
          Qué especialidades ve el paciente y cuánto sale su consulta inmediata.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border-default">
        {[
          { key: 'verticales',     label: 'Verticales' },
          { key: 'especialidades', label: 'Especialidades' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'especialidades' ? (
        <EspecialidadesPanel />
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Warning className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" weight="fill" />
            <p className="text-xs text-amber-800">
              El precio de acá <strong>pisa</strong> el que tenga cargado cada profesional, pero
              sólo para consultas inmediatas. Los turnos agendados siguen cobrando el precio
              de cada profesional.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-24 card animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {VERTICALS.map(v => (
                <FilaVertical
                  key={v.id}
                  vertical={v}
                  config={porId[v.id]}
                  onGuardado={alGuardar}
                />
              ))}
            </div>
          )}

          <div className="pt-2">
            <h2 className="text-lg font-semibold text-text-primary">Servicio de emergencias</h2>
            <p className="text-text-secondary text-sm mt-1">
              Precio y disponibilidad del S.O.S. — no es una vertical clínica, se muestra aparte.
            </p>
          </div>

          {loading ? (
            <div className="h-24 card animate-pulse" />
          ) : (
            <FilaVertical
              vertical={SOS_PSEUDO_VERTICAL}
              config={porId[SOS_PSEUDO_VERTICAL.id]}
              onGuardado={alGuardar}
              danger
              priceLabel="Precio S.O.S"
              toggleLabel="Disponible"
            />
          )}
        </>
      )}
    </div>
  )
}
