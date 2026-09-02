import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, CaretRight, ArrowLeft, Eye, Plus,
  CloudArrowUp, Camera, CircleNotch, Pulse, Check,
  FileText, FolderOpen, AppleLogo, Barbell, PawPrint, Sparkle, ClipboardText, Pill,
} from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'
import PatientPageOverlay from '../../components/patient/PatientPageOverlay'
import { farmaciaVisible } from '../../lib/featureFlags'
import { track } from '../../utils/analytics'
import AnalisisVault from '../../components/patient/AnalisisVault'

const CATEGORIES = [
  { id: 'recetas',       name: 'Recetas Digitales', icon: FileText,   bgClass: 'bg-amber-50',   textClass: 'text-amber-700',   uploadable: false, comingSoon: true },
  // Análisis es la única categoría con datos reales: escribe en
  // `diagnostic_reports`, la misma tabla que lee el BioVisor y que el
  // profesional ve en la historia clínica. El resto sigue siendo maqueta.
  { id: 'analisis',      name: 'Análisis',           icon: Pulse,     bgClass: 'bg-emerald-50', textClass: 'text-emerald-600', uploadable: true },
  { id: 'nutricion',     name: 'Plan Nutricional',   icon: AppleLogo, bgClass: 'bg-emerald-50', textClass: 'text-emerald-600', uploadable: true, comingSoon: true },
  { id: 'entrenamiento', name: 'Rehab y Físico',     icon: Barbell,   bgClass: 'bg-orange-50',  textClass: 'text-orange-600',  uploadable: true, comingSoon: true },
  { id: 'historial',     name: 'Historial',          icon: FolderOpen, bgClass: 'bg-violet-50', textClass: 'text-violet-600',  uploadable: false },
  { id: 'peludo',        name: 'Amigo Peludo',       icon: PawPrint,  bgClass: 'bg-sky-50',     textClass: 'text-sky-600',     uploadable: true, comingSoon: true },
]

const MOCK_DOCS_BY_CATEGORY = {
  recetas:       [],
  analisis:      [],
  nutricion:     [{ id: 2, titulo: 'Dieta Hipertrofia', subtitulo: 'Lic. Nutrición • Hoy', source: 'profesional' }],
  entrenamiento: [{ id: 3, titulo: 'Rehabilitación Rodilla', subtitulo: 'Kinesiólogo • 3 días', source: 'profesional' }],
  historial:     [],
  peludo:        [{ id: 4, titulo: 'Foto Evolución (Herida)', subtitulo: 'Subido por vos • Ayer', source: 'paciente' }],
}

