import { useState, useEffect } from 'react'
import { CircleNotch, Check, Warning, Siren } from '@phosphor-icons/react'
import { VERTICALS } from '../../lib/verticals'
import { verticalsService } from '../../services/verticalsService'
import { invalidarVerticales } from '../../hooks/useVerticales'
import { toast } from '../../components/Toast'

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

export default function SuperAdminVerticales() {
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
    </div>
  )
}
