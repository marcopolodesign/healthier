import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Users, MagnifyingGlass, CaretRight, User, VideoCamera, MapPin } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Pacientes({ profile }) {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByProfessional(profile.id)
      .then(setConsultations)
      .catch(() => toast.error('Error al cargar pacientes'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  // Deduplicate by patientId, keeping the most recent consultation per patient
  const patients = useMemo(() => {
    const map = new Map()
    for (const c of consultations) {
      const pid = c.patientId
      if (!pid) continue
      const existing = map.get(pid)
      if (!existing || new Date(c.scheduledAt) > new Date(existing.lastConsultation)) {
        map.set(pid, {
          id:               pid,
          fullName:         c.profiles?.fullName || c.profiles?.full_name || 'Paciente',
          email:            c.profiles?.email    || '',
          avatarUrl:        c.profiles?.avatarUrl || c.profiles?.avatar_url || null,
          lastConsultation: c.scheduledAt,
          lastModality:     c.modality,
          totalConsultations: 0,
        })
      }
    }
    // Count total consultations per patient
    for (const c of consultations) {
      if (c.patientId && map.has(c.patientId)) {
        map.get(c.patientId).totalConsultations++
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      new Date(b.lastConsultation) - new Date(a.lastConsultation)
    )
  }, [consultations])

  const visible = useMemo(() => {
    if (!search.trim()) return patients
    const q = search.trim().toLowerCase()
    return patients.filter(p =>
      p.fullName.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    )
  }, [patients, search])

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mis pacientes</h1>
        <p className="text-text-secondary mt-1">Todos los pacientes con los que tuviste consultas</p>
      </div>

      {/* MagnifyingGlass */}
      <div className="relative max-w-xs">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar paciente..."
          className="form-input pl-9 text-sm w-full"
        />
      </div>

      {/* List */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-bg-surface rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16">
            <Users className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="font-medium text-text-secondary">
              {search ? 'Sin resultados' : 'Aún no tenés pacientes'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {visible.map(p => (
              <li key={p.id}>
                <Link
                  to={`/profesional/paciente/${p.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-bg-surface transition-colors group"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {p.avatarUrl
                      ? <img src={p.avatarUrl} alt={p.fullName} className="w-full h-full object-cover" />
                      : <User className="h-5 w-5 text-brand" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary text-sm truncate group-hover:text-brand transition-colors">
                      {p.fullName}
                    </p>
                    {p.email && (
                      <p className="text-xs text-text-tertiary truncate">{p.email}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-text-secondary">
                        Última: {fmtDate(p.lastConsultation)}
                      </span>
                      <span className="text-xs text-text-tertiary">·</span>
                      <span className="flex items-center gap-0.5 text-xs text-text-tertiary">
                        {p.lastModality === 'video'
                          ? <><VideoCamera className="h-3 w-3" /> VideoCamera</>
                          : <><MapPin className="h-3 w-3" /> Presencial</>
                        }
                      </span>
                    </div>
                  </div>

                  {/* Count badge */}
                  <span className="text-xs font-semibold text-brand bg-brand-muted px-2 py-0.5 rounded-full shrink-0">
                    {p.totalConsultations} consulta{p.totalConsultations !== 1 ? 's' : ''}
                  </span>

                  <CaretRight className="h-4 w-4 text-text-tertiary shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && visible.length > 0 && (
        <p className="text-xs text-text-tertiary text-right">
          {visible.length} paciente{visible.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
