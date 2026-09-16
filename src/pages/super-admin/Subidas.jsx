import { useState, useEffect, useMemo } from 'react'
import {
  UploadSimple, MagnifyingGlass, CircleNotch, CheckCircle, XCircle, WarningCircle, ArrowClockwise,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Subidas — /super-admin/subidas
 *
 * Un renglón por cada documento del legajo que un profesional intentó subir,
 * entrara o no, con el motivo del rechazo y cuánto pesaba. Lo escribe el
 * browser en `upload_log` (migración 162) — ver `services/uploadLogService.js`.
 *
 * Por qué esta pantalla: el 2026-09-16 Mateo preguntó cuántos profesionales
 * rebotan al subir un archivo y **no se podía contestar**. Los logs de Storage
 * duran pocos días, su 400 no dice el motivo, y los rechazos que se atajan en el
 * browser —vacío, ilegible, más de 10 MB— nunca llegan a la red. Andrea Romina
 * Garay hizo 32 intentos fallidos el 13/9 y no volvió nunca; nadie se enteró
 * hasta que se fue a buscar a mano.
 *
 * Es sólo lectura. Lo que se hace con un rechazo es escribirle al profesional,
 * no apretar un botón acá.
 */

const DOCUMENTOS = {
  titulo: 'Título',
  matricula: 'Matrícula',
  dni: 'DNI',
  seguro_mala_praxis: 'Seguro de mala praxis',
  certificado_especialista: 'Cert. de especialista',
  cuit: 'CUIT / Monotributo',
  avatar: 'Foto de perfil',
}

const MOTIVOS = {
  muy_grande: 'Pasa los 10 MB',
  vacio: 'Llegó vacío',
  ilegible: 'No se pudo leer',
  formato: 'Formato no aceptado',
  sesion: 'Sesión vencida',
  red: 'Se cortó la conexión',
  otro: 'Otro',
}

const PAGE_SIZE = 300

const mb = (bytes) => bytes == null ? '—' : `${(bytes / 1024 / 1024).toFixed(2)} MB`

export default function SuperAdminSubidas() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [estadoFilter, setEstadoFilter] = useState('todos')
  const [motivoFilter, setMotivoFilter] = useState('todos')

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('upload_log')
        .select('id, documento, bucket, estado, motivo, detalle, bytes, mime, created_at, usuario:profiles!usuario_id(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (error) throw error
      setRows(data ?? [])
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el registro de subidas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Los últimos 7 días y no 24 h como en Mails: acá el volumen es bajo (unas
  // pocas altas por día), y en una ventana de un día el porcentaje salta por
  // nada.
  const resumen = useMemo(() => {
    const corte = Date.now() - 7 * 24 * 3600 * 1000
    const ultimas = rows.filter(r => new Date(r.created_at).getTime() >= corte)
    const rechazadas = ultimas.filter(r => r.estado === 'rechazado')
    const pesos = ultimas.filter(r => r.bytes != null).map(r => r.bytes).sort((a, b) => a - b)
    return {
      total: ultimas.length,
      ok: ultimas.length - rechazadas.length,
      rechazadas: rechazadas.length,
      // A quién le rebotó, que es el número que importa: una persona con 32
      // intentos no son 32 problemas, es uno.
      personas: new Set(rechazadas.map(r => r.usuario?.email).filter(Boolean)).size,
      mediana: pesos.length ? pesos[Math.floor(pesos.length / 2)] : null,
    }
  }, [rows])

  const porMotivo = useMemo(() => {
    const c = {}
    rows.filter(r => r.estado === 'rechazado').forEach(r => {
      const k = r.motivo || 'otro'
      c[k] = (c[k] || 0) + 1
    })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (estadoFilter !== 'todos' && r.estado !== estadoFilter) return false
    if (motivoFilter !== 'todos' && (r.motivo || 'otro') !== motivoFilter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return [r.usuario?.full_name, r.usuario?.email, r.detalle, r.documento]
      .filter(Boolean).some(v => v.toLowerCase().includes(needle))
  }), [rows, estadoFilter, motivoFilter, query])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Subidas del legajo</h1>
          <p className="text-text-secondary mt-1">
            Cada documento que un profesional intentó subir, con el motivo cuando le rebotó.
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2 shrink-0" disabled={loading}>
          <ArrowClockwise className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label="Últimos 7 días" value={resumen.total} />
        <MetricCard label="Entraron" value={resumen.ok} tone="ok" />
        <MetricCard label="Rebotaron" value={resumen.rechazadas} tone={resumen.rechazadas > 0 ? 'bad' : 'neutral'} />
        <MetricCard label="Profesionales afectados" value={resumen.personas} tone={resumen.personas > 0 ? 'bad' : 'neutral'} />
        <MetricCard label="Peso mediano" value={mb(resumen.mediana)} small />
      </div>

      {resumen.personas > 0 && (
        <div className="card bg-danger-muted border-danger/30 flex items-start gap-3">
          <WarningCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" weight="fill" />
          <p className="text-sm text-text-primary">
            <strong>
              A {resumen.personas} profesional{resumen.personas === 1 ? '' : 'es'} le rebotó un documento esta semana.
            </strong>{' '}
            Vale la pena escribirles: el que rebota varias veces seguidas suele abandonar el alta y no vuelve.
          </p>
        </div>
      )}

      {porMotivo.length > 0 && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-text-tertiary font-semibold mb-3">Por qué rebotan</p>
          <div className="flex flex-wrap gap-2">
            {porMotivo.map(([m, n]) => (
              <button
                key={m}
                onClick={() => { setMotivoFilter(m); setEstadoFilter('rechazado') }}
                className="px-3 py-1.5 rounded-full border border-border-default text-sm hover:border-brand transition-colors"
              >
                {MOTIVOS[m] ?? m} <span className="font-semibold text-text-primary">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por profesional, documento o motivo…"
            className="form-input pl-9"
          />
        </div>
        <select className="form-select w-auto" value={estadoFilter} onChange={e => setEstadoFilter(e.target.value)}>
          <option value="todos">Todas</option>
          <option value="ok">Las que entraron</option>
          <option value="rechazado">Las que rebotaron</option>
        </select>
        <select className="form-select w-auto" value={motivoFilter} onChange={e => setMotivoFilter(e.target.value)}>
          <option value="todos">Todos los motivos</option>
          {Object.entries(MOTIVOS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <CircleNotch className="h-6 w-6 animate-spin text-brand" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <UploadSimple className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin subidas registradas</p>
          <p className="text-sm mt-1">
            El asiento se escribe cada vez que un profesional elige un documento en el alta.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Profesional</th>
                <th className="px-4 py-3 font-semibold">Documento</th>
                <th className="px-4 py-3 font-semibold">Peso</th>
                <th className="px-4 py-3 font-semibold">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-border-default last:border-0 align-top">
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap tabular-nums">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="text-text-primary">{r.usuario?.full_name ?? '—'}</p>
                    <p className="text-xs text-text-secondary break-all">{r.usuario?.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-primary whitespace-nowrap">{DOCUMENTOS[r.documento] ?? r.documento}</td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap tabular-nums">{mb(r.bytes)}</td>
                  <td className="px-4 py-3">
                    {r.estado === 'ok' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 whitespace-nowrap">
                        <CheckCircle className="h-4 w-4" weight="fill" /> Entró
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger whitespace-nowrap">
                          <XCircle className="h-4 w-4" weight="fill" /> {MOTIVOS[r.motivo] ?? 'Rebotó'}
                        </span>
                        {r.detalle && <p className="text-xs text-text-secondary max-w-md break-words">{r.detalle}</p>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
