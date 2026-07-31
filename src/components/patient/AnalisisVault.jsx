import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pulse, Upload, CircleNotch, Sparkle, FileArrowDown, Trash, CheckCircle } from '@phosphor-icons/react'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import { estaAnalizado, ordenarPorFecha, fechaLarga } from '../../lib/biomarcadores'
import EstudioSearch from './EstudioSearch'
import SignedDocLink from '../SignedDocLink'
import { toast } from '../Toast'

/**
 * "Análisis" dentro de la Bóveda.
 *
 * Escribe en `diagnostic_reports` — la MISMA tabla que el BioVisor — y no en
 * `medical_documents`. Esa era la duplicación de fondo: había dos lugares para
 * subir el mismo PDF de laboratorio, con consecuencias distintas y sin que la
 * pantalla lo dijera. Un estudio subido a la Bóveda no aparecía en el BioVisor,
 * no se le extraía ningún valor, y —lo más grave— **el profesional no lo veía**,
 * porque la política que lo habilita (`professionals_read_patient_reports`) está
 * sobre `diagnostic_reports`.
 *
 * Con una sola tabla, subir acá y subir en el BioVisor son literalmente la misma
 * operación; lo único que cambia es desde qué pantalla la disparás.
 */
export default function AnalisisVault({ profile }) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [reports, setReports] = useState([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [estudio, setEstudio] = useState({ nombre: '', codigo: null })
  const [recienSubido, setRecienSubido] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile?.id) return
    diagnosticReportService.getByPatient(profile.id)
      .then(setReports)
      .catch(() => setError('No pudimos cargar tus análisis.'))
      .finally(() => setCargando(false))
  }, [profile?.id])

  async function handleFile(file) {
    if (!file) return
    setSubiendo(true)
    setProgreso(0)
    setError('')
    setRecienSubido(null)
    try {
      const guardado = await diagnosticReportService.subirEstudio({
        patientId: profile.id,
        file,
        studyType: estudio.nombre.trim() || null,
        practiceCode: estudio.codigo,
        onProgreso: setProgreso,
      })
      setReports(prev => [guardado, ...prev])
      setRecienSubido(guardado.id)
      setEstudio({ nombre: '', codigo: null })
      toast.success('Análisis guardado')
    } catch (err) {
      setError(err?.message || 'No pudimos subir el análisis. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSubiendo(false)
      setProgreso(0)
    }
  }

  async function handleDelete(id) {
    try {
      await diagnosticReportService.delete(id)
      setReports(prev => prev.filter(r => r.id !== id))
    } catch {
      toast.error('No pudimos borrar el análisis.')
    }
  }

  /** El análisis con IA no vive acá: la Bóveda guarda, el BioVisor interpreta. */
  const irAlBiovisor = id => navigate(`/paciente/biovisor${id ? `?estudio=${id}` : ''}`)

  const ordenados = ordenarPorFecha(reports)

  return (
    <div className="p-4 space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <p className="font-semibold text-text-primary text-[15px]">Subir un análisis</p>
          <p className="text-xs text-text-secondary mt-1">
            Queda guardado en tu historia y tu profesional puede verlo. Después, si querés,
            lo analizás en el BioVisor para extraer tus biomarcadores.
          </p>
        </div>

        <div>
          <label className="form-label text-xs">
            ¿Qué estudio es? <span className="normal-case font-normal text-text-tertiary">(opcional)</span>
          </label>
          <EstudioSearch value={estudio} onChange={setEstudio} disabled={subiendo} />
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={subiendo}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-brand/40 text-brand font-medium text-sm hover:bg-brand/5 transition-colors disabled:opacity-50"
        >
          {subiendo ? <CircleNotch size={16} className="animate-spin" /> : <Upload size={16} />}
          {subiendo ? `Subiendo… ${progreso}%` : 'Seleccionar PDF o imagen'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
      </div>

      {error && (
        <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-xl p-3">{error}</p>
      )}

      {/* Confirmación: el documento ya está OK y guardado. El siguiente paso es
          opcional y explícito, y sucede en la otra pantalla. */}
      {recienSubido && (
        <div className="card p-4 space-y-3 border-brand/40 bg-brand/5">
          <div className="flex items-start gap-3">
            <CheckCircle size={20} weight="fill" className="text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-text-primary text-sm">Análisis guardado</p>
              <p className="text-xs text-text-secondary mt-0.5">
                Tu profesional ya puede verlo en tu historia clínica.
              </p>
            </div>
          </div>
          <button
            onClick={() => irAlBiovisor(recienSubido)}
            className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
          >
            <Sparkle size={16} weight="fill" /> Analizar en BioVisor
          </button>
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-12">
          <CircleNotch size={28} className="animate-spin text-brand" />
        </div>
      ) : ordenados.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <Pulse size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Todavía no subiste ningún análisis</p>
          <p className="text-sm mt-1">Subí el PDF o una foto y queda en tu historia para siempre.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">
            Mis análisis ({ordenados.length})
          </p>
          {ordenados.map(r => {
            const analizado = estaAnalizado(r)
            return (
              <div key={r.id} className="card p-3 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                    <Pulse size={18} className="text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {r.studyType || 'Análisis'}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {fechaLarga(r.reportDate)}
                      {analizado ? ` · ${r.parameters.length} parámetros` : ' · sin analizar'}
                    </p>
                    {r.documentUrl && (
                      <SignedDocLink
                        bucket="patient-docs"
                        url={r.documentUrl}
                        className="text-xs text-brand font-medium hover:underline inline-flex items-center gap-1 mt-0.5"
                      >
                        <FileArrowDown size={13} /> Ver original
                      </SignedDocLink>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash size={15} />
                  </button>
                </div>

                <button
                  onClick={() => irAlBiovisor(r.id)}
                  className="w-full py-2.5 rounded-xl border border-brand/40 text-brand font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-brand/5 transition-colors"
                >
                  <Sparkle size={14} weight="fill" />
                  {analizado ? 'Ver en BioVisor' : 'Analizar en BioVisor'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
