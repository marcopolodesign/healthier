import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, CaretRight, ArrowLeft, Plus,
  CloudArrowUp, Camera, CircleNotch, Pulse,
  FileText, FolderOpen, AppleLogo, Barbell, Brain, PawPrint, Sparkle, ClipboardText,
  PencilSimple, Trash, ShoppingBag, ForkKnife,
} from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'
import PatientPageOverlay from '../../components/patient/PatientPageOverlay'
import NotificationBell from '../../components/patient/NotificationBell'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { farmaciaVisible } from '../../lib/featureFlags'
import { track } from '../../utils/analytics'
import AnalisisVault from '../../components/patient/AnalisisVault'
import ActivityPlanVault from '../../components/patient/ActivityPlanVault'
import { petsService } from '../../services/petsService'

const PET_SPECIES = ['Perro', 'Gato', 'Otro']

// mente/rehabilitacion/preparador tienen plan real (activity_plans, migración
// 171) — el id de la categoría es directamente el `tipo` de la tabla.
const TIPOS_CON_PLAN = new Set(['mente', 'rehabilitacion', 'preparador'])

const CATEGORIES = [
  // Recetas ya NO es `comingSoon` ni una categoría de documentos subidos a mano:
  // lleva a `/paciente/recetas`, la lista real de recetas electrónicas emitidas
  // (Mateo, 2026-09-04). Antes era una tarjeta apagada con la lista fija en [].
  { id: 'recetas',       name: 'Recetas Digitales', icon: FileText,   bgClass: 'bg-amber-50',   textClass: 'text-amber-700',   uploadable: false, ruta: '/paciente/recetas' },
  // Análisis es la única categoría "clásica" con datos reales: escribe en
  // `diagnostic_reports`, la misma tabla que lee el BioVisor y que el
  // profesional ve en la historia clínica. Nutrición vive en su propia tarjeta
  // arriba (real, `/paciente/nutriplan`) — ésta sigue siendo maqueta.
  { id: 'analisis',      name: 'Análisis',           icon: Pulse,     bgClass: 'bg-emerald-50', textClass: 'text-emerald-600', uploadable: true },
  { id: 'nutricion',     name: 'Plan Nutricional',   icon: AppleLogo, bgClass: 'bg-emerald-50', textClass: 'text-emerald-600', uploadable: true, comingSoon: true },
  // Las tres de abajo tienen plan real (activity_plans) — pedido de Nacho,
  // aprobado por Mateo, "como el plan de nutrición" (2026-09-23).
  { id: 'mente',          name: 'Salud Mental',       icon: Brain,     bgClass: 'bg-violet-50',  textClass: 'text-violet-600',  uploadable: true },
  { id: 'rehabilitacion', name: 'Rehabilitación',     icon: Barbell,   bgClass: 'bg-orange-50',  textClass: 'text-orange-600',  uploadable: true },
  { id: 'preparador',     name: 'Preparador Físico',  icon: Pulse,     bgClass: 'bg-orange-50',  textClass: 'text-orange-600',  uploadable: true },
  { id: 'historial',     name: 'Historial',          icon: FolderOpen, bgClass: 'bg-violet-50', textClass: 'text-violet-600',  uploadable: false },
  // Ya no es maqueta (2026-09-23, pedido de Nacho): lista y alta de mascotas
  // reales sobre `pets` (migración 172). No usa el visor de documentos
  // genérico de más abajo — tiene su propia vista dentro del overlay.
  { id: 'peludo',        name: 'Amigo Peludo',       icon: PawPrint,  bgClass: 'bg-sky-50',     textClass: 'text-sky-600',     uploadable: false },
]

const MOCK_DOCS_BY_CATEGORY = {
  recetas:        [],
  analisis:       [],
  nutricion:      [{ id: 2, titulo: 'Dieta Hipertrofia', subtitulo: 'Lic. Nutrición • Hoy', source: 'profesional' }],
  mente:          [],
  rehabilitacion: [],
  preparador:     [],
  historial:      [],
  peludo:         [{ id: 4, titulo: 'Foto Evolución (Herida)', subtitulo: 'Subido por vos • Ayer', source: 'paciente' }],
}

