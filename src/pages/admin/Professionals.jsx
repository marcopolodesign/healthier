import { useState, useEffect } from 'react'
import { ShieldCheckIcon, XMarkIcon, DocumentTextIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { professionalService } from '../../services/professionalService'
import { toast } from '../../components/Toast'

export default function AdminProfessionals() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [processing, setProcessing] = useState(false)

  const load = () => {
    setLoading(true)
    professionalService.getPendingVerification()
      .then(setPending)
      .catch(() => toast.error('Error al cargar profesionales'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const approve = async (userId) => {
    setProcessing(true)
    try {
      await professionalService.setVerified(userId, true, true)
      toast.success('Profesional aprobado correctamente')
      setPending(p => p.filter(x => x.userId !== userId))
      setSelected(null)
    } catch {
      toast.error('Error al aprobar')
    } finally {
      setProcessing(false)
    }
  }

  const reject = async (userId) => {
    setProcessing(true)
    try {
      await professionalService.setVerified(userId, false, false)
      toast.info('Profesional rechazado')
      setPending(p => p.filter(x => x.userId !== userId))
      setSelected(null)
    } catch {
      toast.error('Error al rechazar')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Cola de verificación</h1>
        <p className="text-text-secondary mt-1">{pending.length} profesionale{pending.length !== 1 ? 's' : ''} pendiente{pending.length !== 1 ? 's' : ''} de revisión</p>
      </div>

      <div className="flex gap-6">
        {/* List */}
        <div className="flex-1 min-w-0">
          <div className="card p-0 overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>
            ) : pending.length === 0 ? (
              <div className="text-center py-16">
                <ShieldCheckIcon className="h-12 w-12 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">No hay profesionales pendientes de verificación</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Profesional</th>
                    <th className="table-header hidden sm:table-cell">Especialidad</th>
                    <th className="table-header hidden md:table-cell">Enviado</th>
                    <th className="table-header">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(p => (
                    <tr key={p.id} className={`table-row cursor-pointer ${selected?.id === p.id ? 'bg-brand-muted' : ''}`} onClick={() => setSelected(p)}>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {p.profiles?.avatarUrl ? (
                            <img src={p.profiles.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-brand-muted flex items-center justify-center">
                              <UserCircleIcon className="h-5 w-5 text-brand" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-text-primary text-sm">{p.profiles?.fullName || p.profiles?.full_name}</p>
                            <p className="text-xs text-text-secondary">{p.profiles?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell hidden sm:table-cell capitalize">{p.specialty?.replace('_', ' ') || '—'}</td>
                      <td className="table-cell hidden md:table-cell text-text-secondary">
                        {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td className="table-cell">
                        <button className="text-sm text-brand hover:underline">Ver docs</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 shrink-0 space-y-4">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-text-primary">Documentación</h2>
                <button onClick={() => setSelected(null)} className="text-text-tertiary hover:text-text-primary">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="font-medium text-text-primary">{selected.profiles?.fullName || selected.profiles?.full_name}</p>
                <p className="text-sm text-text-secondary">{selected.bio}</p>

                {/* Document links */}
                {[
                  { label: 'Título profesional', url: selected.titleDocumentUrl },
                  { label: 'Matrícula',           url: selected.licenseDocumentUrl },
                  { label: 'DNI',                 url: selected.dniDocumentUrl },
                ].map(doc => (
                  doc.url && (
                    <div key={doc.label}>
                      <p className="text-xs font-medium text-text-secondary mb-1">{doc.label}</p>
                      <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 bg-bg-surface rounded-lg hover:bg-bg-surface-hover text-sm text-brand">
                        <DocumentTextIcon className="h-4 w-4" />
                        Ver documento
                      </a>
                    </div>
                  )
                ))}

                {selected.titleDocumentUrl && (
                  <iframe src={selected.titleDocumentUrl} className="w-full h-48 rounded-lg border border-border-default" title="Documento" />
                )}
              </div>

              <div className="mt-4 space-y-2">
                <div>
                  <label className="form-label text-xs">Nota (opcional)</label>
                  <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} placeholder="Motivo de rechazo..." className="form-textarea text-xs" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => reject(selected.userId)} disabled={processing} className="btn-danger flex-1 text-sm">Rechazar</button>
                  <button onClick={() => approve(selected.userId)} disabled={processing} className="btn-primary flex-1 text-sm">Aprobar</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
