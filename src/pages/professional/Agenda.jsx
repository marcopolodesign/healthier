import { useState, useEffect } from 'react'
import { BoltIcon, LinkIcon } from '@heroicons/react/24/outline'
import { professionalService } from '../../services/professionalService'
import CalendlyEmbed from '../../components/CalendlyEmbed'
import { toast } from '../../components/Toast'

export default function Agenda({ profile }) {
  const [profProfile, setProfProfile] = useState(null)
  const [form, setForm] = useState({ calendlyUrl: '', isOnDemand: false })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    professionalService.getByUserId(profile?.id)
      .then(p => {
        setProfProfile(p)
        if (p) setForm({ calendlyUrl: p.calendlyUrl || '', isOnDemand: p.isOnDemand || false })
      })
      .finally(() => setLoading(false))
  }, [profile?.id])

  const save = async () => {
    setSaving(true)
    try {
      await professionalService.upsert(profile.id, form)
      toast.success('Agenda actualizada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi agenda</h1>
        <p className="text-text-secondary mt-1">Configurá tu disponibilidad y link de Calendly</p>
      </div>

      <div className="card space-y-5">
        {/* On-demand toggle */}
        <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
              <BoltIcon className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="font-semibold text-text-primary">Consulta inmediata</p>
              <p className="text-sm text-text-secondary">Aparecés como disponible para consultas al instante</p>
            </div>
          </div>
          <button
            onClick={() => setForm(p => ({ ...p, isOnDemand: !p.isOnDemand }))}
            className={`w-12 h-7 rounded-full transition-colors relative ${form.isOnDemand ? 'bg-accent' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${form.isOnDemand ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Calendly URL */}
        <div>
          <label className="form-label flex items-center gap-1.5">
            <LinkIcon className="h-4 w-4" />
            Link de Calendly
          </label>
          <input
            type="url"
            value={form.calendlyUrl}
            onChange={e => setForm(p => ({ ...p, calendlyUrl: e.target.value }))}
            placeholder="https://calendly.com/tu-usuario"
            className="form-input"
          />
          <p className="text-xs text-text-tertiary mt-1">
            Los pacientes verán este calendario para agendar sus consultas.{' '}
            <a href="https://calendly.com" target="_blank" rel="noreferrer" className="text-brand hover:underline">Crear cuenta gratuita en Calendly</a>
          </p>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>

      {/* Preview */}
      {form.calendlyUrl && (
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">Vista previa de tu calendario</h2>
          <CalendlyEmbed url={form.calendlyUrl} height={500} />
        </div>
      )}
    </div>
  )
}