function CategoryHeader({ cat, onBack }) {
  const CatIcon = cat.icon
  return (
    <div className="pt-6 sm:pt-8 pb-4 px-6 bg-white/90 backdrop-blur-xl border-b border-border-default flex items-center gap-4 flex-shrink-0">
      <button onClick={onBack} className="w-10 h-10 bg-bg-secondary border border-border-default rounded-full flex items-center justify-center shadow-sm hover:bg-bg-surface">
        <ArrowLeft className="w-5 h-5 text-text-primary" />
      </button>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${cat.bgClass}`}>
          <CatIcon className={`w-5 h-5 ${cat.textClass}`} />
        </div>
        <h2 className="page-title">{cat.name}</h2>
      </div>
    </div>
  )
}

export default function PatientDocuments({ profile }) {
  const navigate = useNavigate()
  const [viewingCat, setViewingCat] = useState(null)
  const [docs, setDocs] = useState(MOCK_DOCS_BY_CATEGORY)
  const [showUpload, setShowUpload] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [uploadCat, setUploadCat] = useState(null)
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false)
  const [foodLogs, setFoodLogs] = useState([
    { id: 1, time: '08:30 AM', desc: 'Desayuno: Huevos y tostada', cals: 320, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=200&q=80' }
  ])
  const [workoutLogs, setWorkoutLogs] = useState([])

  // Derived data for category detail (safe when viewingCat is null)
  const catDocs = viewingCat ? (docs[viewingCat.id] || []) : []
  const proDocs = catDocs.filter(d => d.source === 'profesional')
  const patDocs = catDocs.filter(d => d.source === 'paciente')

  const handleUpload = () => {
    if (!newDocName || !uploadCat) return
    const newDoc = { id: Date.now(), titulo: newDocName, subtitulo: 'Subido por vos • Ahora', source: 'paciente' }
    setDocs(prev => ({ ...prev, [uploadCat.id]: [newDoc, ...(prev[uploadCat.id] || [])] }))
    setShowUpload(false)
    setNewDocName('')
    toast.success('Documento guardado')
  }

  const simulatePhotoUpload = type => {
    setIsAnalyzingImage(true)
    setTimeout(() => {
      if (type === 'food') {
        setFoodLogs(prev => [{
          id: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          desc: 'Almuerzo (analizado por IA)', cals: 450,
          img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=200&q=80'
        }, ...prev])
      } else {
        setWorkoutLogs(prev => [{
          id: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          desc: 'Movilidad completada sin dolor ✅',
          img: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=200&q=80'
        }, ...prev])
      }
      setIsAnalyzingImage(false)
    }, 2000)
  }

  // Main vault view (category detail rendered via PatientPageOverlay below)
  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 patient-column overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="mb-6 mt-4">
        <h1 className="page-title-lg text-text-primary tracking-tight leading-none">Bóveda</h1>
        <p className="text-text-secondary font-medium text-[15px] mt-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Tu historial médico seguro
        </p>
      </div>

      {/* Historia Clínica banner */}
      <button
        onClick={() => navigate('/paciente/historia-clinica')}
        className="w-full bg-gradient-to-r from-brand to-brand-hover rounded-2xl p-5 text-left text-white shadow-md hover:shadow-lg active:scale-[0.98] transition-all mb-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <ClipboardText className="w-7 h-7 text-white" />
          </div>
          <div>
            <p className="font-semibold text-[17px] leading-tight">Historia Clínica</p>
            <p className="text-[12px] opacity-80 mt-0.5">Ver y descargar tu HC completa</p>
          </div>
        </div>
        <CaretRight className="w-5 h-5 opacity-70 flex-shrink-0" />
      </button>

      {/* Feature cards — Biovisor, NutriPlan & Farmacia */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => navigate('/paciente/biovisor')}
          className="bg-gradient-to-br from-teal-500 to-teal-700 rounded-2xl p-4 text-left text-white shadow-md hover:shadow-lg active:scale-95 transition-all"
        >
          <Pulse className="w-6 h-6 mb-2 opacity-90" />
          <p className="font-semibold text-[15px] leading-tight">Biovisor</p>
          <p className="text-[11px] opacity-80 mt-0.5">Parámetros de salud</p>
        </button>
        <button
          onClick={() => navigate('/paciente/nutriplan')}
          className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-4 text-left text-white shadow-md hover:shadow-lg active:scale-95 transition-all"
        >
          <AppleLogo className="w-6 h-6 mb-2 opacity-90" />
          <p className="font-semibold text-[15px] leading-tight">NutriPlan</p>
          <p className="text-[11px] opacity-80 mt-0.5">Mi plan nutricional</p>
        </button>
        {/* Farmacia todavía no sale: el acceso se sacó el 2026-08-29 y sigue
            afuera en producción. Se muestra en staging y a las cuentas de
            prueba, para poder probar el circuito completo sin publicarlo
            (decisión de Mateo, 2026-09-02 — ver lib/featureFlags.js). */}
        {farmaciaVisible(profile) && (
          <button
            onClick={() => navigate('/paciente/farmacia')}
            className="col-span-2 bg-gradient-to-br from-brand to-brand-hover rounded-2xl p-4 text-left text-white shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-between"
          >
            <div>
              <Pill className="w-6 h-6 mb-2 opacity-90" />
              <p className="font-semibold text-[15px] leading-tight">Farmacia</p>
              <p className="text-[11px] opacity-80 mt-0.5">Comprá tus medicamentos</p>
            </div>
            <CaretRight className="w-5 h-5 opacity-70 flex-shrink-0" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {CATEGORIES.map(cat => {
          const CatIcon = cat.icon
          const isPeludo = cat.id === 'peludo'
          return (
            <div
              key={cat.id}
              onClick={() => {
                if (cat.comingSoon) return
                track('vault_category_view', { category: cat.id, flow: 'paciente' })
                setViewingCat(cat)
              }}
              className={`card-hover relative overflow-hidden group flex ${cat.comingSoon ? 'opacity-40 pointer-events-none' : 'cursor-pointer'} ${isPeludo ? 'col-span-2 lg:col-span-3 flex-row items-center gap-4' : 'flex-col items-center justify-center text-center'}`}
            >
              <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[9px] font-semibold tracking-widest flex items-center gap-1 ${cat.comingSoon ? 'bg-bg-surface text-text-tertiary' : cat.uploadable ? 'bg-emerald-50 text-emerald-600' : 'bg-bg-surface text-text-tertiary'}`}>
                {cat.comingSoon ? 'PRÓXIMAMENTE' : cat.uploadable ? <><Plus className="w-3 h-3" /> AÑADIR</> : <><Eye className="w-3 h-3" /> VER</>}
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${isPeludo ? '' : 'mb-3 mt-2'} ${cat.bgClass}`}>
                <CatIcon className={`w-6 h-6 ${cat.textClass}`} />
              </div>
              <h3 className={`font-semibold text-text-primary leading-tight ${isPeludo ? 'text-[16px]' : 'text-[14px]'}`}>{cat.name}</h3>
            </div>
          )
        })}
      </div>

      {/* Upload modal — responsive sheet/modal */}
      <PatientSheet open={showUpload && !!uploadCat} onClose={() => setShowUpload(false)}>
        <div className="px-6 pt-4 pb-10 overflow-y-auto scrollbar-hide flex-1">
          <div className="flex justify-between items-center mb-6">
            <h2 className="page-title leading-none">Cargar Progreso</h2>
            <button onClick={() => setShowUpload(false)} className="w-10 h-10 bg-bg-secondary border border-border-default rounded-full flex items-center justify-center shadow-sm hover:bg-bg-surface">
              <ArrowLeft className="w-5 h-5 text-text-primary" />
            </button>
          </div>
          <div className="card mb-6">
            <div className="flex flex-col mb-6">
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 ml-1">Título del archivo</label>
              <input
                type="text"
                value={newDocName}
                onChange={e => setNewDocName(e.target.value)}
                placeholder="Ej: Registro de Peso"
                className="bg-bg-secondary border border-border-default rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-text-primary focus:border-brand shadow-sm"
              />
            </div>
            <div className="border-2 border-dashed border-brand/30 rounded-2xl p-8 flex flex-col items-center justify-center bg-brand-muted/40 cursor-pointer hover:bg-brand-muted/60 transition-colors">
              <Camera className="w-10 h-10 text-brand mb-3" />
              <p className="font-semibold text-[14px] text-brand">Tocá para seleccionar archivo</p>
            </div>
          </div>
          <button
            onClick={handleUpload}
            disabled={!newDocName}
            className={`w-full py-5 rounded-full font-semibold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2 ${newDocName ? 'bg-brand text-white hover:bg-brand-hover active:scale-95' : 'bg-bg-surface text-text-tertiary cursor-not-allowed'}`}
          >
            Guardar y Notificar
          </button>
        </div>
      </PatientSheet>

      {/* Category detail — responsive full-page overlay */}
      <PatientPageOverlay open={!!viewingCat} onClose={() => setViewingCat(null)} className="bg-bg-primary">
        {viewingCat && (() => {
          // Análisis no es una maqueta: lee y escribe `diagnostic_reports`.
          if (viewingCat.id === 'analisis') return (
            <>
              <CategoryHeader cat={viewingCat} onBack={() => setViewingCat(null)} />
              <div className="flex-1 overflow-y-auto pb-10 scrollbar-hide bg-bg-primary">
                <AnalisisVault profile={profile} />
              </div>
            </>
          )
          // Las maquetas todavía usan el icono suelto más abajo.
          const CatIcon = viewingCat.icon
          return (
            <>
              <CategoryHeader cat={viewingCat} onBack={() => setViewingCat(null)} />

              <div className="flex-1 overflow-y-auto p-6 pb-10 scrollbar-hide space-y-6 bg-bg-primary">
                {/* Nutrición special view */}
                {viewingCat.id === 'nutricion' && (
                  <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-md">
                          <Sparkle className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-[18px] text-emerald-950">Calai IA</h3>
                          <p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-widest">Asistente Nutricional</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-emerald-600 font-semibold uppercase">Hoy</p>
                        <p className="font-semibold text-[18px] text-emerald-900">{foodLogs.reduce((a, l) => a + l.cals, 0)} <span className="text-[12px] font-semibold text-emerald-700">kcal</span></p>
                      </div>
                    </div>
                    <div className="space-y-3 mb-5">
                      {foodLogs.map(log => (
                        <div key={log.id} className="bg-white p-3 rounded-2xl border border-emerald-100/60 shadow-sm flex gap-3 items-center animate-fade-in">
                          <img src={log.img} alt="Comida" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-[14px] text-text-primary leading-tight">{log.desc}</h4>
                            <p className="text-[12px] text-text-tertiary font-medium">{log.time}</p>
                          </div>
                          <div className="bg-emerald-50 px-2 py-1 rounded-lg text-center">
                            <span className="block font-semibold text-[14px] text-emerald-700 leading-none">{log.cals}</span>
                            <span className="text-[9px] font-semibold text-emerald-600 uppercase">kcal</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => simulatePhotoUpload('food')}
                      disabled={isAnalyzingImage}
                      className={`w-full py-4 rounded-2xl font-semibold text-[15px] flex justify-center items-center gap-2 transition-all shadow-sm ${isAnalyzingImage ? 'bg-emerald-200 text-emerald-700 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'}`}
                    >
                      {isAnalyzingImage ? <><CircleNotch className="w-5 h-5 animate-spin" /> IA Analizando Plato...</> : <><Camera className="w-5 h-5" /> Analizar Plato con IA</>}
                    </button>
                  </div>
                )}

                {/* Entrenamiento special view */}
                {viewingCat.id === 'entrenamiento' && (
                  <div className="bg-orange-50/50 p-6 rounded-2xl border border-orange-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center shadow-md">
                        <Pulse className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[18px] text-orange-950">Kine AI</h3>
                        <p className="text-[11px] text-orange-700 font-semibold uppercase tracking-widest">Tracking de Recuperación</p>
                      </div>
                    </div>
                    <div className="space-y-3 mb-5">
                      {workoutLogs.map(log => (
                        <div key={log.id} className="bg-white p-3 rounded-2xl border border-orange-100/60 shadow-sm flex gap-3 items-center animate-fade-in">
                          <img src={log.img} alt="Ejercicio" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-[14px] text-text-primary leading-tight">{log.desc}</h4>
                            <p className="text-[12px] text-text-tertiary font-medium">{log.time}</p>
                          </div>
                          <Check className="w-5 h-5 text-orange-500 flex-shrink-0 mr-2" />
                        </div>
                      ))}
                      {workoutLogs.length === 0 && <p className="text-[13px] text-orange-600/70 text-center py-2 font-medium">Aún no registraste avances hoy.</p>}
                    </div>
                    <button
                      onClick={() => simulatePhotoUpload('workout')}
                      disabled={isAnalyzingImage}
                      className={`w-full py-4 rounded-2xl font-semibold text-[15px] flex justify-center items-center gap-2 transition-all shadow-sm ${isAnalyzingImage ? 'bg-orange-200 text-orange-700 cursor-not-allowed' : 'bg-orange-600 text-white hover:bg-orange-700 active:scale-95'}`}
                    >
                      {isAnalyzingImage ? <><CircleNotch className="w-5 h-5 animate-spin" /> Analizando Biomecánica...</> : <><Camera className="w-5 h-5" /> Subir VideoCamera/Foto del Ejercicio</>}
                    </button>
                  </div>
                )}

                {/* Professional docs */}
                {proDocs.length > 0 && (
                  <div>
                    <h3 className="text-[12px] font-semibold text-text-secondary uppercase tracking-widest mb-3">Documentos del Profesional</h3>
                    <div className="space-y-3">
                      {proDocs.map(doc => (
                        <div
                          key={doc.id}
                          className="card-hover flex justify-between items-center cursor-pointer"
                          onClick={() => track('document_view', { doc_type: viewingCat.id, flow: 'paciente' })}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${viewingCat.bgClass}`}>
                              <CatIcon className={`w-6 h-6 ${viewingCat.textClass}`} />
                            </div>
                            <div>
                              <h4 className="font-semibold text-[15px] text-text-primary">{doc.titulo}</h4>
                              <p className="text-[12px] text-text-tertiary font-medium mt-0.5">{doc.subtitulo}</p>
                            </div>
                          </div>
                          <CaretRight className="w-5 h-5 text-text-tertiary" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Patient uploads */}
                {viewingCat.uploadable && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[12px] font-semibold text-text-secondary uppercase tracking-widest flex items-center gap-2">Mis Controles</h3>
                      <button
                        onClick={() => { track('document_add_click', { doc_type: viewingCat.id, flow: 'paciente' }); setUploadCat(viewingCat); setNewDocName(''); setShowUpload(true) }}
                        className="text-[11px] font-semibold text-brand bg-brand-muted px-3 py-1.5 rounded-full hover:bg-brand-light flex items-center gap-1 border border-brand/20"
                      >
                        <Plus className="w-3 h-3" /> AÑADIR
                      </button>
                    </div>
                    <div className="space-y-3">
                      {patDocs.length > 0 ? patDocs.map(doc => (
                        <div key={doc.id} className="card flex justify-between items-center">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-bg-primary border border-border-default rounded-xl flex items-center justify-center">
                              <FileText className="w-5 h-5 text-text-tertiary" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-[15px] text-text-primary">{doc.titulo}</h4>
                              <p className="text-[12px] text-text-tertiary font-medium mt-0.5">{doc.subtitulo}</p>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div
                          onClick={() => { track('document_add_click', { doc_type: viewingCat.id, flow: 'paciente' }); setUploadCat(viewingCat); setNewDocName(''); setShowUpload(true) }}
                          className="border-2 border-dashed border-border-default rounded-2xl p-6 flex flex-col items-center justify-center bg-bg-secondary cursor-pointer hover:bg-bg-surface transition-colors"
                        >
                          <CloudArrowUp className="w-8 h-8 text-text-tertiary mb-2" />
                          <p className="font-semibold text-[14px] text-text-secondary">Añadir progreso</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        })()}
      </PatientPageOverlay>
    </div>
  )
}
