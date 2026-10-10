import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShareFat, CaretRight, User } from '@phosphor-icons/react'
import { derivacionesService, destinoLabel } from '../../services/derivacionesService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import DerivacionEstado from '../../components/DerivacionEstado'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'

const TABS = [
  { id: 'hechas', label: 'Hechas' },
  { id: 'recibidas', label: 'Recibidas' },
]

/**
 * Derivaciones del profesional: las que hizo y las que le hicieron a él con
 * nombre y apellido. Las que fueron a una vertical no le llegan hasta que el
 * paciente reserva (entonces aparecen en el turno como "Derivado por").
 */
export default function Derivaciones({ profile }) {
  const { porSlug } = useEspecialidades()
  const [tab, setTab] = useState('hechas')
  const [hechas, setHechas] = useState([])
  const [recibidas, setRecibidas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      derivacionesService.listarHechas(profile.id),
      derivacionesService.listarRecibidas(profile.id),
    ])
      .then(([h, r]) => { setHechas(h); setRecibidas(r) })
      .catch(err => toast.error(err?.message ?? 'Error al cargar las derivaciones'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const filas = tab === 'hechas' ? hechas : recibidas

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div>
        <h1 className="page-title">Derivaciones</h1>
        <p className="text-text-secondary mt-1">Pacientes que derivaste y pacientes que te derivaron</p>
      </div>

      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}{!loading && ` (${t.id === 'hechas' ? hechas.length : recibidas.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-bg-surface rounded-xl animate-pulse" />)}</div>
      ) : filas.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <ShareFat className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-text-secondary text-sm">
            {tab === 'hechas'
              ? 'Todavía no derivaste a ningún paciente. Podés hacerlo desde su ficha o desde la consulta.'
              : 'Todavía nadie te derivó un paciente.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filas.map(d => (
            <Link
              key={d.id}
              to={`/profesional/derivaciones/${d.id}`}
              className="card-hover flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
                {d.paciente?.avatarUrl
                  ? <img src={d.paciente.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : <User className="h-5 w-5 text-brand" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{d.paciente?.fullName ?? 'Paciente'}</p>
                <p className="text-xs text-text-secondary truncate">
                  {tab === 'hechas'
                    ? `A ${destinoLabel(d, porSlug)}`
                    : `De ${d.derivado?.fullName ?? 'otro profesional'}`}
                  {' · '}{formatDate(d.createdAt)}
                </p>
                <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{d.motivo}</p>
              </div>
              <DerivacionEstado derivacion={d} />
              <CaretRight className="h-4 w-4 text-text-tertiary shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
