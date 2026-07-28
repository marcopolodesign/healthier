import { useState, useEffect } from 'react'
import { MagnifyingGlass as SearchIcon, Lightning, SlidersHorizontal } from '@phosphor-icons/react';
import { professionalService } from '../../services/professionalService'
import ProfessionalCard from '../../components/ProfessionalCard'
import { toast } from '../../components/Toast'

const SPECIALTIES = [
  { value: '', label: 'Todas las especialidades' },
  { value: 'medicina_general', label: 'Medicina General' },
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'psicologia', label: 'Psicología' },
  { value: 'entrenamiento', label: 'Entrenamiento Físico' },
  { value: 'cardiologia', label: 'Cardiología' },
  { value: 'dermatologia', label: 'Dermatología' },
  { value: 'otra', label: 'Otra' },
]

export default function PatientSearch() {
  const [filters, setFilters] = useState({ specialty: '', onDemand: false, minRating: 0 })
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    setLoading(true)
    setSearched(true)
    try {
      const data = await professionalService.search(filters)
      setResults(data)
    } catch {
      toast.error('Error al buscar profesionales')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { search() }, [])

  const handleFilter = (key, value) => {
    setFilters(p => ({ ...p, [key]: value }))
  }

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="page-title">Buscar profesionales</h1>
          <p className="text-text-secondary mt-1">Encontrá el especialista que necesitás</p>
        </div>

        {/* Filters */}
        <div className="card">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="form-label">Especialidad</label>
              <select
                value={filters.specialty}
                onChange={e => handleFilter('specialty', e.target.value)}
                className="form-select"
              >
                {SPECIALTIES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="min-w-[160px]">
              <label className="form-label">Calificación mínima</label>
              <select
                value={filters.minRating}
                onChange={e => handleFilter('minRating', Number(e.target.value))}
                className="form-select"
              >
                <option value={0}>Cualquier calificación</option>
                <option value={3}>3+ estrellas</option>
                <option value={4}>4+ estrellas</option>
                <option value={4.5}>4.5+ estrellas</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => handleFilter('onDemand', !filters.onDemand)}
              className={`flex items-center gap-1.5 px-6 py-3 rounded-full text-sm font-medium border transition-all ${
                filters.onDemand
                  ? 'bg-brand text-white border-brand hover:bg-brand-hover'
                  : 'bg-transparent text-text-primary border-border-default hover:bg-bg-surface hover:border-border-hover'
              }`}
            >
              <Lightning className={`h-4 w-4 ${filters.onDemand ? 'text-white' : 'text-accent'}`} />
              Disponible ahora
            </button>

            <button onClick={search} className="btn-primary flex items-center gap-2">
              <SearchIcon className="h-4 w-4" />
              Buscar
            </button>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-64 bg-bg-surface rounded-2xl border border-black/5 animate-pulse" />)}
          </div>
        ) : results.length === 0 && searched ? (
          <div className="text-center py-16 card">
            <SlidersHorizontal className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary font-medium">No encontramos profesionales con esos filtros</p>
            <p className="text-sm text-text-tertiary mt-1">Probá cambiando los criterios de búsqueda</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary">{results.length} profesional{results.length !== 1 ? 'es' : ''} encontrado{results.length !== 1 ? 's' : ''}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* La prop es `professional`, no `pro`: con `pro` el componente
                  destructuraba undefined y la página quedaba en blanco. Ojo que
                  hay DOS ProfessionalCard con APIs distintas —
                  `components/patient/` sí usa `pro`. Navega solo, no toma
                  `onSelect`. */}
              {results.map(p => (
                <ProfessionalCard key={p.id} professional={p} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
