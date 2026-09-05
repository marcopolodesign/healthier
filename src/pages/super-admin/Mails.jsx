import { useState, useEffect, useMemo } from 'react'
import {
  EnvelopeSimple, MagnifyingGlass, CircleNotch, CheckCircle, XCircle, WarningCircle, ArrowClockwise,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'

/**
 * Mails — /super-admin/mails
 *
 * Un renglón por mail que Healthier intentó mandar, con el motivo exacto cuando
 * Resend lo rechazó. El asiento lo escribe la Edge Function `send-email` en
 * `email_log` (migración 147).
 *
 * Por qué esta pantalla: hasta acá, un mail que no salía no dejaba rastro que
 * alguien fuera a mirar — el error vivía en los logs de Supabase. Es la misma
 * forma que tuvo el incidente de Mercado Pago de agosto: 18 días roto porque
 * la única señal estaba en un lugar donde nadie entra. Acá el fallo se ve.
 *
 * Es sólo lectura: no hay reenvío. Un mail transaccional se vuelve a disparar
 * arreglando lo que lo bloqueó (la clave, el dominio), no apretando un botón
 * que puede mandar el mismo aviso dos veces.
 */

const TIPOS = {
  'reserva':           'Turno confirmado',
  'ondemand':          'Consulta inmediata',
  'post-consulta':     'Resumen post-consulta',
  'recordatorio':      'Recordatorio de turno',
  'cancelada':         'Turno cancelado',
  'pedido-confirmado': 'Pedido de farmacia',
  'pedido-estado':     'Estado del pedido',
  'receta':            'Receta emitida',
  'bienvenida':        'Bienvenida',
  'pro-verificado':    'Profesional verificado',
  'pro-observado':     'Documentación observada',
}

const PAGE_SIZE = 200

export default function SuperAdminMails() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [tipoFilter, setTipoFilter] = useState('todos')
  const [estadoFilter, setEstadoFilter] = useState('todos')

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('email_log')
        .select('id, tipo, destinatario, asunto, estado, resend_id, error, created_at, consultation_id, order_id')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (error) throw error
      setRows(data ?? [])
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el registro de mails')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Las últimas 24 h son lo que importa: un circuito de mails no se rompe de a
  // poco, se corta. Un salto a cero acá es la señal.
  const resumen = useMemo(() => {
    const corte = Date.now() - 24 * 3600 * 1000
    const ultimas = rows.filter(r => new Date(r.created_at).getTime() >= corte)
    return {
      total: ultimas.length,
      enviados: ultimas.filter(r => r.estado === 'enviado').length,
      errores: ultimas.filter(r => r.estado === 'error').length,
      ultimo: rows[0]?.created_at ?? null,
    }
  }, [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (tipoFilter !== 'todos' && r.tipo !== tipoFilter) return false
    if (estadoFilter !== 'todos' && r.estado !== estadoFilter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return [r.destinatario, r.asunto, r.error].filter(Boolean).some(v => v.toLowerCase().includes(needle))
  }), [rows, tipoFilter, estadoFilter, query])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Mails</h1>
          <p className="text-text-secondary mt-1">
            Cada mail que la plataforma intentó mandar, con el motivo exacto cuando no salió.
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2 shrink-0" disabled={loading}>
          <ArrowClockwise className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Últimas 24 h */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Últimas 24 h" value={resumen.total} />
        <MetricCard label="Entregados a Resend" value={resumen.enviados} tone="ok" />
        <MetricCard label="Con error" value={resumen.errores} tone={resumen.errores > 0 ? 'bad' : 'neutral'} />
        <MetricCard label="Último mail" value={formatDate(resumen.ultimo)} small />
      </div>

      {resumen.errores > 0 && (
        <div className="card bg-danger-muted border-danger/30 flex items-start gap-3">
          <WarningCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" weight="fill" />
          <p className="text-sm text-text-primary">
            <strong>{resumen.errores} mail{resumen.errores === 1 ? '' : 'es'} sin salir en las últimas 24 h.</strong>{' '}
            El motivo está en la columna Error. El más común es el dominio del remitente sin verificar en Resend.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por destinatario, asunto o error…"
            className="form-input pl-9"
          />
        </div>
        <select className="form-select w-auto" value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPOS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <select className="form-select w-auto" value={estadoFilter} onChange={e => setEstadoFilter(e.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="enviado">Enviados</option>
          <option value="error">Con error</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <CircleNotch className="h-6 w-6 animate-spin text-brand" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <EnvelopeSimple className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin mails registrados</p>
          <p className="text-sm mt-1">
            El asiento se escribe cada vez que la plataforma manda un mail: turnos, consultas, recetas, farmacia.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Destinatario</th>
                <th className="px-4 py-3 font-semibold">Asunto</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-border-default last:border-0 align-top">
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap tabular-nums">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-text-primary whitespace-nowrap">{TIPOS[r.tipo] ?? r.tipo}</td>
                  <td className="px-4 py-3 text-text-secondary break-all">{r.destinatario}</td>
                  <td className="px-4 py-3 text-text-primary">{r.asunto}</td>
                  <td className="px-4 py-3">
                    {r.estado === 'enviado' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 whitespace-nowrap">
                        <CheckCircle className="h-4 w-4" weight="fill" /> Enviado
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger whitespace-nowrap">
                          <XCircle className="h-4 w-4" weight="fill" /> Error
                        </span>
                        {r.error && <p className="text-xs text-text-secondary max-w-md break-words">{r.error}</p>}
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
