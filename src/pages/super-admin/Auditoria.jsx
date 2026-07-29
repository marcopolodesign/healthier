import { useState, useEffect } from 'react'
import { Eye, PencilSimple, MagnifyingGlass, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'

/**
 * Auditoría de accesos a la historia clínica.
 *
 * Ley 26.529 Art. 14 (la HC tiene que poder decir quién accedió) y Ley 25.326
 * Art. 9 (medidas de seguridad sobre datos sensibles). El asiento lo escribe el
 * service layer en `clinical_access_log`; acá se lee.
 *
 * Muestra METADATOS: quién, qué tipo de recurso, sobre qué paciente, cuándo.
 * Nunca contenido clínico — el panel de administración no tiene por qué leer la
 * historia clínica de nadie para poder auditar quién la leyó.
 */

const ACTION_LABELS = {
  read:          { label: 'Consultó',   cls: 'bg-blue-100 text-blue-700',   Icon: Eye },
  create:        { label: 'Registró',   cls: 'bg-green-100 text-green-700', Icon: PencilSimple },
  update_status: { label: 'Cambió estado', cls: 'bg-amber-100 text-amber-700', Icon: PencilSimple },
  resolve:       { label: 'Resolvió',   cls: 'bg-amber-100 text-amber-700', Icon: PencilSimple },
  stop:          { label: 'Suspendió',  cls: 'bg-red-100 text-red-700',     Icon: PencilSimple },
}

const RESOURCE_LABELS = {
  encounter:   'Encuentro',
  entry:       'Nota clínica',
  condition:   'Diagnóstico',
  allergy:     'Alergia',
  observation: 'Signo vital',
  medication:  'Medicación',
}

const PAGE_SIZE = 100

export default function SuperAdminAuditoria() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [actionFilter, setActionFilter] = useState('todas')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('clinical_access_log')
        .select(`
          id, resource_type, resource_id, action, accessed_at, user_agent,
          accessor:profiles!accessed_by(id, full_name, role),
          patient:profiles!patient_id(id, full_name)
        `)
        .order('accessed_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (error) throw error
      setRows(data ?? [])
    } catch {
      toast.error('Error al cargar la auditoría')
    } finally {
      setLoading(false)
    }
  }

  const filtered = rows.filter(r => {
    if (actionFilter !== 'todas' && r.action !== actionFilter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return [r.accessor?.full_name, r.patient?.full_name, RESOURCE_LABELS[r.resource_type]]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(needle))
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Auditoría de historia clínica</h1>
        <p className="text-text-secondary mt-1">
          Quién accedió y quién escribió en la HC de cada paciente. Sólo metadatos — el contenido clínico no se expone acá.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por profesional o paciente…"
            className="form-input pl-9"
          />
        </div>
        <select className="form-select w-auto" value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="todas">Todas las acciones</option>
          {Object.entries(ACTION_LABELS).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <CircleNotch className="h-6 w-6 animate-spin text-brand" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <Eye className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin accesos registrados</p>
          <p className="text-sm mt-1">
            El asiento se escribe cuando un profesional abre o escribe una historia clínica.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Quién</th>
                <th className="px-4 py-3 font-semibold">Acción</th>
                <th className="px-4 py-3 font-semibold">Recurso</th>
                <th className="px-4 py-3 font-semibold">Paciente</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const a = ACTION_LABELS[r.action] ?? { label: r.action, cls: 'bg-gray-100 text-gray-700', Icon: Eye }
                return (
                  <tr key={r.id} className="border-b border-border-default last:border-0">
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {new Date(r.accessed_at).toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-text-primary font-medium">{r.accessor?.full_name ?? '—'}</span>
                      {r.accessor?.role && (
                        <span className="text-text-tertiary text-xs"> · {r.accessor.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${a.cls}`}>
                        <a.Icon className="h-3 w-3" /> {a.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {RESOURCE_LABELS[r.resource_type] ?? r.resource_type}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{r.patient?.full_name ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length === PAGE_SIZE && (
        <p className="text-xs text-text-tertiary text-center">
          Mostrando los últimos {PAGE_SIZE} accesos.
        </p>
      )}
    </div>
  )
}
