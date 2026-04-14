import { useState } from 'react'
import { toast } from '../../components/Toast'

export default function SuperAdminSettings() {
  const [settings, setSettings] = useState({
    platformName: 'Healthier',
    supportEmail: 'soporte@healthier.ar',
    maintenanceMode: false,
    allowRegistrations: true,
  })
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setTimeout(() => {
      toast.success('Configuración guardada')
      setSaving(false)
    }, 800)
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Configuración de la plataforma</h1>
        <p className="text-text-secondary mt-1">Ajustes globales del sistema</p>
      </div>

      <form onSubmit={save} className="card space-y-5">
        <div>
          <label className="form-label">Nombre de la plataforma</label>
          <input type="text" value={settings.platformName} onChange={e => setSettings(p => ({ ...p, platformName: e.target.value }))} className="form-input" />
        </div>

        <div>
          <label className="form-label">Email de soporte</label>
          <input type="email" value={settings.supportEmail} onChange={e => setSettings(p => ({ ...p, supportEmail: e.target.value }))} className="form-input" />
        </div>

        <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg">
          <div>
            <p className="font-medium text-text-primary">Modo mantenimiento</p>
            <p className="text-sm text-text-secondary">Deshabilita el acceso público a la plataforma</p>
          </div>
          <button
            type="button"
            onClick={() => setSettings(p => ({ ...p, maintenanceMode: !p.maintenanceMode }))}
            className={`w-12 h-7 rounded-full transition-colors relative ${settings.maintenanceMode ? 'bg-error' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${settings.maintenanceMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg">
          <div>
            <p className="font-medium text-text-primary">Permitir registros</p>
            <p className="text-sm text-text-secondary">Habilita nuevos registros de usuarios</p>
          </div>
          <button
            type="button"
            onClick={() => setSettings(p => ({ ...p, allowRegistrations: !p.allowRegistrations }))}
            className={`w-12 h-7 rounded-full transition-colors relative ${settings.allowRegistrations ? 'bg-brand' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${settings.allowRegistrations ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </form>
    </div>
  )
}
