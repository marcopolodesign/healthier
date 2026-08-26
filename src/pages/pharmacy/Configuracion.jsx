import { useState, useEffect } from 'react'
import { LinkSimple, Lock } from '@phosphor-icons/react'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import { pharmacyAdminService } from '../../services/pharmacyAdminService'
import { toast } from '../../components/Toast'

export default function PharmacyConfiguracion({ profile }) {
  const [pharmacy, setPharmacy] = useState(null)
  const [mpStatus, setMpStatus] = useState(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', phone: '', commissionRate: 0.2 })

  const isAdmin = profile?.role === 'pharmacy_admin' || profile?.role === 'super_admin'

  useEffect(() => {
    pharmacyAdminService.getPharmacy().then(p => {
      setPharmacy(p)
      setForm({ name: p.name ?? '', address: p.address ?? '', phone: p.phone ?? '', commissionRate: p.commissionRate ?? 0.2 })
    })
    pharmacyAdminService.getConnectionStatus().then(({ data }) => setMpStatus(data))
  }, [])

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar Mercado Pago? La farmacia no va a poder cobrar pedidos hasta reconectar.')) return
    setDisconnecting(true)
    const { error } = await pharmacyAdminService.disconnectMp()
    setDisconnecting(false)
    if (error) return toast.error('Error al desconectar')
    toast.success('Mercado Pago desconectado')
    setMpStatus({ connected: false })
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await pharmacyAdminService.updatePharmacy(form)
      setPharmacy(updated)
      toast.success('Configuración guardada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-text-primary">Configuración</h1>
        <div className="card text-center py-16">
          <Lock className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary">Solo el Administrador puede editar la configuración.</p>
        </div>
      </div>
    )
  }

  if (!pharmacy) return <div className="p-6 h-40 bg-bg-surface rounded-lg animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in max-w-xl">
      <h1 className="text-2xl font-bold text-text-primary">Configuración</h1>

      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold text-text-primary">Mercado Pago</h2>
          <p className="text-sm text-text-secondary mt-0.5">Los pedidos se cobran vía Mercado Pago y se liquidan directo a la cuenta de la farmacia.</p>
        </div>

        {mpStatus?.connected ? (
          <div className="flex items-center gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
            <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 flex items-center justify-center shrink-0">
              <MercadoPagoMark className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Mercado Pago conectado</p>
              <p className="text-xs text-text-secondary mt-0.5">Ya podés recibir pedidos y cobrarlos.</p>
            </div>
            <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="text-xs font-semibold text-red-600 hover:underline shrink-0 disabled:opacity-50">
              {disconnecting ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
            <div className="w-11 h-11 rounded-xl bg-white border border-red-200 flex items-center justify-center shrink-0">
              <MercadoPagoMark className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">No conectado</p>
              <p className="text-xs text-text-secondary mt-0.5">La farmacia no puede cobrar pedidos hasta conectar su cuenta.</p>
            </div>
            <a href={pharmacyAdminService.getMpConnectUrl()} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand px-3 py-2 rounded-full hover:bg-brand-hover transition-colors shrink-0">
              <LinkSimple className="h-3.5 w-3.5" /> Conectar
            </a>
          </div>
        )}
      </div>

      <form onSubmit={save} className="card space-y-4">
        <h2 className="font-semibold text-text-primary">Datos de la farmacia</h2>
        <div>
          <label className="form-label">Nombre</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Dirección</label>
          <input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Teléfono</label>
          <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Comisión Healthier (%)</label>
          <input
            className="form-input"
            type="number" step="0.01" min="0" max="1"
            value={form.commissionRate}
            onChange={e => setForm(f => ({ ...f, commissionRate: Number(e.target.value) }))}
          />
          <p className="text-xs text-text-secondary mt-1">Ej: 0.20 = 20% de comisión sobre cada pedido cobrado.</p>
        </div>
        <button className="btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
      </form>
    </div>
  )
}
