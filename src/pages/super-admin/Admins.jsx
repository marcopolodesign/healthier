import { useState, useEffect } from 'react'
import { ShieldCheck, UserPlus, Trash } from '@phosphor-icons/react';
import { supabase, toCamelCase } from '../../lib/supabase'
import { adminService } from '../../services/adminService'
import { authService } from '../../services/authService'
import Modal from '../../components/Modal'
import { toast } from '../../components/Toast'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import BulkActionBar from '../../components/super-admin/BulkActionBar'
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog'

export default function SuperAdminAdmins() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ email: '', role: 'admin' })
  const [saving, setSaving] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)

  useEffect(() => { authService.getCurrentUser().then(u => setCurrentUserId(u?.id ?? null)) }, [])

  const load = () => {
    supabase.from('profiles').select('*').in('role', ['admin', 'super_admin']).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw error
        setAdmins(toCamelCase(data))
      })
      .catch(() => toast.error('Error al cargar administradores'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const promoteToAdmin = async () => {
    if (!form.email) return
    setSaving(true)
    try {
      await adminService.promoteUser(form.email, form.role)
      toast.success('Rol actualizado correctamente')
      setModalOpen(false)
      setForm({ email: '', role: 'admin' })
      load()
    } catch (err) {
      toast.error(err.message || 'Error al actualizar el rol')
    } finally {
      setSaving(false)
    }
  }

  const deletableAdmins = admins.filter(a => a.id !== currentUserId)
  const selection = useBulkSelection(deletableAdmins.map(a => a.id))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const deleteSelected = async (ids) => {
    setDeleting(true)
    try {
      await adminService.deleteProfiles(ids)
      setAdmins(prev => prev.filter(a => !ids.includes(a.id)))
      selection.clear()
      setConfirmOpen(false)
      toast.success(`${ids.length} administrador${ids.length === 1 ? '' : 'es'} eliminado${ids.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar')
    } finally {
      setDeleting(false)
    }
  }

  const ROLE_LABELS = { admin: 'Admin', super_admin: 'Super Admin' }
  const ROLE_COLORS = { admin: 'bg-yellow-100 text-yellow-700', super_admin: 'bg-red-100 text-red-700' }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Administradores</h1>
          <p className="text-text-secondary mt-1">{admins.length} administradores activos</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary text-sm flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          Agregar admin
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : admins.length === 0 ? (
          <div className="text-center py-12">
            <ShieldCheck className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No hay administradores</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-8">
                  <input type="checkbox" checked={selection.isAllSelected} onChange={selection.toggleAll} className="rounded border-border-default" />
                </th>
                <th className="table-header">Usuario</th>
                <th className="table-header">Rol</th>
                <th className="table-header hidden md:table-cell">Desde</th>
                <th className="table-header w-8" />
              </tr>
            </thead>
            <tbody>
              {admins.map(a => {
                const isSelf = a.id === currentUserId
                return (
                  <tr key={a.id} className="table-row">
                    <td className="table-cell">
                      {!isSelf && (
                        <input type="checkbox" checked={selection.isSelected(a.id)} onChange={() => selection.toggle(a.id)} className="rounded border-border-default" />
                      )}
                    </td>
                    <td className="table-cell">
                      <p className="font-medium text-text-primary">{a.fullName || '—'}{isSelf && <span className="text-xs text-text-tertiary font-normal"> (vos)</span>}</p>
                      <p className="text-xs text-text-secondary">{a.email}</p>
                    </td>
                    <td className="table-cell">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_COLORS[a.role] || ''}`}>
                        {ROLE_LABELS[a.role] || a.role}
                      </span>
                    </td>
                    <td className="table-cell hidden md:table-cell text-text-secondary">
                      {a.createdAt ? new Date(a.createdAt).toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="table-cell">
                      {!isSelf && (
                        <button onClick={() => { selection.toggle(a.id); setConfirmOpen(true) }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
                          <Trash className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} administrador${selection.count === 1 ? '' : 'es'}`}
        message="Esta acción no se puede deshacer."
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Asignar rol de administrador">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Ingresá el email de un usuario registrado para asignarle un rol.</p>
          <div>
            <label className="form-label">Email del usuario</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="form-input" placeholder="usuario@email.com" />
          </div>
          <div>
            <label className="form-label">Rol a asignar</label>
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className="form-select">
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={promoteToAdmin} disabled={saving || !form.email} className="btn-primary flex-1">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
