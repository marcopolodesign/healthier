import { useState, useEffect } from 'react'
import { ShoppingBag, CheckCircle, Trash, LockSimple } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { pharmacyAdminService } from '../../services/pharmacyAdminService'
import { pharmacyService } from '../../services/pharmacyService'
import { paymentsService } from '../../services/paymentsService'
import { toast } from '../../components/Toast'
import { formatARS, formatDate } from '../../lib/format'
import { STATUS_LABEL } from '../../lib/pharmacyOrders'

export default function SuperAdminFarmacia() {
  const [orders, setOrders] = useState([])
  const [mpStatus, setMpStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  // Recetas (migración 214): cuántos días sirve una receta para comprar, y
  // las drogas que nunca pueden quedar como venta libre.
  const [vigenciaDias, setVigenciaDias] = useState(30)
  const [guardandoVigencia, setGuardandoVigencia] = useState(false)
  const [drogas, setDrogas] = useState([])
  const [nuevaDroga, setNuevaDroga] = useState({ droga: '', tipo: 'receta_archivada', motivo: '' })

  useEffect(() => {
    setLoading(true)
    Promise.all([
      medicationOrdersService.listForPharmacy({}),
      pharmacyAdminService.getConnectionStatus(),
      paymentsService.getPlatformSettings(),
      pharmacyService.getDrogasBajoReceta(),
    ])
      .then(([ords, { data }, settings, drg]) => {
        setOrders(ords); setMpStatus(data)
        setVigenciaDias(settings?.recetaVigenciaDias ?? 30)
        setDrogas(drg)
      })
      .catch(() => toast.error('Error al cargar la vista de farmacia'))
      .finally(() => setLoading(false))
  }, [])

  const guardarVigencia = async () => {
    setGuardandoVigencia(true)
    try {
      await paymentsService.updatePlatformSettings({ recetaVigenciaDias: vigenciaDias })
      toast.success('Vigencia de la receta guardada')
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar la vigencia')
    } finally {
      setGuardandoVigencia(false)
    }
  }

  const agregarDroga = async (e) => {
    e.preventDefault()
    if (!nuevaDroga.droga.trim() || !nuevaDroga.motivo.trim()) return
    try {
      await pharmacyService.addDrogaBajoReceta(nuevaDroga)
      setDrogas(await pharmacyService.getDrogasBajoReceta())
      setNuevaDroga({ droga: '', tipo: 'receta_archivada', motivo: '' })
      toast.success('Agregada — el catálogo ya se reclasificó')
    } catch (err) {
      toast.error(err?.message || 'No se pudo agregar')
    }
  }

  const sacarDroga = async (droga) => {
    try {
      await pharmacyService.removeDrogaBajoReceta(droga)
      setDrogas(d => d.filter(x => x.droga !== droga))
      toast.success('Sacada de la lista. Los productos ya clasificados no bajan solos: se cambian desde el catálogo.')
    } catch (err) {
      toast.error(err?.message || 'No se pudo sacar')
    }
  }

  const paid = orders.filter(o => o.paymentStatus === 'pagado')
  const gmv = paid.reduce((s, o) => s + Number(o.total || 0), 0)
  const byStatus = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc }, {})

  if (loading) return <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Farmacia</h1>
        <p className="text-text-secondary mt-1">Visibilidad de pedidos de medicamentos y conexión de pago</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Pedidos</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{orders.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Pagados</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{paid.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">GMV</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{formatARS(gmv)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted uppercase font-semibold">Mercado Pago</p>
          <p className={`text-sm font-semibold mt-2 flex items-center gap-1.5 ${mpStatus?.connected ? 'text-emerald-600' : 'text-text-secondary'}`}>
            {mpStatus?.connected ? <><CheckCircle className="h-4 w-4" /> Conectado</> : 'No conectado'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {Object.entries(byStatus).map(([status, count]) => (
          <span key={status} className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-secondary text-text-secondary">
            {STATUS_LABEL[status] || status}: {count}
          </span>
        ))}
      </div>

      <div className="card space-y-5">
        <div>
          <h2 className="font-semibold text-text-primary">Recetas</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Cada receta sirve para una sola compra. La vigencia legal de la receta electrónica es de 30 días (Decreto 98/2023): se puede acortar, no alargar.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="form-label">Días de vigencia para comprar</label>
            <input
              type="number" min={1} max={30}
              value={vigenciaDias}
              onChange={e => setVigenciaDias(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="form-input w-32"
            />
          </div>
          <button type="button" onClick={guardarVigencia} disabled={guardandoVigencia} className="btn-primary">
            {guardandoVigencia ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text-primary">Drogas que nunca son venta libre</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Si el nombre de un producto las contiene, queda con receta aunque la farmacia lo cargue como venta libre. "Controlado" = receta archivada (psicotrópicos, antimicrobianos).
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {drogas.map(d => (
              <span key={d.droga} className="inline-flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1 py-1 rounded-full bg-bg-secondary text-text-secondary" title={d.motivo}>
                {d.tipo === 'receta_archivada' && <LockSimple className="w-3 h-3" />}
                {d.droga}
                <button onClick={() => sacarDroga(d.droga)} aria-label={`Sacar ${d.droga}`} className="p-1 rounded-full hover:bg-bg-surface-hover">
                  <Trash className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <form onSubmit={agregarDroga} className="flex gap-2 flex-wrap mt-3">
            <input className="form-input w-40" placeholder="droga" value={nuevaDroga.droga} onChange={e => setNuevaDroga(n => ({ ...n, droga: e.target.value }))} />
            <select className="form-select w-44" value={nuevaDroga.tipo} onChange={e => setNuevaDroga(n => ({ ...n, tipo: e.target.value }))}>
              <option value="receta_archivada">Controlado</option>
              <option value="receta">Con receta</option>
            </select>
            <input className="form-input flex-1 min-w-40" placeholder="motivo (ej. Ley 19.303)" value={nuevaDroga.motivo} onChange={e => setNuevaDroga(n => ({ ...n, motivo: e.target.value }))} />
            <button type="submit" className="btn-secondary">Agregar</button>
          </form>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {orders.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">Todavía no hay pedidos de medicamentos</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Pedido</th>
                <th className="table-header">Paciente</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Pago</th>
                <th className="table-header hidden sm:table-cell">Total</th>
                <th className="table-header hidden md:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 20).map(o => (
                <tr key={o.id} className="table-row">
                  <td className="table-cell font-mono text-xs text-text-secondary">#{o.id.slice(0, 8)}</td>
                  <td className="table-cell text-text-primary">{o.patient?.fullName || '—'}</td>
                  <td className="table-cell text-text-secondary">{STATUS_LABEL[o.status]}</td>
                  <td className="table-cell">
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${o.paymentStatus === 'pagado' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                      {o.paymentStatus === 'pagado' ? 'Pagado' : 'No pagado'}
                    </span>
                  </td>
                  <td className="table-cell hidden sm:table-cell">{formatARS(o.total)}</td>
                  <td className="table-cell hidden md:table-cell text-text-secondary">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
