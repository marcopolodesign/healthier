import { useState, useEffect, useRef } from 'react'
import { Upload, CircleNotch, FileArrowDown, Trash, FileText, X } from '@phosphor-icons/react'
import { documentsService, nombreDeDocumento } from '../../services/documentsService'
import { ESPECIALIDADES_ESTUDIO, labelEspecialidadEstudio, tituloPorDefecto } from '../../lib/especialidadesEstudio'
import SignedDocLink from '../SignedDocLink'
import { toast } from '../Toast'

/**
 * Estudios que sube el paciente a `medical_documents` (migración 174).
 *
 * Dos usos, mismo circuito:
 *  - "Análisis" de la Bóveda (`category='analisis'`, `conEspecialidad`): el
 *    paciente elige a qué especialidad corresponde y le pone nombre, para que
 *    el profesional los filtre (comentario de Nacho, 2026-09-24).
 *  - Los estudios de una mascota (`category='veterinaria'`, `petId`).
 *
 * Primero se elige el archivo y recién después se confirma con nombre y
 * especialidad: el nombre por defecto sale del archivo, así que pedirlo antes
 * sería hacerle tipear algo que todavía no sabemos.
 */
export default function EstudiosVault({ patientId, category, petId = null, conEspecialidad = false, vacio }) {
  const fileInputRef = useRef(null)
  const [docs, setDocs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [archivo, setArchivo] = useState(null)
  const [titulo, setTitulo] = useState('')
  const [especialidad, setEspecialidad] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!patientId) return
    setCargando(true)
    documentsService.getByPatient(patientId, { category, petId, soloPersonas: !petId })
      .then(setDocs)
      .catch(() => setError('No pudimos cargar tus estudios.'))
      .finally(() => setCargando(false))
  }, [patientId, category, petId])

  function elegir(file) {
    if (!file) return
    setArchivo(file)
    setTitulo(tituloPorDefecto(file.name))
    setError('')
  }

  function cancelar() {
    setArchivo(null)
    setTitulo('')
    setEspecialidad('')
  }

  const faltaEspecialidad = conEspecialidad && !especialidad
  const puedeGuardar = archivo && titulo.trim() && !faltaEspecialidad && !subiendo

  async function guardar() {
    if (!puedeGuardar) return
    setSubiendo(true)
    setProgreso(0)
    setError('')
    try {
      const doc = await documentsService.upload({
        patientId,
        file: archivo,
        category,
        especialidad: conEspecialidad ? especialidad : null,
        titulo,
        petId,
        onProgreso: setProgreso,
      })
      setDocs(prev => [doc, ...prev])
      cancelar()
      toast.success('Estudio guardado')
    } catch (err) {
      setError(err?.message || 'No pudimos subir el estudio. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSubiendo(false)
    }
  }

  async function borrar(doc) {
    try {
      await documentsService.delete(doc)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
    } catch {
      toast.error('No pudimos borrar el estudio.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        {!archivo ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-brand/40 text-brand font-medium text-sm hover:bg-brand/5 transition-colors"
          >
            <Upload size={16} /> Seleccionar PDF o imagen
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <FileText size={16} className="text-brand shrink-0" />
              <span className="truncate flex-1">{archivo.name}</span>
              {!subiendo && (
                <button onClick={cancelar} aria-label="Elegir otro archivo" className="p-1 rounded-lg hover:bg-bg-surface">
                  <X size={14} />
                </button>
              )}
            </div>

            <div>
              <label className="form-label text-xs" htmlFor="titulo-estudio">Nombre del estudio</label>
              <input
                id="titulo-estudio"
                className="form-input"
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                disabled={subiendo}
                placeholder="Ej: Radiografía de rodilla"
              />
            </div>

            {conEspecialidad && (
              <div>
                <p className="form-label text-xs">¿De qué especialidad es?</p>
                <div className="flex flex-wrap gap-2">
                  {ESPECIALIDADES_ESTUDIO.map(e => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEspecialidad(e.id)}
                      disabled={subiendo}
                      aria-pressed={especialidad === e.id}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${especialidad === e.id
                        ? 'bg-brand text-white border-brand'
                        : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/60'}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={guardar}
              disabled={!puedeGuardar}
              className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {subiendo ? <><CircleNotch size={16} className="animate-spin" /> Subiendo… {progreso}%</> : 'Guardar estudio'}
            </button>
            {faltaEspecialidad && (
              <p className="text-[11px] text-text-tertiary text-center">Elegí la especialidad para guardarlo.</p>
            )}
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={e => { elegir(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>

      {error && (
        <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-xl p-3">{error}</p>
      )}

      {cargando ? (
        <div className="flex justify-center py-10">
          <CircleNotch size={28} className="animate-spin text-brand" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-text-secondary">
          <FileText size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm">{vacio || 'Todavía no subiste ningún estudio'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
            Estudios ({docs.length})
          </p>
          {docs.map(doc => <FilaEstudio key={doc.id} doc={doc} conEspecialidad={conEspecialidad} onBorrar={() => borrar(doc)} />)}
        </div>
      )}
    </div>
  )
}

/** "24 de septiembre de 2026" desde un timestamp de carga. */
function fechaDeCarga(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Una fila: título, chip de especialidad, fecha de carga y el archivo. La reusa el profesional. */
export function FilaEstudio({ doc, conEspecialidad = true, onBorrar }) {
  return (
    <div className="card p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
        <FileText size={18} className="text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{nombreDeDocumento(doc)}</p>
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-0.5">
          {conEspecialidad && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${doc.especialidad
              ? 'bg-brand/10 text-brand'
              : 'bg-bg-surface text-text-tertiary'}`}
            >
              {labelEspecialidadEstudio(doc.especialidad)}
            </span>
          )}
          <span className="text-xs text-text-secondary">Subido el {fechaDeCarga(doc.createdAt)}</span>
        </div>
        <SignedDocLink
          bucket="patient-docs"
          url={doc.fileUrl}
          className="text-xs text-brand font-medium hover:underline inline-flex items-center gap-1 mt-0.5"
        >
          <FileArrowDown size={13} /> Ver archivo
        </SignedDocLink>
      </div>
      {onBorrar && (
        <button
          onClick={onBorrar}
          aria-label="Borrar estudio"
          className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash size={15} />
        </button>
      )}
    </div>
  )
}
