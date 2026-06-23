import { useState, useEffect } from 'react'
import { Users, Calendar, ShieldCheck, CurrencyDollar, Lightning, ClockCountdown, SealCheck, Star } from '@phosphor-icons/react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { SPECIALTY_LABELS } from '../../lib/verticals'

const STATUS_COLORS = { completed: '#7CB38B', confirmed: '#9B8EC4', pending: '#E8927C', cancelled: '#d1d5db', in_progress: '#60a5fa' }
const STATUS_LABELS = { completed: 'Completadas', confirmed: 'Confirmadas', pending: 'Pendientes', cancelled: 'Canceladas', in_progress: 'En curso' }

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState({ users: 0, professionals: 0, pendingVerification: 0, completedConsultations: 0, revenue: 0, walkInWaiting: 0, walkInAvailable: 0, avgRating: null, consultationsThisMonth: 0, newPatientsThisMonth: 0 })
  const [chartData, setChartData] = useState([])
  const [statusData, setStatusData] = useState([])
  const [topPros, setTopPros] = useState([])
  const [recentConsultations, setRecentConsultations] = useState([])
  const [allConsultations, setAllConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [chartDays, setChartDays] = useState(30)

  useEffect(() => {
    const load = async () => {
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

        const [
          { count: users },
          { count: professionals },
          { count: pending },
          { count: walkInWaiting },
          { count: walkInAvailable },
          { count: consultationsThisMonth },
          { count: newPatientsThisMonth },
          { data: consultations },
          { data: prosRaw },
          { data: reviews },
          { data: recentRaw },
        ] = await Promise.all([
          supabase.from('profiles').select('*', { count: 'exact', head: true }),
          supabase.from('professional_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true),
          supabase.from('professional_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', false),
          supabase.from('walk_in_queue').select('*', { count: 'exact', head: true }).eq('status', 'waiting'),
          supabase.from('professional_profiles').select('*', { count: 'exact', head: true }).eq('is_available_walkin', true),
          supabase.from('consultations').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'patient').gte('created_at', monthStart),
          supabase.from('consultations').select('id, status, scheduled_at, price_at_booking').order('scheduled_at', { ascending: false }).limit(500),
          supabase.from('professional_profiles').select('*, profiles(full_name)').eq('is_verified', true).order('average_rating', { ascending: false }).limit(5),
          supabase.from('reviews').select('rating'),
          supabase.from('consultations').select('id, status, scheduled_at, modality, profiles!patient_id(full_name), professional:profiles!professional_id(full_name)').order('created_at', { ascending: false }).limit(8),
        ])

        // Revenue: sum price_at_booking for completed consultations
        const completed = (consultations ?? []).filter(c => c.status === 'completed')
        const revenue = completed.reduce((acc, c) => acc + Number(c.price_at_booking || 0), 0)

        // Platform-wide average rating
        const allRatings = (reviews ?? []).map(r => Number(r.rating)).filter(r => !isNaN(r))
        const avgRating = allRatings.length > 0
          ? (allRatings.reduce((s, r) => s + r, 0) / allRatings.length).toFixed(1)
          : null

        setStats({
          users: users ?? 0,
          professionals: professionals ?? 0,
          pendingVerification: pending ?? 0,
          completedConsultations: completed.length,
          revenue,
          walkInWaiting: walkInWaiting ?? 0,
          walkInAvailable: walkInAvailable ?? 0,
          avgRating,
          consultationsThisMonth: consultationsThisMonth ?? 0,
          newPatientsThisMonth: newPatientsThisMonth ?? 0,
        })

        setRecentConsultations((recentRaw ?? []).map(c => ({
          id: c.id,
          patient: c.profiles?.full_name ?? '—',
          professional: c.professional?.full_name ?? '—',
          date: c.scheduled_at ? new Date(c.scheduled_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
          status: c.status,
          modality: c.modality,
        })))

        // Store raw consultations for chart re-rendering on period change
        setAllConsultations(consultations ?? [])
        buildChart(consultations ?? [], chartDays)

        // Status distribution
        const statusMap = {}
        ;(consultations ?? []).forEach(c => {
          statusMap[c.status] = (statusMap[c.status] || 0) + 1
        })
        setStatusData(Object.entries(statusMap).map(([name, value]) => ({
          name: STATUS_LABELS[name] ?? name, value, fill: STATUS_COLORS[name] ?? '#e5e7eb'
        })).sort((a, b) => b.value - a.value))

        // Top professionals
        setTopPros((prosRaw ?? []).map(p => ({
          name: p.profiles?.full_name ?? 'Sin nombre',
          specialty: SPECIALTY_LABELS[p.specialty] ?? p.specialty ?? '—',
          rating: p.average_rating ? Number(p.average_rating).toFixed(1) : '—',
          totalReviews: p.total_reviews ?? 0,
        })))
      } catch {
        toast.error('Error al cargar estadísticas')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (allConsultations.length > 0) buildChart(allConsultations, chartDays)
  }, [chartDays, allConsultations])

  function buildChart(consultations, days) {
    const map = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
      map[key] = 0
    }
    consultations.forEach(c => {
      if (!c.scheduled_at) return
      const key = new Date(c.scheduled_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
      if (key in map) map[key]++
    })
    setChartData(Object.entries(map).map(([date, count]) => ({ date, count })))
  }

  const cards = [
    { label: 'Usuarios totales',          value: stats.users,                                     icon: Users,          color: 'text-brand bg-brand-muted' },
    { label: 'Profesionales verificados', value: stats.professionals,                              icon: ShieldCheck,    color: 'text-purple-600 bg-purple-50' },
    { label: 'Consultas completadas',     value: stats.completedConsultations,                    icon: Calendar,       color: 'text-blue-600 bg-blue-50' },
    { label: 'Revenue estimado',          value: `$${stats.revenue.toLocaleString('es-AR')}`,    icon: CurrencyDollar, color: 'text-emerald-600 bg-emerald-50', raw: true },
    { label: 'Consultas este mes',        value: stats.consultationsThisMonth,                    icon: ClockCountdown, color: 'text-indigo-500 bg-indigo-50' },
    { label: 'Pacientes nuevos (mes)',    value: stats.newPatientsThisMonth,                      icon: Users,          color: 'text-teal-600 bg-teal-50' },
    { label: 'Pendientes verificación',   value: stats.pendingVerification,                       icon: SealCheck,      color: 'text-amber-600 bg-amber-50' },
    { label: 'Reseña promedio',           value: stats.avgRating != null ? `${stats.avgRating} ★` : '—', icon: Star, color: 'text-yellow-500 bg-yellow-50', raw: true },
    { label: 'Walk-in en espera',         value: stats.walkInWaiting,                             icon: Lightning,      color: 'text-orange-500 bg-orange-50' },
    { label: 'Disponibles walk-in',       value: stats.walkInAvailable,                           icon: Lightning,      color: 'text-green-600 bg-green-50' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Métricas generales de la plataforma</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-text-primary">
              {loading ? '—' : c.raw ? c.value : typeof c.value === 'number' ? c.value.toLocaleString() : c.value}
            </p>
            <p className="text-xs text-text-secondary mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Consultations per day */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-text-primary">Consultas por día</h2>
            <div className="flex gap-1">
              {[7, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setChartDays(d)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${chartDays === d ? 'bg-brand text-white' : 'bg-bg-primary text-text-tertiary hover:text-text-primary'}`}
                >{d}d</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Consultas']} />
              <Bar dataKey="count" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status distribution */}
        <div className="card flex flex-col">
          <h2 className="font-semibold text-text-primary mb-4">Estado de consultas</h2>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="45%" outerRadius={70} dataKey="value" paddingAngle={2}>
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v, n) => [v, n]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">Sin datos</div>
          )}
        </div>
      </div>

      {/* Top professionals */}
      {topPros.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">Top profesionales (por rating)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left py-2 pr-4 text-text-tertiary font-medium text-xs">Nombre</th>
                  <th className="text-left py-2 pr-4 text-text-tertiary font-medium text-xs">Especialidad</th>
                  <th className="text-right py-2 pr-4 text-text-tertiary font-medium text-xs">Rating</th>
                  <th className="text-right py-2 text-text-tertiary font-medium text-xs">Reseñas</th>
                </tr>
              </thead>
              <tbody>
                {topPros.map((p, i) => (
                  <tr key={i} className="border-b border-border-default/50 last:border-0 hover:bg-bg-primary/50">
                    <td className="py-2.5 pr-4 font-medium text-text-primary truncate max-w-[160px]">{p.name}</td>
                    <td className="py-2.5 pr-4 text-text-secondary">{p.specialty}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full text-[11px] font-bold">
                        ★ {p.rating}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-text-tertiary">{p.totalReviews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent consultations */}
      {recentConsultations.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">Consultas recientes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left py-2 pr-4 text-text-tertiary font-medium text-xs">Paciente</th>
                  <th className="text-left py-2 pr-4 text-text-tertiary font-medium text-xs">Profesional</th>
                  <th className="text-left py-2 pr-4 text-text-tertiary font-medium text-xs">Fecha</th>
                  <th className="text-left py-2 pr-2 text-text-tertiary font-medium text-xs">Modalidad</th>
                  <th className="text-left py-2 text-text-tertiary font-medium text-xs">Estado</th>
                </tr>
              </thead>
              <tbody>
                {recentConsultations.map((c) => (
                  <tr key={c.id} className="border-b border-border-default/50 last:border-0 hover:bg-bg-primary/50">
                    <td className="py-2.5 pr-4 font-medium text-text-primary truncate max-w-[140px]">{c.patient}</td>
                    <td className="py-2.5 pr-4 text-text-secondary truncate max-w-[140px]">{c.professional}</td>
                    <td className="py-2.5 pr-4 text-text-tertiary whitespace-nowrap">{c.date}</td>
                    <td className="py-2.5 pr-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${c.modality === 'video' ? 'bg-brand-muted text-brand' : 'bg-emerald-50 text-emerald-600'}`}>
                        {c.modality === 'video' ? 'Video' : 'Presencial'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] ? '' : ''}`} style={{ backgroundColor: (STATUS_COLORS[c.status] ?? '#e5e7eb') + '20', color: STATUS_COLORS[c.status] ?? '#6b7280' }}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
