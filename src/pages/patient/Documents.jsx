import { useState } from 'react'
import {
  ShieldCheck, ChevronRight, ArrowLeft, Eye, Plus,
  UploadCloud, Camera, Loader2, Activity, Check,
  FileText, FolderOpen, Apple, Dumbbell, PawPrint, Sparkles,
} from 'lucide-react'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'
import PatientPageOverlay from '../../components/patient/PatientPageOverlay'

const CATEGORIES = [
  { id: 'recetas',       name: 'Recetas Digitales', icon: FileText,   color: '#b05a36', bg: '#fef9ef', uploadable: false },
  { id: 'analisis',      name: 'Análisis',           icon: Activity,   color: '#059669', bg: '#ECFDF5', uploadable: true  },
  { id: 'nutricion',     name: 'Plan Nutricional',   icon: Apple,      color: '#059669', bg: '#ECFDF5', uploadable: true  },
  { id: 'entrenamiento', name: 'Rehab y Físico',      icon: Dumbbell,   color: '#EA580C', bg: '#FFF7ED', uploadable: true  },
  { id: 'historial',     name: 'Historial',           icon: FolderOpen, color: '#7C3AED', bg: '#F5F3FF', uploadable: false },
  { id: 'peludo',        name: 'Amigo Peludo',        icon: PawPrint,   color: '#0284C7', bg: '#F0F9FF', uploadable: true  },
]

const MOCK_DOCS_BY_CATEGORY = {
  recetas:       [{ id: 1, titulo: 'Receta Ibuprofeno', subtitulo: 'Dr. López • 1 sem', source: 'profesional' }],
  analisis:      [],
  nutricion:     [{ id: 2, titulo: 'Dieta Hipertrofia', subtitulo: 'Lic. Nutrición • Hoy', source: 'profesional' }],
  entrenamiento: [{ id: 3, titulo: 'Rehabilitación Rodilla', subtitulo: 'Kinesiólogo • 3 días', source: 'profesional' }],
  historial:     [],
  peludo:        [{ id: 4, titulo: 'Foto Evolución (Herida)', subtitulo: 'Subido por vos • Ayer', source: 'paciente' }],
}

