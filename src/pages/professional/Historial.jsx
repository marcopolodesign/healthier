import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ClockCounterClockwise, MagnifyingGlass, Users, VideoCamera, MapPin, CaretRight } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

const STATUS_FILTERS = [
  { value: 'all',       label: 'Todas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
]

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function Historial({ profile }) {
  const [all, setAll]         = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByProfessional(profile.id)
      .then(data => {
        const now = new Date()
        const past = data.filter(c => {
          const isPast = c.scheduledAt && new Date(c.scheduledAt) < now
          const isTerminal = c.status === 'completed' || c.status === 'cancelled'
          return isTerminal || isPast
        })
        setAll(past)
      })
      .catch(() => toast.error('Error al cargar historial'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const visible = useMemo(() => {
    let list = all
    if (filter !== 'all') list = list.filter(c => c.status === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(c => {
        const name = (c.profiles?.fullName || c.profiles?.full_name || '').toLowerCase()
        return name.includes(q)
      })
    }
    return list
  }, [all, filter, search])

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Historial</h1>
        <p className="text-text-secondary mt-1">Tus consultas pasadas</p>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 p-1 bg-bg-surface rounded-xl border border-border-default">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-white text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar paciente..."
            className="form-input pl-9 text-sm w-full"
          />
        </div>
      </div>

      {/* ── List ── */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-bg-surface rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16">
            <ClockCounterClockwise className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="font-medium text-text-secondary">
              {search || filter !== 'all' ? 'Sin resultados' : 'No tenés consultas pasadas aún'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {visible.map(c => {
              const patientName = c.profiles?.fullName || c.profiles?.full_name || 'Paciente'
              const isVideo = c.modality === 'video'
              return (
                <li key={c.id}>
                  <Link
                    to={`/profesional/consulta/${c.id}`}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-bg-surface transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                      <Users className="h-5 w-5 text-brand" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm truncate group-hover:text-brand transition-colors">
                        {patientName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-secondary">{fmtDate(c.scheduledAt)}</span>
                        {c.scheduledAt && (
                          <span className="text-xs text-text-tertiary">{fmtTime(c.scheduledAt)}</span>
                        )}
                        <span className="flex items-center gap-0.5 text-xs text-text-tertiary">
                          {isVideo
                            ? <><VideoCamera className="h-3 w-3" /> VideoCamera</>
                            : <><MapPin className="h-3 w-3" /> Presencial</>
                          }
                        </span>
                      </div>
                    </div>

                    <StatusBadge status={c.status} />
                    <CaretRight className="h-4 w-4 text-text-tertiary shrink-0" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!loading && visible.length > 0 && (
        <p className="text-xs text-text-tertiary text-right">
          {visible.length} consulta{visible.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
