import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, DownloadSimple, Stethoscope, Pill, Warning,
  Heartbeat, ClipboardText, CircleNotch, Heart,
} from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'

const ENTRY_TYPE_LABEL = {
  soap_subjective: 'Subjetivo',
  soap_objective: 'Objetivo',
  soap_assessment: 'Diagnóstico',
  soap_plan: 'Plan',
  evolution: 'Evolución',
  order: 'Orden de estudios',
  prescription: 'Receta',
  free_text: 'Nota',
}

const MED_STATUS_LABEL = {
  active: 'Activo',
  completed: 'Completado',
  stopped: 'Suspendido',
}

const CONDITION_STATUS_LABEL = {
  active: 'Activo',
  resolved: 'Resuelto',
  chronic: 'Crónico',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function AllergyChip({ allergy }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-[12px] font-semibold">
      <Warning className="w-3.5 h-3.5 flex-shrink-0" />
      {allergy.allergen}{allergy.severity ? ` (${allergy.severity})` : ''}
    </span>
  )
}

function EncounterCard({ encounter }) {
  const [open, setOpen] = useState(false)
  const prof = encounter.professional
  const profName = prof?.full_name || 'Profesional'
  const specialty = prof?.professional_profiles?.[0]?.specialty || encounter.specialty || ''

  return (
    <div className="bg-white rounded-[20px] border border-gray-100 shadow-sm overflow-hidden encounter-card">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-start justify-between text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#F0F7F3] flex items-center justify-center flex-shrink-0 mt-0.5">
            <Stethoscope className="w-5 h-5 text-[#7CB38B]" />
          </div>
          <div>
            <p className="font-black text-[15px] text-gray-900 leading-tight">{formatDate(encounter.createdAt)}</p>
            <p className="text-[13px] text-gray-500 font-medium mt-0.5">{profName}{specialty ? ` · ${specialty}` : ''}</p>
          </div>
        </div>
        <div className="text-gray-300 mt-1">
          <svg className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Detail — expandable */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4 encounter-detail">
          {/* SOAP entries */}
          {encounter.entries?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <ClipboardText className="w-3.5 h-3.5" /> Notas clínicas
              </p>
              <div className="space-y-2">
                {encounter.entries.map(entry => (
                  <div key={entry.id} className="bg-gray-50 rounded-[12px] p-3">
                    {entry.entryType && entry.entryType !== 'free_text' && (
                      <span className="inline-block text-[10px] font-bold text-[#7CB38B] uppercase tracking-wider mb-1">
                        {ENTRY_TYPE_LABEL[entry.entryType] || entry.entryType}
                      </span>
                    )}
                    <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                    {entry.icdCode && (
                      <p className="text-[11px] text-gray-400 font-medium mt-1.5">CIE-10: {entry.icdCode}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conditions */}
          {encounter.conditions?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Heartbeat className="w-3.5 h-3.5" /> Diagnósticos
              </p>
              <div className="space-y-2">
                {encounter.conditions.map(c => (
                  <div key={c.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-[12px] px-3 py-2">
                    <div>
                      <p className="text-[13px] font-semibold text-gray-800">{c.display}</p>
                      {c.icdCode && <p className="text-[11px] text-gray-400 font-medium mt-0.5">CIE-10: {c.icdCode}</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${
                      c.clinicalStatus === 'active' ? 'bg-orange-100 text-orange-700'
                      : c.clinicalStatus === 'chronic' ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                    }`}>
                      {CONDITION_STATUS_LABEL[c.clinicalStatus] || c.clinicalStatus}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Medications */}
          {encounter.medications?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Pill className="w-3.5 h-3.5" /> Medicamentos
              </p>
              <div className="space-y-2">
                {encounter.medications.map(m => (
                  <div key={m.id} className="bg-gray-50 rounded-[12px] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-gray-800">{m.medicationName}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        m.status === 'active' ? 'bg-[#F0F7F3] text-[#7CB38B]'
                        : m.status === 'stopped' ? 'bg-red-50 text-red-600'
                        : 'bg-gray-100 text-gray-500'
                      }`}>
                        {MED_STATUS_LABEL[m.status] || m.status}
                      </span>
                    </div>
                    {m.dosage && <p className="text-[12px] text-gray-500 mt-0.5">{m.dosage}{m.frequency ? ` · ${m.frequency}` : ''}</p>}
                    {m.instructions && <p className="text-[12px] text-gray-500 italic mt-0.5">{m.instructions}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!encounter.entries?.length && !encounter.conditions?.length && !encounter.medications?.length && (
            <p className="text-[13px] text-gray-400 text-center py-2">Sin registros para esta consulta.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function HistoriaClinicaPaciente({ profile }) {
  const navigate = useNavigate()
  const [timeline, setTimeline] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    historiaClinicaService.getPatientTimeline(profile.id)
      .then(setTimeline)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [profile?.id])

  const handleDownload = () => window.print()

  return (
    <>
      {/* Print-only header */}
      <div className="hidden print:block print:mb-6">
        <h1 className="text-2xl font-black text-gray-900">Historia Clínica</h1>
        <p className="text-sm text-gray-500 mt-1">
          {profile?.full_name || 'Paciente'} · Healthier · Impreso {new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
        <hr className="mt-4 border-gray-300" />
      </div>

      <div className="absolute inset-0 bg-bg-primary overflow-y-auto pb-32 print:static print:overflow-visible print:pb-0 print:bg-white">
        {/* Header bar */}
        <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-6 pt-8 pb-4 flex items-center justify-between print:hidden">
          <button
            onClick={() => navigate('/paciente/documentos')}
            className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="font-black text-[17px] text-gray-900">Historia Clínica</h1>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 bg-[#7CB38B] text-white text-[13px] font-bold px-4 py-2 rounded-full shadow-sm hover:bg-[#5f9470] active:scale-95 transition-all"
          >
            <DownloadSimple className="w-4 h-4" />
            Descargar
          </button>
        </div>

        <div className="px-6 pt-5 pb-4 print:px-0 print:pt-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <CircleNotch className="w-8 h-8 text-[#7CB38B] animate-spin" />
              <p className="text-[14px] text-gray-500 font-medium">Cargando tu historia clínica…</p>
            </div>
          ) : (
            <>
              {/* Active allergies */}
              {timeline?.allergies?.length > 0 && (
                <div className="mb-5">
                  <p className="text-[12px] font-bold text-red-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Warning className="w-3.5 h-3.5" /> Alergias activas
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {timeline.allergies.map(a => <AllergyChip key={a.id} allergy={a} />)}
                  </div>
                </div>
              )}

              {/* Encounter timeline */}
              {timeline?.encounters?.length > 0 ? (
                <div>
                  <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5" /> Consultas ({timeline.encounters.length})
                  </p>
                  <div className="space-y-3">
                    {timeline.encounters.map(enc => (
                      <EncounterCard key={enc.id} encounter={enc} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                  <div className="w-16 h-16 rounded-full bg-[#F0F7F3] flex items-center justify-center">
                    <Heart className="w-8 h-8 text-[#7CB38B]" />
                  </div>
                  <div>
                    <p className="font-black text-[18px] text-gray-900 mb-1">Sin historial todavía</p>
                    <p className="text-[14px] text-gray-500 leading-relaxed max-w-xs">
                      Acá aparecerán tus consultas, diagnósticos y medicamentos registrados por tus profesionales.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