export default function PatientDocuments({ profile }) {
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

  const allRecent = Object.values(docs).flat().slice(0, 4)

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
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="mb-8 mt-4">
        <h1 className="text-[32px] font-black text-gray-900 tracking-tight leading-none">Bóveda Clínica</h1>
        <p className="text-gray-500 font-medium text-[15px] mt-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Documentos seguros
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {CATEGORIES.map(cat => {
          const CatIcon = cat.icon
          const isPeludo = cat.id === 'peludo'
          return (
            <div
              key={cat.id}
              onClick={() => setViewingCat(cat)}
              className={`bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 flex cursor-pointer hover:shadow-md transition-all relative overflow-hidden group ${isPeludo ? 'col-span-2 flex-row items-center gap-4' : 'flex-col items-center justify-center text-center'}`}
            >
              <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[9px] font-black tracking-widest flex items-center gap-1 ${cat.uploadable ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
                {cat.uploadable ? <><Plus className="w-3 h-3" /> AÑADIR</> : <><Eye className="w-3 h-3" /> VER</>}
              </div>
              <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${isPeludo ? '' : 'mb-3 mt-2'}`} style={{ backgroundColor: cat.bg }}>
                <CatIcon className="w-6 h-6" style={{ color: cat.color }} />
              </div>
              <h3 className={`font-bold text-gray-900 leading-tight ${isPeludo ? 'text-[16px]' : 'text-[14px]'}`}>{cat.name}</h3>
            </div>
          )
        })}
      </div>

      <h3 className="font-black text-lg text-gray-900 mb-4">Archivos Recientes</h3>
      <div className="space-y-3">
        {allRecent.map(doc => {
          const cat = CATEGORIES.find(c => Object.keys(docs).some(k => k === c.id && docs[k].some(d => d.id === doc.id)))
          const CatIcon = cat?.icon || FileText
          return (
            <div key={doc.id} className="bg-white p-4 rounded-[20px] shadow-sm flex justify-between items-center border border-gray-100 cursor-pointer hover:border-gray-300 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-[14px] flex items-center justify-center" style={{ backgroundColor: cat?.bg || '#F8FAFC' }}>
                  <CatIcon className="w-6 h-6" style={{ color: cat?.color || '#6b7280' }} />
                </div>
                <div>
                  <h4 className="font-bold text-[15px] text-gray-900">{doc.titulo}</h4>
                  <p className="text-[12px] text-gray-400 font-medium mt-0.5">{doc.subtitulo}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300" />
            </div>
          )
        })}
      </div>

      {/* Upload modal — responsive sheet/modal */}
      <PatientSheet open={showUpload && !!uploadCat} onClose={() => setShowUpload(false)}>
        <div className="px-6 pt-4 pb-10 overflow-y-auto scrollbar-hide flex-1">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-[24px] font-black text-gray-900 leading-none">Cargar Progreso</h2>
            <button onClick={() => setShowUpload(false)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
          </div>
          <div className="bg-bg-primary rounded-[24px] p-6 shadow-sm border border-gray-100 mb-6">
            <div className="flex flex-col mb-6">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Título del archivo</label>
              <input
                type="text"
                value={newDocName}
                onChange={e => setNewDocName(e.target.value)}
                placeholder="Ej: Registro de Peso"
                className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-gray-900 focus:border-brand shadow-sm"
              />
            </div>
            <div className="border-2 border-dashed border-brand/30 rounded-[20px] p-8 flex flex-col items-center justify-center bg-brand-muted/40 cursor-pointer hover:bg-brand-muted/60 transition-colors">
              <Camera className="w-10 h-10 text-brand mb-3" />
              <p className="font-bold text-[14px] text-brand">Tocá para seleccionar archivo</p>
            </div>
          </div>
          <button
            onClick={handleUpload}
            disabled={!newDocName}
            className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2 ${newDocName ? 'bg-brand text-white hover:bg-brand-hover active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            Guardar y Notificar
          </button>
        </div>
      </PatientSheet>

      {/* Category detail — responsive full-page overlay */}
      <PatientPageOverlay open={!!viewingCat} onClose={() => setViewingCat(null)} className="bg-bg-primary">
        {viewingCat && (() => {
          const CatIcon = viewingCat.icon
          return (
            <>
              {/* Header */}
              <div className="pt-6 sm:pt-8 pb-4 px-6 bg-white/90 backdrop-blur-xl border-b border-gray-100 flex items-center gap-4 flex-shrink-0">
                <button onClick={() => setViewingCat(null)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
                  <ArrowLeft className="w-5 h-5 text-gray-700" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: viewingCat.bg }}>
                    <CatIcon className="w-5 h-5" style={{ color: viewingCat.color }} />
                  </div>
                  <h2 className="text-xl font-black text-gray-900">{viewingCat.name}</h2>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 pb-10 scrollbar-hide space-y-6 bg-bg-primary">
                {/* Nutrición special view */}
                {viewingCat.id === 'nutricion' && (
                  <div className="bg-emerald-50/50 p-6 rounded-[28px] border border-emerald-100 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-500 rounded-[14px] flex items-center justify-center shadow-md">
                          <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h3 className="font-black text-[18px] text-emerald-950">Calai IA</h3>
                          <p className="text-[11px] text-emerald-700 font-bold uppercase tracking-widest">Asistente Nutricional</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-emerald-600 font-bold uppercase">Hoy</p>
                        <p className="font-black text-[18px] text-emerald-900">{foodLogs.reduce((a, l) => a + l.cals, 0)} <span className="text-[12px] font-bold text-emerald-700">kcal</span></p>
                      </div>
                    </div>
                    <div className="space-y-3 mb-5">
                      {foodLogs.map(log => (
                        <div key={log.id} className="bg-white p-3 rounded-[16px] border border-emerald-100/60 shadow-sm flex gap-3 items-center animate-fade-in">
                          <img src={log.img} alt="Comida" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-bold text-[14px] text-gray-900 leading-tight">{log.desc}</h4>
                            <p className="text-[12px] text-gray-500 font-medium">{log.time}</p>
                          </div>
                          <div className="bg-emerald-50 px-2 py-1 rounded-lg text-center">
                            <span className="block font-black text-[14px] text-emerald-700 leading-none">{log.cals}</span>
                            <span className="text-[9px] font-bold text-emerald-600 uppercase">kcal</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => simulatePhotoUpload('food')}
                      disabled={isAnalyzingImage}
                      className={`w-full py-4 rounded-[16px] font-bold text-[15px] flex justify-center items-center gap-2 transition-all shadow-sm ${isAnalyzingImage ? 'bg-emerald-200 text-emerald-700 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'}`}
                    >
                      {isAnalyzingImage ? <><Loader2 className="w-5 h-5 animate-spin" /> IA Analizando Plato...</> : <><Camera className="w-5 h-5" /> Analizar Plato con IA</>}
                    </button>
                  </div>
                )}

                {/* Entrenamiento special view */}
                {viewingCat.id === 'entrenamiento' && (
                  <div className="bg-orange-50/50 p-6 rounded-[28px] border border-orange-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-12 h-12 bg-orange-500 rounded-[14px] flex items-center justify-center shadow-md">
                        <Activity className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-black text-[18px] text-orange-950">Kine AI</h3>
                        <p className="text-[11px] text-orange-700 font-bold uppercase tracking-widest">Tracking de Recuperación</p>
                      </div>
                    </div>
                    <div className="space-y-3 mb-5">
                      {workoutLogs.map(log => (
                        <div key={log.id} className="bg-white p-3 rounded-[16px] border border-orange-100/60 shadow-sm flex gap-3 items-center animate-fade-in">
                          <img src={log.img} alt="Ejercicio" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="font-bold text-[14px] text-gray-900 leading-tight">{log.desc}</h4>
                            <p className="text-[12px] text-gray-500 font-medium">{log.time}</p>
                          </div>
                          <Check className="w-5 h-5 text-orange-500 flex-shrink-0 mr-2" />
                        </div>
                      ))}
                      {workoutLogs.length === 0 && <p className="text-[13px] text-orange-600/70 text-center py-2 font-medium">Aún no registraste avances hoy.</p>}
                    </div>
                    <button
                      onClick={() => simulatePhotoUpload('workout')}
                      disabled={isAnalyzingImage}
                      className={`w-full py-4 rounded-[16px] font-bold text-[15px] flex justify-center items-center gap-2 transition-all shadow-sm ${isAnalyzingImage ? 'bg-orange-200 text-orange-700 cursor-not-allowed' : 'bg-orange-600 text-white hover:bg-orange-700 active:scale-95'}`}
                    >
                      {isAnalyzingImage ? <><Loader2 className="w-5 h-5 animate-spin" /> Analizando Biomecánica...</> : <><Camera className="w-5 h-5" /> Subir Video/Foto del Ejercicio</>}
                    </button>
                  </div>
                )}

                {/* Professional docs */}
                {proDocs.length > 0 && (
                  <div>
                    <h3 className="text-[12px] font-bold text-gray-500 uppercase tracking-widest mb-3">Documentos del Profesional</h3>
                    <div className="space-y-3">
                      {proDocs.map(doc => (
                        <div key={doc.id} className="bg-white p-4 rounded-[24px] shadow-sm flex justify-between items-center border border-gray-100 cursor-pointer hover:border-gray-300 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center" style={{ backgroundColor: viewingCat.bg }}>
                              <CatIcon className="w-6 h-6" style={{ color: viewingCat.color }} />
                            </div>
                            <div>
                              <h4 className="font-bold text-[15px] text-gray-900">{doc.titulo}</h4>
                              <p className="text-[12px] text-gray-400 font-medium mt-0.5">{doc.subtitulo}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-gray-300" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Patient uploads */}
                {viewingCat.uploadable && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[12px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">Mis Controles</h3>
                      <button
                        onClick={() => { setUploadCat(viewingCat); setNewDocName(''); setShowUpload(true) }}
                        className="text-[11px] font-bold text-brand bg-brand-muted px-3 py-1.5 rounded-full hover:bg-brand-light flex items-center gap-1 border border-brand/20"
                      >
                        <Plus className="w-3 h-3" /> AÑADIR
                      </button>
                    </div>
                    <div className="space-y-3">
                      {patDocs.length > 0 ? patDocs.map(doc => (
                        <div key={doc.id} className="bg-white p-4 rounded-[24px] shadow-sm flex justify-between items-center border border-gray-100">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-bg-primary border border-gray-100 rounded-[14px] flex items-center justify-center">
                              <FileText className="w-5 h-5 text-gray-400" />
                            </div>
                            <div>
                              <h4 className="font-bold text-[15px] text-gray-900">{doc.titulo}</h4>
                              <p className="text-[12px] text-gray-400 font-medium mt-0.5">{doc.subtitulo}</p>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div
                          onClick={() => { setUploadCat(viewingCat); setNewDocName(''); setShowUpload(true) }}
                          className="border-2 border-dashed border-gray-200 rounded-[24px] p-6 flex flex-col items-center justify-center bg-white cursor-pointer hover:bg-gray-50 transition-colors"
                        >
                          <UploadCloud className="w-8 h-8 text-gray-300 mb-2" />
                          <p className="font-bold text-[14px] text-gray-600">Añadir progreso</p>
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