// ── Carpetas apiladas (Mateo, 2026-09-23) — mismo diseño que la app: con la
// pila cerrada asoma sólo el título de cada carpeta y en los primeros 260px de
// scroll se separan hasta verse enteras. Las medidas viven en `carpetas-pila` /
// `carpeta` (index.css); acá sólo va el orden y el progreso de apertura.
const RECORRIDO_APERTURA = 260
// Clases literales para que Tailwind las genere (no se pueden armar con template strings).
const INDICE = ['[--i:0]', '[--i:1]', '[--i:2]', '[--i:3]', '[--i:4]', '[--i:5]', '[--i:6]', '[--i:7]', '[--i:8]', '[--i:9]', '[--i:10]', '[--i:11]']
const CANTIDAD = ['[--n:1]', '[--n:1]', '[--n:2]', '[--n:3]', '[--n:4]', '[--n:5]', '[--n:6]', '[--n:7]', '[--n:8]', '[--n:9]', '[--n:10]', '[--n:11]', '[--n:12]']
const FONDOS = ['carpeta-fondo-0', 'carpeta-fondo-1', 'carpeta-fondo-2', 'carpeta-fondo-3', 'carpeta-fondo-4']

const DESCRIPCION = {
  biovisor: 'Tus valores leídos de cada análisis.',
  nutriplan: 'Tu plan de alimentación vigente.',
  recetas: 'Tus recetas electrónicas, vigentes y anteriores.',
  analisis: 'Subí tus estudios y guardalos en tu historia.',
  mente: 'Tu plan y los documentos de salud mental.',
  rehabilitacion: 'Tu plan de ejercicios de rehabilitación.',
  preparador: 'Tu rutina de entrenamiento.',
  farmacia: 'Tus pedidos y compras de farmacia.',
  peludo: 'La salud de tus mascotas.',
}

