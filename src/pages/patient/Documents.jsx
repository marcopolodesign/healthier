import { useState, useEffect } from 'react'
import { DocumentTextIcon, TrashIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { documentsService } from '../../services/documentsService'
import FileUpload from '../../components/FileUpload'
import Modal from '../../components/Modal'
import { toast } from '../../components/Toast'

export default function PatientDocuments({ profile }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [newFile, setNewFile] = useState(null)
  const [description, setDescription] = useState('')

  const load = async () => {
    if (!profile?.id) return
    try {
      const data = await documentsService.getByPatient(profile.id)
      setDocs(data)
    } catch {
      toast.error('Error al cargar documentos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [profile?.id])

  const handleUpload = async () => {
    if (!newFile) return
    setUploading(true)
    try {
      await documentsService.upload(profile.id, newFile, description)
      toast.success('Documento subido correctamente')
      setModalOpen(false)
      setNewFile(null)
      setDescription('')
      await load()
    } catch {
      toast.error('Error al subir el documento')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id, url) => {
    if (!confirm('¿Eliminar este documento?')) return
    try {
      await documentsService.delete(id, url)
      setDocs(prev => prev.filter(d => d.id !== id))
      toast.success('Documento eliminado')
    } catch {
      toast.error('Error al eliminar el documento')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Mis documentos</h1>
          <p className="text-text-secondary mt-1">Estudios, recetas y otros archivos médicos</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary text-sm">Subir documento</button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 card">
          <DocumentTextIcon className="h-12 w-12 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary">No tenés documentos guardados</p>
          <button onClick={() => setModalOpen(true)} className="btn-primary text-sm mt-4">Subir primer documento</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {docs.map(doc => (
            <div key={doc.id} className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <DocumentTextIcon className="h-5 w-5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary text-sm truncate">{doc.fileName}</p>
                {doc.description && <p className="text-xs text-text-secondary truncate">{doc.description}</p>}
                <p className="text-xs text-text-tertiary">{new Date(doc.createdAt).toLocaleDateString('es-AR')}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a href={doc.fileUrl} target="_blank" rel="noreferrer"
                   className="p-2 text-text-tertiary hover:text-brand transition-colors">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                </a>
                <button onClick={() => handleDelete(doc.id, doc.fileUrl)}
                        className="p-2 text-text-tertiary hover:text-error transition-colors">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Subir documento">
        <div className="space-y-4">
          <FileUpload onFile={setNewFile} accept=".pdf,.jpg,.jpeg,.png" label="Seleccioná tu archivo" hint="PDF, JPG o PNG · Máx. 10MB" />
          <div>
            <label className="form-label">Descripción (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ej: Análisis de sangre Mayo 2025"
              className="form-input"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleUpload} disabled={!newFile || uploading} className="btn-primary flex-1">
              {uploading ? 'Subiendo...' : 'Subir'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
