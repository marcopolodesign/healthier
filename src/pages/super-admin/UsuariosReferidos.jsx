import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShareNetwork } from '@phosphor-icons/react'
import { supabase, toCamelCase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'
import PacienteOnboardingDrawer from '../../components/super-admin/PacienteOnboardingDrawer'
import { esLead, entraEnEmbudo, CAMPOS_ONBOARDING, CONSULTA_VIGENTE } from '../../lib/pacienteOnboarding'

/**
 * Pacientes referidos (Mateo, 2026-10-26): los que llegaron por el link de un
 * profesional (`referred_by_professional_id`, migración 115). La contraparte de
 * Referidos de profesionales, que agrupa por profesional; acá es una fila por
 * paciente, con si terminó el registro (lead) y si ya consultó.
 */
export default function SuperAdminUsuariosReferidos() {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState(null)

  useEffect(() => {
    async function cargar() {
      try {
        const [pacientesRes, consultasRes] = await Promise.all([
          supabase
            .from('profiles')
            .select(`id, email, full_name, created_at, es_prueba, referred_by_professional_id, ${CAMPOS_ONBOARDING}`)
            .eq('role', 'patient')
            .not('referred_by_professional_id', 'is', null)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
          supabase.from('consultations').select('patient_id, status'),
        ])
        if (pacientesRes.error) throw pacientesRes.error
        if (consultasRes.error) throw consultasRes.error
        const consultas = {}
        const vigentes = new Set()
        for (const c of consultasRes.data || []) {
          consultas[c.patient_id] = (consultas[c.patient_id] || 0) + 1
          if (CONSULTA_VIGENTE.includes(c.status)) vigentes.add(c.patient_id)
        }
        // El nombre del profesional va en una segunda consulta: PostgREST no
        // resuelve el embed de profiles sobre sí misma por esta FK (PGRST200).
        const idsPro = [...new Set((pacientesRes.data || []).map(p => p.referred_by_professional_id))]
        const prosRes = idsPro.length
          ? await supabase.from('profiles').select('id, full_name, email').in('id', idsPro)
          : { data: [] }
        if (prosRes.error) throw prosRes.error
        const proPorId = new Map((prosRes.data || []).map(p => [p.id, p]))
        setFilas((pacientesRes.data || []).map(p => ({
          ...p,
          referente: proPorId.get(p.referred_by_professional_id) ?? null,
          _lead: esLead(toCamelCase(p)),
          _embudo: entraEnEmbudo(toCamelCase(p)),
          _vigente: vigentes.has(p.id),
          _consultas: consultas[p.id] || 0,
        })))
      } catch (err) {
        toast.error(err.message || 'No se pudieron cargar los referidos')
      } finally {
        setLoading(false)
      }
    }
    cargar()
  }, [])

  // Las métricas, como en Pacientes, sin cuentas de prueba; el % de leads sobre
  // los que pasaron por el wizard (los de antes no pueden ser lead).
  const reales = filas.filter(f => !f.es_prueba)
  const enEmbudo = reales.filter(f => f._embudo).length
  const leads = reales.filter(f => f._lead).length
  const conConsulta = reales.filter(f => f._vigente).length
  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Pacientes referidos</h1>
        <p className="text-text-secondary mt-1">{loading ? '…' : `${filas.length} llegaron por el link de un profesional`}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Referidos" value={loading ? '—' : reales.length} />
        <MetricCard label="Leads" value={loading ? '—' : leads} hint={loading ? '' : pct(leads, enEmbudo)} tone="ok" />
        <MetricCard label="Con consulta" value={loading ? '—' : conConsulta} hint={loading ? '' : pct(conConsulta, reales.length)} />
      </div>

      <div className="card">
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShareNetwork className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">Todavía no llegó ningún paciente por un link de referido</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Paciente</th>
                  <th className="table-header">Lo refirió</th>
                  <th className="table-header">Registro</th>
                  <th className="table-header">Lead</th>
                  <th className="table-header text-right">Consultas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.id} className="table-row cursor-pointer" onClick={() => setAbierto(f)}>
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[220px]">
                        {f.full_name || '—'}
                        {f.es_prueba && (
                          <span className="ml-1.5 align-middle rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Prueba</span>
                        )}
                      </p>
                      <p className="text-xs text-text-tertiary truncate max-w-[220px]">{f.email}</p>
                    </td>
                    <td className="table-cell">
                      <Link
                        to="/super-admin/profesionales/referidos"
                        onClick={e => e.stopPropagation()}
                        className="text-brand hover:underline truncate max-w-[200px] inline-block"
                      >
                        {f.referente?.full_name || f.referente?.email || '—'}
                      </Link>
                    </td>
                    <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(f.created_at)}</td>
                    <td className="table-cell">
                      {f._lead
                        ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800">Lead</span>
                        : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="table-cell text-right font-semibold">{f._consultas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {abierto && <PacienteOnboardingDrawer paciente={abierto} onClose={() => setAbierto(null)} />}
    </div>
  )
}