// Lo que antes eran las tarjetas destacadas (Análisis de sangre, NutriPlan,
// Farmacia) entra a la pila como una carpeta más, igual que en la app.
const CARPETA_BIOVISOR = { id: 'biovisor', name: 'Análisis de sangre', icon: Pulse, textClass: 'text-emerald-700', ruta: '/paciente/biovisor', chip: 'Activo' }
const CARPETA_NUTRIPLAN = { id: 'nutriplan', name: 'Nutrición', icon: ForkKnife, textClass: 'text-amber-700', ruta: '/paciente/nutriplan', chip: 'Activo' }
const CARPETA_FARMACIA = { id: 'farmacia', name: 'Farmacia', icon: ShoppingBag, textClass: 'text-[#A5472F]', ruta: '/paciente/farmacia', acento: true }

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
  const { count: cartCount, openSheet: abrirCarrito } = usePharmacyCart()
  const [viewingCat, setViewingCat] = useState(null)
  // `--abre` se escribe directo en la pila desde el scroll (sin re-render por
  // cada px): es el único valor que cambia en vivo.
  const pilaRef = useRef(null)
  const onScrollBoveda = (e) => {
    const abre = Math.min(1, Math.max(0, e.currentTarget.scrollTop / RECORRIDO_APERTURA))
    pilaRef.current?.style.setProperty('--abre', String(abre))
  }
  const [docs, setDocs] = useState(MOCK_DOCS_BY_CATEGORY)
  const [showUpload, setShowUpload] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [uploadCat, setUploadCat] = useState(null)
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false)
  const [foodLogs, setFoodLogs] = useState([
    { id: 1, time: '08:30 AM', desc: 'Desayuno: Huevos y tostada', cals: 320, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=200&q=80' }
  ])

  // Amigo Peludo — mascotas reales, tabla `pets` (migración 172).
  const [pets, setPets] = useState([])
  const [loadingPets, setLoadingPets] = useState(false)
  const [showPetForm, setShowPetForm] = useState(false)
  const [editingPetId, setEditingPetId] = useState(null)
  const [savingPet, setSavingPet] = useState(false)
  const [newPet, setNewPet] = useState({ nombre: '', especie: 'Perro', raza: '' })

  const loadPets = async () => {
    if (!profile?.id) return
    setLoadingPets(true)
    try {
      setPets(await petsService.listForOwner(profile.id))
    } catch {
      toast.error('No pudimos cargar tus mascotas')
    } finally {
      setLoadingPets(false)
    }
  }

  useEffect(() => {
    if (viewingCat?.id === 'peludo') loadPets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingCat])

  const abrirEdicionPet = pet => {
    setEditingPetId(pet.id)
    setNewPet({ nombre: pet.nombre, especie: pet.especie === 'perro' ? 'Perro' : pet.especie === 'gato' ? 'Gato' : 'Otro', raza: pet.raza || '' })
    setShowPetForm(true)
  }

  const cerrarFormPet = () => {
    setShowPetForm(false)
    setEditingPetId(null)
    setNewPet({ nombre: '', especie: 'Perro', raza: '' })
  }

  const savePet = async () => {
    if (!newPet.nombre.trim() || savingPet) return
    setSavingPet(true)
    try {
      const datos = { nombre: newPet.nombre.trim(), especie: newPet.especie.toLowerCase(), raza: newPet.raza.trim() || null }
      if (editingPetId) {
        const actualizado = await petsService.update(editingPetId, datos)
        setPets(prev => prev.map(p => (p.id === editingPetId ? actualizado : p)))
        toast.success('Mascota actualizada')
      } else {
        const created = await petsService.create(profile.id, datos)
        setPets(prev => [created, ...prev])
        toast.success('Mascota agregada')
      }
      cerrarFormPet()
    } catch (err) {
      toast.error(err?.message || 'No pudimos guardar la mascota')
    } finally {
      setSavingPet(false)
    }
  }

  const removePet = async id => {
    try {
      await petsService.remove(id)
      setPets(prev => prev.filter(p => p.id !== id))
      toast.success('Mascota eliminada')
    } catch (err) {
      toast.error(err?.message || 'No pudimos eliminar la mascota')
    }
  }

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

  const simulatePhotoUpload = () => {
    setIsAnalyzingImage(true)
    setTimeout(() => {
      setFoodLogs(prev => [{
        id: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        desc: 'Almuerzo (analizado por IA)', cals: 450,
        img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=200&q=80'
      }, ...prev])
      setIsAnalyzingImage(false)
    }, 2000)
  }

  // Main vault view (category detail rendered via PatientPageOverlay below)
  // Nutrición "comingSoon" y el Historial viejo no entran: la Historia
  // Clínica ya es la tarjeta oscura, y Nutrición es el plan (mismo criterio que la app).
  const carpetas = [
    CARPETA_BIOVISOR,
    CARPETA_NUTRIPLAN,
    ...CATEGORIES.filter(c => !c.comingSoon && c.id !== 'historial' && c.id !== 'peludo'),
    ...(farmaciaVisible(profile) ? [CARPETA_FARMACIA] : []),
    ...CATEGORIES.filter(c => c.id === 'peludo'),
  ]

  const abrirCarpeta = (cat) => {
    track('vault_category_view', { category: cat.id, flow: 'paciente' })
    // Categorías con pantalla propia (recetas, biovisor, nutriplan, farmacia)
    // — el resto abre el visor de documentos subidos.
    if (cat.ruta) { navigate(cat.ruta); return }
    setViewingCat(cat)
  }

  return (
    <div onScroll={onScrollBoveda} className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 patient-column overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10 lg:items-start">
        <div className="lg:sticky lg:top-0">
          <div className="mb-6 mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="page-title-lg text-text-primary tracking-tight leading-none">Bóveda</h1>
              <p className="text-text-secondary font-medium text-[15px] mt-2 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Tu historial médico seguro
              </p>
            </div>
            {/* Bell + carrito de farmacia — mismo tratamiento de header que
                Inicio (`PatientHeader`, 2026-09-23). El carrito comparte gate
                con el resto de farmacia. */}
            <div className="flex items-center gap-2 shrink-0">
              {farmaciaVisible(profile) && (
                <button
                  onClick={abrirCarrito}
                  aria-label={cartCount > 0 ? `Ver el carrito — ${cartCount} producto${cartCount !== 1 ? 's' : ''}` : 'Ver el carrito'}
                  className="relative w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:bg-white transition-colors"
                >
                  <ShoppingBag className="w-5 h-5 text-text-primary" weight={cartCount > 0 ? 'fill' : 'regular'} />
                  {cartCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center border-2 border-white">
                      {cartCount > 9 ? '9+' : cartCount}
                    </span>
                  )}
                </button>
              )}
              <NotificationBell userId={profile?.id} tone="dark" />
            </div>
          </div>

          {/* Historia Clínica — la única tarjeta oscura de la pantalla. */}
          <div className="tarjeta-oscura rounded-[28px] p-5 lg:p-6 text-white mb-4 lg:mb-0">
            <button
              onClick={() => navigate('/paciente/historia-clinica')}
              className="relative z-10 w-full text-left flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-4">
                <span className="w-11 h-11 rounded-full bg-white/12 flex items-center justify-center shrink-0">
                  <ClipboardText className="w-6 h-6 text-white" />
                </span>
                <span>
                  <span className="block font-semibold text-[18px] lg:text-[24px] leading-tight">Historia Clínica</span>
                  <span className="block text-[13px] text-white/80 mt-0.5">Ver y descargar tu HC completa</span>
                </span>
              </span>
              <CaretRight className="w-5 h-5 shrink-0" />
            </button>
            <div className="relative z-10 hidden lg:flex gap-2 mt-8">
              <button
                onClick={() => navigate('/paciente/historia-clinica')}
                className="px-4 py-2.5 rounded-full bg-[#DDEBC9] text-[#1E2621] text-[14px] font-semibold hover:bg-white transition-colors"
              >
                Ver y exportar
              </button>
            </div>
          </div>
        </div>

        {/* Carpetas apiladas */}
        <div ref={pilaRef} className={`carpetas-pila ${CANTIDAD[carpetas.length] ?? '[--n:12]'} mt-2 lg:mt-4 mb-8`}>
          {carpetas.map((cat, i) => {
            const CatIcon = cat.icon
            const chip = cat.chip ?? (cat.uploadable ? 'Añadir' : null)
            return (
              <button
                key={cat.id}
                onClick={() => abrirCarpeta(cat)}
                className={`carpeta ${INDICE[i]} ${cat.acento ? 'carpeta-fondo-coral' : FONDOS[i % FONDOS.length]} text-left px-5 lg:px-6 pt-3.5 lg:pt-[18px] pb-5 flex flex-col justify-between hover:brightness-[1.02] transition-[filter]`}
              >
                <span className="flex items-center gap-3.5 w-full">
                  <span className={`w-9 h-9 lg:w-11 lg:h-11 rounded-full bg-white/75 border border-[rgba(45,42,38,0.06)] flex items-center justify-center shrink-0 ${cat.textClass}`}>
                    <CatIcon className="w-5 h-5" />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[18px] lg:text-[22px] font-medium text-text-primary">{cat.name}</span>
                  {chip && (
                    <span className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/85 border border-[rgba(45,42,38,0.06)] text-[12px] lg:text-[13px] font-semibold text-text-primary shrink-0">
                      {chip === 'Añadir' && <Plus className="w-3 h-3" />}{chip}
                    </span>
                  )}
                </span>
                <span className="flex items-end justify-between gap-4 w-full">
                  <span className="text-[13px] lg:text-[16px] leading-snug text-text-secondary max-w-[420px]">{DESCRIPCION[cat.id]}</span>
                  <span className={`flex items-center gap-1 px-4 py-2 rounded-full text-[13px] lg:text-[14px] font-semibold border border-[rgba(45,42,38,0.06)] shrink-0 ${cat.acento ? 'bg-[#C5654B] text-white' : 'bg-white/85 text-text-primary'}`}>
                    Abrir <CaretRight className="w-3.5 h-3.5" />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
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
          // Amigo Peludo tampoco es maqueta: lee y escribe `pets` (migración 172).
          if (viewingCat.id === 'peludo') return (
            <>
              <CategoryHeader cat={viewingCat} onBack={() => setViewingCat(null)} />
              <div className="flex-1 overflow-y-auto p-6 pb-10 scrollbar-hide space-y-4 bg-bg-primary">
                {loadingPets ? (
                  <div className="flex justify-center py-12">
                    <CircleNotch className="w-8 h-8 animate-spin text-sky-500" />
                  </div>
                ) : (
                  <>
                    {pets.length === 0 && !showPetForm && (
                      <div className="border-2 border-dashed border-border-default rounded-2xl p-8 flex flex-col items-center justify-center bg-bg-secondary text-center">
                        <PawPrint className="w-10 h-10 text-sky-400 mb-2" />
                        <p className="font-semibold text-[14px] text-text-secondary">Todavía no cargaste mascotas.</p>
                      </div>
                    )}
                    <div className="space-y-3">
                      {pets.map(pet => (
                        <div key={pet.id} className="card flex justify-between items-center">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-sky-50">
                              <PawPrint className="w-6 h-6 text-sky-600" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-[15px] text-text-primary capitalize">{pet.nombre}</h4>
                              <p className="text-[12px] text-text-tertiary font-medium mt-0.5 capitalize">{pet.especie}{pet.raza ? ` · ${pet.raza}` : ''}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => abrirEdicionPet(pet)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-bg-surface">
                              <PencilSimple className="w-4 h-4 text-text-secondary" />
                            </button>
                            <button onClick={() => removePet(pet.id)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-red-50">
                              <Trash className="w-4 h-4 text-red-500" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {!showPetForm && (
                      <button
                        onClick={() => setShowPetForm(true)}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-sky-200 text-[14px] font-semibold text-sky-600 hover:bg-sky-50 transition-colors"
                      >
                        <Plus className="w-4 h-4" /> Agregar mascota
                      </button>
                    )}

                    {showPetForm && (
                      <div className="card space-y-3">
                        <input
                          type="text"
                          placeholder="Nombre"
                          value={newPet.nombre}
                          onChange={e => setNewPet(p => ({ ...p, nombre: e.target.value }))}
                          className="w-full bg-bg-secondary border border-border-default rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-text-primary focus:border-brand"
                        />
                        <input
                          type="text"
                          placeholder="Raza (opcional)"
                          value={newPet.raza}
                          onChange={e => setNewPet(p => ({ ...p, raza: e.target.value }))}
                          className="w-full bg-bg-secondary border border-border-default rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-text-primary focus:border-brand"
                        />
                        <div className="flex flex-wrap gap-2">
                          {PET_SPECIES.map(sp => (
                            <button
                              key={sp}
                              onClick={() => setNewPet(p => ({ ...p, especie: sp }))}
                              className={`px-4 py-2 rounded-full border text-[13px] font-medium transition-all ${newPet.especie === sp ? 'text-white border-sky-500 bg-sky-500' : 'text-text-secondary border-border-default bg-bg-secondary hover:border-sky-300'}`}
                            >
                              {sp}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={cerrarFormPet} className="flex-1 py-3 rounded-full font-semibold text-[14px] text-text-secondary border border-border-default">
                            Cancelar
                          </button>
                          <button
                            onClick={savePet}
                            disabled={!newPet.nombre.trim() || savingPet}
                            className="flex-1 py-3 rounded-full font-semibold text-[14px] text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-40"
                          >
                            {savingPet ? 'Guardando…' : editingPetId ? 'Guardar cambios' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
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
                      onClick={() => simulatePhotoUpload()}
                      disabled={isAnalyzingImage}
                      className={`w-full py-4 rounded-2xl font-semibold text-[15px] flex justify-center items-center gap-2 transition-all shadow-sm ${isAnalyzingImage ? 'bg-emerald-200 text-emerald-700 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'}`}
                    >
                      {isAnalyzingImage ? <><CircleNotch className="w-5 h-5 animate-spin" /> IA Analizando Plato...</> : <><Camera className="w-5 h-5" /> Analizar Plato con IA</>}
                    </button>
                  </div>
                )}

                {/* Salud Mental / Rehabilitación / Preparador Físico — plan real
                    del profesional (activity_plans, migración 171). */}
                {TIPOS_CON_PLAN.has(viewingCat.id) && (
                  <ActivityPlanVault patientId={profile?.id} tipo={viewingCat.id} />
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
