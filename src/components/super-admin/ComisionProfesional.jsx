import { useState, useEffect, useCallback } from 'react'
import { Percent, CircleNotch, Pencil } from '@phosphor-icons/react'
import { comisionService, formatTasa, formatHasta } from '../../services/comisionService'
import { toast } from '../Toast'

function fmtFecha(d) {
  return d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}

/**
 * Chapa de la columna "Comisión" de /super-admin/profesionales.
 * `actual` es la fila de comisiones_de_profesionales() (o undefined).
 */
export function ComisionBadge({ actual }) {
  if (!actual?.vigente) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">General</span>
  }
  const exento = Number(actual.rate) === 0
  const hasta = formatHasta(actual.validUntil)
  return (
    <div>
      <span data-testid="badge-comision" className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${exento ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
        {exento ? 'Exento' : formatTasa(actual.rate)}
      </span>
      <p className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">{hasta ? `hasta ${hasta}` : 'sin vencimiento'}</p>
    </div>
  )
}

/**
 * Tarjeta del drawer del profesional: tasa propia, vencimiento opcional y
 * motivo obligatorio. Cada guardado agrega una fila al historial (append-only),
 * con quién y cuándo. Lo usa mp-payment en el próximo cobro.
 */
export default function ComisionProfesional({ professionalId, generalRate, onChanged }) {
  const [historial, setHistorial] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pct, setPct] = useState('0')
  const [hasta, setHasta] = useState('')
  const [motivo, setMotivo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHistorial(await comisionService.getHistorial(professionalId))
    } catch {
      toast.error('No se pudo cargar la comisión')
    } finally {
      setLoading(false)
    }
  }, [professionalId])

  useEffect(() => { if (professionalId) load() }, [professionalId, load])

  const ultimo = historial[0]
  const vigente = ultimo && ultimo.rate != null && (!ultimo.validUntil || new Date(ultimo.validUntil) > new Date())

  async function guardar(volverAGeneral = false) {
    if (!motivo.trim()) { toast.error('Escribí el motivo'); return }
    const n = Number(String(pct).replace(',', '.'))
    if (!volverAGeneral && (!Number.isFinite(n) || n < 0 || n > 100)) { toast.error('La comisión va de 0 a 100%'); return }
    setSaving(true)
    try {
      await comisionService.fijar(professionalId, {
        rate: volverAGeneral ? null : Math.round(n * 100) / 10000,
        // Vence al terminar el día elegido (hora de Buenos Aires).
        until: !volverAGeneral && hasta ? `${hasta}T23:59:59-03:00` : null,
        reason: motivo.trim(),
      })
      toast.success(volverAGeneral ? 'Vuelve a la comisión general' : 'Comisión guardada')
      setEditing(false); setMotivo(''); setHasta('')
      await load()
      onChanged?.()
    } catch (e) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="comision-profesional" className="rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100 rounded-t-xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Percent className="h-4 w-4 text-gray-400" />
          Comisión de Healthier
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-brand hover:underline">
            <Pencil className="h-3 w-3" /> Cambiar
          </button>
        )}
      </div>
      <div className="p-4 space-y-3 text-sm">
        {loading ? (
          <div className="h-8 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <>
            <p className="text-gray-800">
              {vigente
                ? <><span className="font-semibold">{Number(ultimo.rate) === 0 ? 'Exento (0%)' : formatTasa(ultimo.rate)}</span>{ultimo.validUntil ? ` hasta el ${fmtFecha(ultimo.validUntil)}` : ', sin vencimiento'}</>
                : <>Paga la general: <span className="font-semibold">{formatTasa(generalRate ?? 0.2)}</span></>}
            </p>
            <p className="text-xs text-gray-500">Sus pacientes referidos (los que trajo con su link) no pagan comisión, siempre.</p>
          </>
        )}

        {editing && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Comisión (%)</label>
                <input data-testid="comision-pct" type="number" min="0" max="100" step="0.5" value={pct}
                  onChange={e => setPct(e.target.value)} className="form-input text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Hasta (opcional)</label>
                <input data-testid="comision-hasta" type="date" value={hasta}
                  onChange={e => setHasta(e.target.value)} className="form-input text-sm" />
              </div>
            </div>
            <p className="text-xs text-gray-400">0% = exento. Sin fecha, no vence.</p>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Motivo</label>
              <textarea data-testid="comision-motivo" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                placeholder="Ej: lanzamiento, trae su cartera de pacientes" className="form-textarea text-sm" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button data-testid="comision-guardar" type="button" disabled={saving} onClick={() => guardar(false)}
                className="btn-primary text-sm flex items-center gap-1.5">
                {saving && <CircleNotch className="h-4 w-4 animate-spin" />} Guardar
              </button>
              {vigente && (
                <button type="button" disabled={saving} onClick={() => guardar(true)} className="btn-secondary text-sm">
                  Volver a la general
                </button>
              )}
              <button type="button" disabled={saving} onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:underline px-2">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {historial.length > 0 && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Historial</p>
            <ul className="space-y-1.5">
              {historial.map(h => (
                <li key={h.id} className="text-xs text-gray-600">
                  <span className="font-medium text-gray-800">
                    {h.rate == null ? 'General' : formatTasa(h.rate)}
                    {h.rate != null && (h.validUntil ? ` hasta ${fmtFecha(h.validUntil)}` : ' sin vencimiento')}
                  </span>
                  {' · '}{h.reason}
                  <span className="block text-gray-400">{h.setter?.fullName ?? '—'} · {fmtFecha(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
