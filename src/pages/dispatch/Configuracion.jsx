import { useState, useEffect } from 'react'
import { Gear, Lock } from '@phosphor-icons/react'
import { dispatchService } from '../../services/dispatchService'
import { toast } from '../../components/Toast'

export default function DespachoConfiguracion({ profile }) {
  const [entidad, setEntidad] = useState(null)
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', legalName: '', phone: '', address: '', dispatchPhone: '', color: '#DC2626' })

  const isAdmin = profile?.role === 'emergency_admin' || profile?.role === 'super_admin'

  useEffect(() => {
    dispatchService.miEntidad().then(async e => {
      setEntidad(e)
      if (e) {
        setForm({
          name: e.name ?? '',
          legalName: e.legalName ?? '',
          phone: e.phone ?? '',
          address: e.address ?? '',
          dispatchPhone: e.dispatchPhone ?? '',
          color: e.color ?? '#DC2626',
        })
        try {
          setStaff(await dispatchService.listarStaff(e.id))
        } catch {
          toast.error('Error al cargar el equipo')
        }
      }
      setLoading(false)
    }).catch(() => { toast.error('Error al cargar la entidad'); setLoading(false) })
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin || !entidad) return
    setSaving(true)
    try {
      const updated = await dispatchService.actualizarEntidad(entidad.id, form)
      setEntidad(updated)
      toast.success('Configuración guardada')
    } catch (err) {
      toast.error(err?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 h-40 bg-bg-surface rounded-lg animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in max-w-xl">
      <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
        <Gear className="h-6 w-6 text-brand" /> Configuración
      </h1>

      {!isAdmin && (
        <div className="card flex items-center gap-2 text-text-secondary text-sm">
          <Lock className="h-4 w-4 shrink-0" /> Solo el Administrador puede editar estos datos.
        </div>
      )}

      <form onSubmit={save} className="card space-y-4">
        <h2 className="font-semibold text-text-primary">Datos de la entidad</h2>
        <div>
          <label className="form-label">Nombre</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Razón social</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.legalName}
            onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Teléfono</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Dirección</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Teléfono de guardia</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            placeholder="El que ve el paciente en un código ROJO"
            value={form.dispatchPhone}
            onChange={e => setForm(f => ({ ...f, dispatchPhone: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              disabled={!isAdmin}
              className="w-10 h-10 rounded-lg border border-border-default cursor-pointer disabled:cursor-not-allowed"
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            />
            <input
              className="form-input flex-1"
              disabled={!isAdmin}
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            />
          </div>
        </div>
        {isAdmin && (
          <button className="btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        )}
      </form>

      <div className="card space-y-3">
        <h2 className="font-semibold text-text-primary">Equipo</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-text-secondary">No hay staff registrado</p>
        ) : (
          <div className="space-y-2">
            {staff.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-text-primary font-medium">{s.profile?.fullName || '—'}</p>
                  <p className="text-text-secondary text-xs">{s.profile?.email}</p>
                </div>
                <span className="text-xs text-text-tertiary">{s.profile?.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
