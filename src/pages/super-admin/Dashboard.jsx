import { useState, useEffect } from 'react'
import { Users, Calendar, Star, ShieldCheck } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { supabase, toCamelCase } from '../../lib/supabase'
import { toast } from '../../components/Toast'

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState({ users: 0, professionals: 0, consultations: 0, pendingVerification: 0 })
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [
          { count: users },
          { count: professionals },
          { count: consultations },
          { count: pending },
          { data: consByDay },
        ] = await Promise.all([
          supabase.from('profiles').select('*', { count: 'exact', head: true }),
          supabase.from('professional_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true),
          supabase.from('consultations').select('*', { count: 'exact', head: true }),
          supabase.from('professional_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', false),
          supabase.from('consultations').select('scheduled_at').order('scheduled_at', { ascending: false }).limit(100),
        ])

        setStats({ users, professionals, consultations, pendingVerification: pending })

        // Build chart data — consultations per day (last 7 days)
        const days = {}
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const key = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
          days[key] = 0
        }
        consByDay?.forEach(c => {
          if (!c.scheduled_at) return
          const key = new Date(c.scheduled_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
          if (key in days) days[key]++
        })
        setChartData(Object.entries(days).map(([date, count]) => ({ date, count })))
      } catch {
        toast.error('Error al cargar estadísticas')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const cards = [
    { label: 'Usuarios totales',       value: stats.users,               icon: Users,           color: 'text-brand bg-brand-muted' },
    { label: 'Profesionales activos',  value: stats.professionals,       icon: ShieldCheck,     color: 'text-purple-600 bg-purple-50' },
    { label: 'Consultas totales',      value: stats.consultations,       icon: Calendar,    color: 'text-blue-500 bg-blue-50' },
    { label: 'Pendientes verificación',value: stats.pendingVerification, icon: Star,            color: 'text-warning bg-yellow-50' },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Métricas generales de la plataforma</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-text-primary">{loading ? '—' : c.value?.toLocaleString()}</p>
            <p className="text-xs text-text-secondary mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Consultas (últimos 7 días)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip formatter={(v) => [v, 'Consultas']} />
            <Bar dataKey="count" fill="#0F7173" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
