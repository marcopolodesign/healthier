import { useState, useEffect } from 'react'
import { Eye, PencilSimple, MagnifyingGlass, CircleNotch, Copy, FilePdf, CheckCircle, XCircle } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'

/**
 * Auditoría. Dos solapas:
 *
 * 1. **Historia clínica** — Ley 26.529 Art. 14 (la HC tiene que poder decir
 *    quién accedió) y Ley 25.326 Art. 9 (medidas de seguridad sobre datos
 *    sensibles). El asiento lo escribe el service layer en `clinical_access_log`.
 *
 *    Muestra METADATOS: quién, qué tipo de recurso, sobre qué paciente, cuándo.
 *    Nunca contenido clínico — el panel de administración no tiene por qué leer
 *    la historia clínica de nadie para poder auditar quién la leyó.
 *
 * 2. **Recetas electrónicas** — un renglón por llamada al servicio de recetas
 *    (`rcta_issue_log`, migración 092), con el id de transacción del proveedor.
 *    Ese id es el que hay que copiar para certificar la integración y el único
 *    con el que se puede hablar de una receta puntual con ellos. Antes vivía en
 *    un .md escrito a mano.
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

const OUTCOME_LABELS = {
  issued:           { label: 'Emitida',           cls: 'bg-green-100 text-green-700', Icon: CheckCircle },
  validation_error: { label: 'Datos incompletos', cls: 'bg-amber-100 text-amber-700', Icon: XCircle },
  api_error:        { label: 'Rechazada',         cls: 'bg-red-100 text-red-700',     Icon: XCircle },
  network_error:    { label: 'Sin respuesta',     cls: 'bg-red-100 text-red-700',     Icon: XCircle },
  persist_error:    { label: 'Emitida sin guardar', cls: 'bg-red-100 text-red-700',   Icon: XCircle },
}

export default function SuperAdminAuditoria() {
  const [tab, setTab] = useState('hc')
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

  // ── Recetas electrónicas ──────────────────────────────────────────────────
  const [recetas, setRecetas] = useState([])
  const [loadingRecetas, setLoadingRecetas] = useState(false)

  useEffect(() => {
    if (tab !== 'recetas' || recetas.length || loadingRecetas) return
    ;(async () => {
      setLoadingRecetas(true)
      try {
        const { data, error } = await supabase
          .from('rcta_issue_log')
          .select('id, created_at, outcome, error_code, purpose, api_base_url, id_transaccion, id_receta, s3_link, http_status, request, patient:profiles!patient_id(full_name), professional:profiles!professional_id(full_name)')
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE)
        if (error) throw error
        setRecetas(data ?? [])
      } catch {
        toast.error('Error al cargar el log de recetas')
      } finally {
        setLoadingRecetas(false)
      }
    })()
  }, [tab, recetas.length, loadingRecetas])

  const copiar = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Copiado')
    } catch (err) {
      toast.error(`No se pudo copiar: ${err.message}`)
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
        <h1 className="text-2xl font-bold text-text-primary">Auditoría</h1>
        <p className="text-text-secondary mt-1">
          {tab === 'hc'
            ? 'Quién accedió y quién escribió en la HC de cada paciente. Sólo metadatos — el contenido clínico no se expone acá.'
            : 'Cada emisión de receta electrónica, con el id de transacción del proveedor.'}
        </p>
      </div>

      <div className="flex gap-6 border-b border-border-default">
        {[['hc', 'Historia clínica'], ['recetas', 'Recetas electrónicas']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`pb-3 -mb-px text-sm font-semibold border-b-2 transition-colors ${
              tab === v
                ? 'border-brand text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'recetas' ? (
        <RecetasTab recetas={recetas} loading={loadingRecetas} onCopiar={copiar} />
      ) : (
      <>
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
      </>
      )}
    </div>
  )
}

/**
 * El log de emisiones. `id de transacción` va primero y con botón de copiar
 * porque es lo que se pide desde afuera: para certificar la integración hay que
 * mandarlo, y para reclamar por una receta puntual también.
 */
function RecetasTab({ recetas, loading, onCopiar }) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <CircleNotch className="h-6 w-6 animate-spin text-brand" />
      </div>
    )
  }

  if (!recetas.length) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <FilePdf className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Todavía no se emitió ninguna receta electrónica</p>
        <p className="text-sm mt-1">El asiento se escribe en cada intento, salga bien o mal.</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-tertiary">
            <th className="px-4 py-3 font-semibold">Fecha</th>
            <th className="px-4 py-3 font-semibold">Resultado</th>
            <th className="px-4 py-3 font-semibold">Id de transacción</th>
            <th className="px-4 py-3 font-semibold">Nº de receta</th>
            <th className="px-4 py-3 font-semibold">Cobertura</th>
            <th className="px-4 py-3 font-semibold">Paciente</th>
            <th className="px-4 py-3 font-semibold">Profesional</th>
            <th className="px-4 py-3 font-semibold">PDF</th>
          </tr>
        </thead>
        <tbody>
          {recetas.map(r => {
            const o = OUTCOME_LABELS[r.outcome] ?? { label: r.outcome, cls: 'bg-gray-100 text-gray-700', Icon: XCircle }
            const cobertura = r.request?.paciente?.cobertura
            return (
              <tr key={r.id} className="border-b border-border-default last:border-0">
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {r.purpose === 'certificacion' && (
                    <span className="block text-[11px] text-text-tertiary">prueba de certificación</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${o.cls}`}>
                    <o.Icon className="h-3 w-3" /> {o.label}
                  </span>
                  {r.error_code && (
                    <span className="block text-[11px] text-text-tertiary mt-0.5">{r.error_code}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-primary whitespace-nowrap">
                  {r.id_transaccion ? (
                    <button
                      onClick={() => onCopiar(r.id_transaccion)}
                      className="inline-flex items-center gap-1.5 hover:text-brand transition-colors"
                      title="Copiar id de transacción"
                    >
                      {r.id_transaccion}
                      <Copy className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{r.id_receta ?? '—'}</td>
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                  {cobertura ? `Financiador ${cobertura.idFinanciador} · ${cobertura.numero}` : 'Particular'}
                </td>
                <td className="px-4 py-3 text-text-primary">{r.patient?.full_name ?? '—'}</td>
                <td className="px-4 py-3 text-text-secondary">{r.professional?.full_name ?? '—'}</td>
                <td className="px-4 py-3">
                  {r.s3_link ? (
                    <a href={r.s3_link} target="_blank" rel="noreferrer" className="text-brand hover:underline inline-flex items-center gap-1">
                      <FilePdf className="h-4 w-4" /> Ver
                    </a>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
