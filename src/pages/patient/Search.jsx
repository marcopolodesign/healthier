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

export default function MagnifyingGlass() {
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Buscar profesionales</h1>
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

          <div className="flex items-center gap-2 pb-0.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => handleFilter('onDemand', !filters.onDemand)}
                className={`w-10 h-6 rounded-full transition-colors relative ${filters.onDemand ? 'bg-brand' : 'bg-gray-300'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${filters.onDemand ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm text-text-primary flex items-center gap-1">
                <Lightning className="h-4 w-4 text-accent" />
                Disponible ahora
              </span>
            </label>
          </div>

          <button onClick={search} className="btn-primary flex items-center gap-2">
            <SearchIcon className="h-4 w-4" />
            Buscar
          </button>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-64 bg-bg-surface rounded-xl animate-pulse" />)}
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
            {results.map(p => <ProfessionalCard key={p.id} professional={p} />)}
          </div>
        </>
      )}
    </div>
  )
}
