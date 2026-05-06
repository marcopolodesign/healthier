import { useState, useEffect } from 'react'
import { Search, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toCamelCase } from '../../lib/supabase'
import { toast } from '../../components/Toast'

const ROLE_LABELS = { patient: 'Paciente', professional: 'Profesional', admin: 'Admin', super_admin: 'Super Admin' }
const ROLE_COLORS = {
  patient:     'bg-blue-100 text-blue-700',
  professional:'bg-purple-100 text-purple-700',
  admin:       'bg-yellow-100 text-yellow-700',
  super_admin: 'bg-red-100 text-red-700',
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw error
        setUsers(toCamelCase(data))
      })
      .catch(() => toast.error('Error al cargar usuarios'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter(u =>
    u.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Usuarios</h1>
        <p className="text-text-secondary mt-1">{users.length} usuarios registrados</p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o email..."
          className="form-input pl-9"
        />
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">No se encontraron usuarios</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Usuario</th>
                <th className="table-header hidden sm:table-cell">Rol</th>
                <th className="table-header hidden md:table-cell">Registro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="table-row">
                  <td className="table-cell">
                    <div>
                      <p className="font-medium text-text-primary">{u.fullName || '—'}</p>
                      <p className="text-xs text-text-secondary">{u.email}</p>
                    </div>
                  </td>
                  <td className="table-cell hidden sm:table-cell">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  <td className="table-cell hidden md:table-cell text-text-secondary">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
