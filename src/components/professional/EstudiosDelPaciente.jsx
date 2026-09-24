import { useEffect, useMemo, useState } from 'react'
import { CircleNotch, FileText } from '@phosphor-icons/react'
import { documentsService } from '../../services/documentsService'
import { FilaEstudio } from '../patient/EstudiosVault'
import {
  ESPECIALIDADES_ESTUDIO, SIN_ESPECIALIDAD, especialidadEstudioDelProfesional,
} from '../../lib/especialidadesEstudio'

const SIN = '__sin__'

/**
 * Los estudios que subió el paciente, vistos por el profesional (RLS
 * `docs_professional_select`, migración 174).
 *
 * Con `petId`: los de esa mascota (consulta veterinaria), sin filtro. Sin
 * `petId`: los del paciente (`category='analisis'`), con filtro por
 * especialidad que arranca en la del profesional si hay estudios de ella —
 * si no, en "Todas", para no mostrarle una lista vacía cuando hay cosas.
 */
export default function EstudiosDelPaciente({ patientId, petId = null, specialtyDelProfesional = null, onCount }) {
  const [docs, setDocs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState(null)

  useEffect(() => {
    if (!patientId) return
    setCargando(true)
    const opciones = petId ? { petId } : { category: 'analisis', soloPersonas: true }
    documentsService.getByPatient(patientId, opciones)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setCargando(false))
  }, [patientId, petId])

  useEffect(() => { onCount?.(docs.length) }, [docs.length, onCount])

  const propia = especialidadEstudioDelProfesional(specialtyDelProfesional)
  const filtroEfectivo = filtro ?? (propia && docs.some(d => d.especialidad === propia) ? propia : 'todas')

  const opciones = useMemo(() => {
    const conteo = id => docs.filter(d => (id === SIN ? !d.especialidad : d.especialidad === id)).length
    const base = ESPECIALIDADES_ESTUDIO.map(e => ({ id: e.id, label: e.label, n: conteo(e.id) }))
    const sin = conteo(SIN)
    return [
      { id: 'todas', label: 'Todas', n: docs.length },
      ...base.filter(o => o.n > 0 || o.id === propia),
      ...(sin > 0 ? [{ id: SIN, label: SIN_ESPECIALIDAD, n: sin }] : []),
    ]
  }, [docs, propia])

  const visibles = filtroEfectivo === 'todas'
    ? docs
    : docs.filter(d => (filtroEfectivo === SIN ? !d.especialidad : d.especialidad === filtroEfectivo))

  if (cargando) {
    return <div className="flex justify-center py-10"><CircleNotch size={24} className="animate-spin text-brand" /></div>
  }

  if (docs.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <FileText size={40} className="mx-auto mb-3 opacity-30" />
        <p className="font-medium">Sin estudios cargados</p>
        <p className="text-sm mt-1">{petId ? 'El dueño todavía no subió estudios de esta mascota.' : 'El paciente todavía no subió estudios.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!petId && (
        <div className="flex flex-wrap gap-2">
          {opciones.map(o => (
            <button
              key={o.id}
              onClick={() => setFiltro(o.id)}
              aria-pressed={filtroEfectivo === o.id}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filtroEfectivo === o.id
                ? 'bg-brand text-white border-brand'
                : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/60'}`}
            >
              {o.label}{o.id === propia ? ' · tu especialidad' : ''} ({o.n})
            </button>
          ))}
        </div>
      )}
      {visibles.length === 0 ? (
        <p className="text-sm text-text-secondary py-6 text-center">No hay estudios de esta especialidad.</p>
      ) : (
        visibles.map(doc => <FilaEstudio key={doc.id} doc={doc} conEspecialidad={!petId} />)
      )}
    </div>
  )
}
