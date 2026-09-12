import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Stethoscope, User, FileText, ClipboardText, LockKey, MagnifyingGlass, LinkSimple } from '@phosphor-icons/react';
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { professionalOnboardingService } from '../../services/professionalOnboardingService'
import { PROFESSION_CATEGORIES, specialtiesForCategory, categoryForSpecialty } from '../../lib/verticals'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { AnimatedTagCascade } from '../../components/common/AnimatedTagCascade'
import FileUpload from '../../components/FileUpload'
import { OPCIONES_SEXO } from '../../lib/datosReceta'
import { toast } from '../../components/Toast'
import { isLikelyTooSmallForFace } from '../../lib/imageCompression'
import OnboardingPreview from '../../components/professional/OnboardingPreview'
import EnvioFallidoSheet from '../../components/professional/EnvioFallidoSheet'
import { LAWS } from '../../lib/laws'
import { track } from '../../utils/analytics'

// De acá salieron **sólo las tarifas** — precio, modalidad, zona y dirección —
// que ya se configuran en Configuración → Tarifas y Perfil, y que el
// ProfileCompletenessCard del Dashboard resurfacea.
//
// Foto y bio **siguen acá** (restauradas 2026-08-06): el 2026-08-04 se sacaron
// junto con las tarifas, y no era eso lo pedido. Son lo que el paciente ve del
// profesional, así que pedirlas mientras está completando el perfil es el
// momento en que más barato sale — después nadie vuelve a Perfil a cargarlas.
const STEPS = [
  { label: 'Especialidad',       short: 'Especialidad', icon: Stethoscope   },
  { label: 'Tu presentación',    short: 'Presentación', icon: User          },
  { label: 'Documentación',      short: 'Documentos',   icon: FileText      },
  { label: 'Datos y privacidad', short: 'Privacidad',   icon: LockKey       },
  { label: 'Revisión y envío',   short: 'Revisión',     icon: ClipboardText },
]

/**
 * Sube una vez y, si se corta, reintenta dos veces más antes de darse por
 * vencida. Desde un teléfono con datos móviles una subida que falla no es un
 * archivo roto: es la conexión, y al segundo intento suele andar.
 *
 * El error que sale es el que lee el profesional. "Failed to fetch" —que es lo
 * que tira el navegador— no le dice qué pasó ni qué hacer.
 */
async function conReintento(fn, etiqueta, intentos = 3) {
  let ultimo
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn()
    } catch (err) {
      ultimo = err
      if (i < intentos - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)))
    }
  }
  // El detalle técnico va a la consola, no al mensaje: "Failed to fetch" no le
  // dice nada al profesional y ensucia la hoja que sí le explica qué hacer.
  console.error(`[onboarding] falló subir ${etiqueta}:`, ultimo)
  throw new Error(`No pudimos subir ${etiqueta}: se cortó la conexión antes de terminar.`)
}

export default function Onboarding({ profile }) {
  const { especialidades, porSlug, subEspecialidadesDe } = useEspecialidades()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isResubmit = searchParams.get('resubmit') === '1'

  // Deep-link into a specific step (e.g. Dashboard's "faltan documentos"
  // banner sends ?resubmit=1&step=2 to jump straight to Documentación).
  const requestedStep = Number(searchParams.get('step'))
  const initialStep = Number.isInteger(requestedStep) && requestedStep > 0 && requestedStep < STEPS.length
    ? requestedStep
    : 0
  const [step, setStep] = useState(initialStep)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    dni: profile?.dni || '',
    gender: profile?.gender || '',
    specialty: '', subSpecialty: '', bio: '',
    licenseType: 'MN', licenseNumber: '', cuitNumber: '',
  })
  const [avatarFile, setAvatarFile]       = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [titleFile, setTitleFile]       = useState(null)
  const [licenseFile, setLicenseFile]   = useState(null)
  const [dniFile, setDniFile]           = useState(null)
  const [malpracticeFile, setMalpracticeFile]         = useState(null)
  const [specialistCertFile, setSpecialistCertFile]   = useState(null)
  const [cuitFile, setCuitFile]                       = useState(null)
  // Lo que ya está en `professional-docs/<uid>/` de un intento anterior. Ver
  // `professionalService.listDocuments`.
  const [existingDocs, setExistingDocs] = useState({})
  const [categoryId, setCategoryId]     = useState(null)
  const [specialtySearch, setSpecialtySearch] = useState('')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [subSpecialtyCustom, setSubSpecialtyCustom] = useState(false)

  const parentEspecialidad = especialidades.find(e => e.slug === form.specialty)
  const subOptions = (parentEspecialidad && subEspecialidadesDe[parentEspecialidad.id]) || []
  const isKnownSub = !form.subSpecialty || subOptions.some(o => o.slug === form.subSpecialty)
  const showCustomSub = subSpecialtyCustom || (!!form.subSpecialty && !isKnownSub)

  useEffect(() => {
    if (!profile?.id) return
    if (isResubmit) {
      professionalService.getByUserId(profile.id).then(p => {
        if (!p) return
        setForm({
          // Vienen de `profiles`, no de `professional_profiles`: si no se
          // recuperan acá, reenviar el legajo los pisa con '' y el paso queda
          // trabado pidiendo datos que el profesional ya había cargado.
          dni:           profile?.dni    || '',
          gender:        profile?.gender || '',
          specialty:     p.specialty     || '',
          subSpecialty:  p.subSpecialty  || '',
          bio:           p.bio           || '',
          licenseType:   p.licenseType   || 'MN',
          licenseNumber: p.licenseNumber || '',
          cuitNumber:    p.cuitNumber    || '',
        })
        if (p.specialty) setCategoryId(categoryForSpecialty(p.specialty))
      })
      return
    }
    // Prospecto que ya había avanzado algún paso y volvió después (cerró la
    // pestaña, otro día): sin esto arranca de cero siempre, aunque haya
    // guardado especialidad/matrícula/bio en un intento anterior. El draft se
    // guarda en cada "Siguiente" — ver trackStep.
    const d = profile.onboardingDraft
    if (d) {
      setForm(f => ({ ...f, ...d }))
      if (d.specialty) setCategoryId(categoryForSpecialty(d.specialty))
    }
  }, [isResubmit, profile?.id, profile?.dni, profile?.gender, profile?.onboardingDraft])

  const handleAvatar = async file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    // Aviso blando, no bloqueante: no detectamos caras, sólo avisamos si la
    // imagen es chica. El profesional decide si la cambia.
    if (await isLikelyTooSmallForFace(file)) {
      toast.warning('Esa foto es chica y puede que no se te vea bien la cara. Podés seguir igual o subir otra.')
    }
  }

  // Qué documento se va a guardar en el envío: el nuevo si lo eligió ahora, y
  // si no el que ya tenía subido. Mostrar '—' teniéndolo subido haría creer
  // que se pierde.
  const docResumen = (file, key) =>
    file?.name || (existingDocs[key] ? `${existingDocs[key].name} (ya subido)` : '—')

  // Categorías con una sola especialidad (Nutrición, Psicología, Veterinaria,
  // Entrenamiento, Otra) mostraban abajo un segundo chip con el MISMO texto que
  // la profesión recién elegida. Parecía decoración —o el eco de lo que ya
  // habías tocado—, así que nadie lo apretaba, y "Siguiente" se quedaba gris
  // sin decir por qué. Si no hay nada que elegir, se elige solo.
  useEffect(() => {
    if (!categoryId || form.specialty) return
    const opciones = specialtiesForCategory(categoryId, porSlug)
    if (opciones.length === 1) setForm(p => ({ ...p, specialty: opciones[0].value }))
  }, [categoryId, form.specialty, porSlug])

  // Qué falta para poder avanzar, en palabras. Es la validación del paso Y el
  // texto que se le muestra: un botón gris sin explicación deja al profesional
  // adivinando cuál de los campos es el que le falta (pasó en producción con
  // la especialidad del paso 1 y con DNI/sexo del paso 2).
  const faltaParaAvanzar = () => {
    if (step === 0) {
      const falta = []
      if (!categoryId) falta.push('elegir tu profesión')
      if (!form.specialty) falta.push('elegir tu especialidad')
      if (!(form.licenseNumber ?? '').trim()) falta.push('el número de matrícula')
      return falta
    }
    if (step === 1) {
      const falta = []
      if ((form.dni ?? '').trim().length < 7) falta.push('tu DNI')
      if (!(form.gender ?? '').trim()) falta.push('tu sexo')
      return falta
    }
    if (step === 3) return privacyAccepted ? [] : ['aceptar los términos']
    return []
  }
  const falta = faltaParaAvanzar()
  const canAdvance = () => falta.length === 0

  // Fire-and-forget: le sirve al funnel de super-admin (Prospectos
  // Profesionales) para ver en qué paso se frenan los que no terminan, y
  // desde 2026-08-13 también para ver QUÉ cargaron hasta ese punto (antes no
  // se guardaba nada del wizard hasta el envío final — un prospecto que
  // llegaba a "Documentos" y se frenaba no tenía ni la especialidad
  // guardada). `includeDraft` sólo va en true en avances reales del usuario
  // (`next()`) — el trackStep de montaje NO manda draft, para no pisar un
  // draft bueno de una sesión anterior con el form vacío del arranque.
  const trackStep = (newStep, includeDraft = false) =>
    profilesService.update(profile.id, {
      onboardingStep: newStep,
      ...(includeDraft ? { onboardingDraft: form } : {}),
    }).catch(() => {})

  const next = () => {
    if (!canAdvance()) return
    setStep(s => {
      const newStep = s + 1
      trackStep(newStep, true)
      return newStep
    })
  }
  const prev = () => setStep(s => s - 1)

  // Cubre a quien abre el wizard y lo abandona sin tocar "Siguiente" nunca —
  // sin esto, `next()` solo captura a quien avanzó al menos un paso.
  //
  // El evento `wizard_opened` es lo que hace visible una REAPERTURA en el
  // recorrido del super admin: `onboarding_step` no baja (trigger de la
  // migración 112), así que volver a entrar no cambia nada en `profiles` y sin
  // este asiento sería indistinguible de no haber vuelto nunca.
  useEffect(() => {
    if (!profile?.id) return
    trackStep(initialStep)
    professionalOnboardingService.logWizardOpened(profile.id, initialStep, { resubmit: isResubmit })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Los `<input type=file>` arrancan siempre vacíos —el browser no deja
  // prellenarlos— así que quien vuelve al wizard ve el paso de Documentación
  // como si nunca hubiera subido nada. Sin esto, reenviar guardaba el legajo
  // con las columnas de documentos vacías y sus archivos quedaban huérfanos en
  // el bucket.
  useEffect(() => {
    if (!profile?.id) return
    professionalService.listDocuments(profile.id).then(setExistingDocs).catch(() => {})
  }, [profile?.id])

  // Lo que ya subió en ESTA pantalla, aunque el envío después se haya caído.
  // Sobrevive a los reintentos porque es un ref, no estado.
  const yaSubido = useRef({})
  const [errorEnvio, setErrorEnvio] = useState(null)

  // Los documentos que hoy están guardados: los del bucket (de cualquier
  // intento, incluso de otro día) más los que subió recién. Es lo que la hoja
  // de error le muestra para que sepa que no perdió nada.
  const ETIQUETA_DOC = {
    titulo: 'Título profesional',
    matricula: 'Matrícula profesional',
    dni: 'DNI',
    seguro_mala_praxis: 'Seguro de mala praxis',
    certificado_especialista: 'Certificado de especialista',
    cuit: 'CUIT / Monotributo',
  }
  const docsGuardados = Object.keys(ETIQUETA_DOC)
    .filter(k => existingDocs[k] || yaSubido.current[k])
    .map(k => ETIQUETA_DOC[k])

  const submit = async () => {
    setLoading(true)
    try {
      /*
       * 🔴 Los archivos se suben DE A UNO, no en paralelo (2026-09-12).
       *
       * Iban los 7 juntos con `Promise.all`. Desde un teléfono con datos
       * móviles eso es media docena de subidas multipart compitiendo por la
       * misma conexión: alcanza con que UNA se corte para que el `Promise.all`
       * rechace, y entonces **se pierde todo** — el legajo no se guarda, el
       * profesional ve un "Failed to fetch" que no le dice nada, y los archivos
       * que sí subieron quedan huérfanos en el bucket. Le pasó a un profesional
       * real con 3 PDF en 4G: subió sólo el DNI y `professional_profiles` quedó
       * sin crear.
       *
       * De a uno + dos reintentos, y lo que ya subió en este intento no se
       * vuelve a subir (`yaSubido`), así que reintentar es barato.
       */
      const uploadDoc = async (file, fileName, etiqueta) => {
        if (!file) return existingDocs[fileName]?.url || ''
        if (yaSubido.current[fileName]) return yaSubido.current[fileName]
        const url = await conReintento(
          () => professionalService.uploadDocument(profile.id, file, 'professional-docs', fileName),
          etiqueta,
        )
        yaSubido.current[fileName] = url
        return url
      }

      if (avatarFile && !yaSubido.current.avatar) {
        yaSubido.current.avatar = await conReintento(
          () => profilesService.uploadAvatar(profile.id, avatarFile), 'tu foto',
        )
      }
      const titleUrl          = await uploadDoc(titleFile, 'titulo', 'el título')
      const licenseUrl        = await uploadDoc(licenseFile, 'matricula', 'la matrícula')
      const dniUrl            = await uploadDoc(dniFile, 'dni', 'el DNI')
      const malpracticeUrl    = await uploadDoc(malpracticeFile, 'seguro_mala_praxis', 'el seguro de mala praxis')
      const specialistCertUrl = await uploadDoc(specialistCertFile, 'certificado_especialista', 'el certificado de especialista')
      const cuitUrl           = await uploadDoc(cuitFile, 'cuit', 'el CUIT')

      // El DNI vive en `profiles`, no en `professional_profiles`: es un dato de
      // la persona, no de su perfil profesional. Se saca del payload para no
      // mandarlo a la tabla equivocada.
      const { dni, gender, ...formSinDni } = form
      // 🔴 Vacío NO se manda. `profiles.gender` tiene un CHECK con cuatro
      // valores (migración 006) y `''` no es ninguno: el PATCH vuelve 400 y el
      // envío entero se cae **después** de haber subido todos los archivos.
      // Pasa de verdad al entrar por el "te faltan documentos" del dashboard
      // (`?resubmit=1&step=2`), que saltea el paso donde se piden esos datos:
      // si el profesional no los tenía cargados, el legajo no se guardaba nunca.
      const datosPersona = {}
      if (dni?.trim()) datosPersona.dni = dni.trim()
      if (gender) datosPersona.gender = gender
      if (Object.keys(datosPersona).length) {
        await profilesService.update(profile.id, datosPersona)
      }

      // Precio, modalidad, zona y dirección NO van en este payload a propósito
      // (la bio sí, viene dentro de `form`):
      // ese dato se completa después en Configuración/Perfil, y omitir la clave
      // (en vez de mandarla en '' o null) hace que el upsert de Postgres no la
      // toque — así un reenvío nunca pisa lo que el profesional ya haya cargado
      // ahí post-aprobación.
      const payload = {
        ...formSinDni,
        titleDocumentUrl:   titleUrl   || undefined,
        licenseDocumentUrl: licenseUrl || undefined,
        dniDocumentUrl:     dniUrl     || undefined,
        malpracticeInsuranceDocumentUrl:  malpracticeUrl    || undefined,
        specialistCertificateDocumentUrl: specialistCertUrl || undefined,
        cuitDocumentUrl:                  cuitUrl           || undefined,
        license_type:       form.licenseType,
        license_number:     form.licenseNumber,
        isVerified:         false,
        isActive:           false,
        submittedAt:        new Date().toISOString(),
        rejectionReason:    null,
        rejectedAt:         null,
      }
      await professionalService.upsert(profile.id, payload)

      track('sign_up_complete', { flow: 'profesional', profile_completed: true })
      setErrorEnvio(null)
      toast.success('¡Perfil enviado! Un administrador lo revisará pronto.')
      navigate('/profesional/dashboard')
    } catch (err) {
      // La hoja reemplaza al toast para el error: un cartel que se va solo no
      // deja reintentar ni dice que lo subido está a salvo, que es lo que hace
      // que alguien abandone el alta. Ver EnvioFallidoSheet.
      setErrorEnvio(err.message || 'No pudimos enviar tu legajo.')
      // Lo que sí llegó al bucket tiene que aparecer como "ya subido" antes de
      // que vuelva a intentar: si no, el segundo intento repite las mismas
      // subidas y se cae en el mismo lugar.
      // Ojo: sólo se pisa si el listado trajo algo. `listDocuments` devuelve
      // `{}` cuando falla, y si la conexión sigue caída eso borraría de la hoja
      // la lista de lo que el profesional ya tiene guardado — justo cuando más
      // necesita verla.
      professionalService.listDocuments(profile.id)
        .then(docs => { if (Object.keys(docs).length) setExistingDocs(docs) })
        .catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary grid lg:grid-cols-2">
      {/* Left — form wizard */}
      <div className="py-10 px-4 overflow-y-auto">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="page-title-lg text-text-primary">
            {isResubmit ? 'Corregir y reenviar' : 'Completá tu perfil clínico'}
          </h1>
          <p className="text-text-secondary mt-1.5 text-base">
            {isResubmit
              ? 'Actualizá la información solicitada y volvé a enviar.'
              : `Paso ${step + 1} de ${STEPS.length} — ${STEPS[step].label}`}
          </p>
        </div>

        {/* Step tracker */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done    = i < step
            const current = i === step
            return (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => done && setStep(i)}
                  className={`flex flex-col items-center gap-1 group ${done ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border-2 ${
                    done    ? 'bg-brand border-brand text-white'
                    : current ? 'bg-white border-brand text-brand'
                    : 'bg-white border-border-default text-text-tertiary'
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${current ? 'text-brand' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    {s.short}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${i < step ? 'bg-brand' : 'bg-border-default'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Step card */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary text-xl border-b border-border-default pb-3">
            {STEPS[step].label}
          </h2>

          {/* ── Step 0: Especialidad ─────────────────────────────── */}
          {step === 0 && (
            <>
              <div>
                <label className="form-label">¿Cuál es tu profesión? <span className="text-danger">*</span></label>
                <div className="mb-4">
                  <AnimatedTagCascade
                    animate={false}
                    items={PROFESSION_CATEGORIES.map(c => ({ value: c.id, label: c.label, icon: c.icon }))}
                    value={categoryId}
                    onSelect={id => {
                      if (id === categoryId) return
                      setCategoryId(id)
                      setSpecialtySearch('')
                      setSubSpecialtyCustom(false)
                      setForm(p => ({ ...p, specialty: '', subSpecialty: '' }))
                    }}
                  />
                </div>

                {categoryId && (() => {
                  const catSpecialties = specialtiesForCategory(categoryId, porSlug)
                  return (
                    <>
                      {/* Sin esta etiqueta la segunda fila de chips se leía como
                          continuación de la de profesión, y nadie entendía que
                          era otra pregunta —obligatoria— que había que contestar. */}
                      <label className="form-label">¿Cuál es tu especialidad? <span className="text-danger">*</span></label>
                      {catSpecialties.length > 4 && (
                        <div className="relative mb-3">
                          <MagnifyingGlass className="h-4 w-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={specialtySearch}
                            onChange={e => setSpecialtySearch(e.target.value)}
                            className="form-input pl-9"
                            placeholder="Buscar especialidad..."
                          />
                        </div>
                      )}
                      <AnimatedTagCascade
                        items={catSpecialties.filter(s =>
                          s.label.toLowerCase().includes(specialtySearch.toLowerCase())
                        )}
                        value={form.specialty}
                        onSelect={value => {
                          if (value === form.specialty) return
                          setSubSpecialtyCustom(false)
                          setForm(p => ({ ...p, specialty: value, subSpecialty: '' }))
                        }}
                        cascadeKey={categoryId}
                      />
                    </>
                  )
                })()}
              </div>
              <div>
                <label className="form-label">Sub-especialidad <span className="text-text-tertiary text-xs">(opcional)</span></label>
                <select
                  value={showCustomSub ? '__otra__' : (form.subSpecialty || '')}
                  onChange={e => {
                    if (e.target.value === '__otra__') { setSubSpecialtyCustom(true); setForm(p => ({ ...p, subSpecialty: '' })) }
                    else { setSubSpecialtyCustom(false); setForm(p => ({ ...p, subSpecialty: e.target.value })) }
                  }}
                  className="form-select"
                  disabled={!form.specialty}
                >
                  <option value="">Ninguna</option>
                  {subOptions.map(s => <option key={s.id} value={s.slug}>{s.label}</option>)}
                  <option value="__otra__">Otra (especificar)</option>
                </select>
                {showCustomSub && (
                  <input
                    type="text"
                    value={form.subSpecialty}
                    onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))}
                    className="form-input mt-2"
                    placeholder="Ej: Cardiología Clínica"
                  />
                )}
              </div>
              <div>
                <label className="form-label">Matrícula <span className="text-danger">*</span></label>
                <div className="flex gap-2 mb-3">
                  {['MN', 'MP'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, licenseType: type }))}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        form.licenseType === type
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white border-border-default text-text-secondary'
                      }`}
                    >
                      {type === 'MN' ? 'MN — Matrícula Nacional' : 'MP — Matrícula Provincial'}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={form.licenseNumber}
                  onChange={e => setForm(p => ({ ...p, licenseNumber: e.target.value }))}
                  className="form-input"
                  placeholder="Ej: 123456"
                />
                <p className="text-xs text-text-tertiary mt-1">Número de matrícula</p>
              </div>
            </>
          )}

          {/* ── Step 1: Datos personales ─────────────────────────── */}
          {step === 1 && (
            <>
              <div>
                <label className="form-label">Foto de perfil <span className="text-text-tertiary text-xs">(opcional)</span></label>
                {avatarPreview && (
                  <img src={avatarPreview} alt="preview" className="w-20 h-20 rounded-full object-cover mb-3 border-2 border-brand/30" />
                )}
                <FileUpload
                  onFile={handleAvatar}
                  accept="image/*"
                  label={avatarFile ? avatarFile.name : 'Subir foto (JPG, PNG)'}
                  hint="Que se te vea la cara con claridad, de frente y con buena luz."
                />
                {/* Si la cuenta se creó con Google ya hay una foto guardada
                    (authService la persiste al alta): esto la reemplaza, no la
                    exige. */}
                <p className="text-xs text-text-tertiary mt-1">
                  Si entraste con Google ya usamos la de tu cuenta. Podés cambiarla acá.
                </p>
              </div>

              <div>
                <label className="form-label">DNI <span className="text-danger">*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.dni}
                  onChange={e => setForm(p => ({ ...p, dni: e.target.value.replace(/\D/g, '') }))}
                  placeholder="Sin puntos, ej: 28999888"
                  className="form-input"
                />
                {/* Obligatorio: sin DNI del médico Innovamed rechaza la receta
                    con QBI156. Va acá y no en Documentación porque es un dato,
                    no un archivo — el DNI escaneado sigue siendo otra cosa. */}
                <p className="text-xs text-text-tertiary mt-1 mb-4">
                  Necesario para emitir recetas electrónicas.
                </p>
              </div>

              <div>
                <label className="form-label">Sexo <span className="text-danger">*</span></label>
                <select
                  value={form.gender}
                  onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                  className="form-input"
                >
                  <option value="">Elegí una opción</option>
                  {OPCIONES_SEXO.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {/* Igual que el DNI: Innovamed lo exige para el profesional
                    (QBI206) y hasta ahora no se pedía en ningún lado, así que
                    ningún profesional podía emitir aunque tuviera matrícula. */}
                <p className="text-xs text-text-tertiary mt-1 mb-4">
                  Necesario para emitir recetas electrónicas.
                </p>
              </div>

              <div>
                <label className="form-label">Bio / Presentación <span className="text-text-tertiary text-xs">(opcional)</span></label>
                <textarea
                  value={form.bio}
                  onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
                  rows={5}
                  className="form-textarea"
                  placeholder="Contale a los pacientes tu experiencia, enfoque y formación..."
                />
                <p className="text-xs text-text-tertiary mt-1">{form.bio.length}/500 caracteres</p>
              </div>
            </>
          )}

          {/* ── Step 2: Documentación ────────────────────────────── */}
          {step === 2 && (
            <>
              <p className="text-base text-text-secondary -mt-1">
                Necesitamos verificar tus credenciales antes de habilitarte. Todos los archivos se almacenan de forma cifrada.
              </p>
              <div>
                <label className="form-label">Título profesional</label>
                <FileUpload
                  onFile={setTitleFile}
                  existing={existingDocs.titulo}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={titleFile ? titleFile.name : 'Subir título (PDF o imagen)'}
                />
              </div>
              <div>
                <label className="form-label">Matrícula profesional</label>
                <FileUpload
                  onFile={setLicenseFile}
                  existing={existingDocs.matricula}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={licenseFile ? licenseFile.name : 'Subir matrícula (PDF o imagen)'}
                />
              </div>
              <div>
                <label className="form-label">DNI <span className="text-text-tertiary text-xs">(frente y dorso en un archivo)</span></label>
                <FileUpload
                  onFile={setDniFile}
                  existing={existingDocs.dni}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={dniFile ? dniFile.name : 'Subir DNI (PDF o imagen)'}
                />
              </div>
              <div>
                <label className="form-label">Seguro de mala praxis <span className="text-text-tertiary text-xs">(recomendado)</span></label>
                <FileUpload
                  onFile={setMalpracticeFile}
                  existing={existingDocs.seguro_mala_praxis}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={malpracticeFile ? malpracticeFile.name : 'Subir póliza de responsabilidad civil profesional'}
                />
              </div>
              {form.subSpecialty && (
                <div>
                  <label className="form-label">Certificado de especialista <span className="text-text-tertiary text-xs">(requerido si declarás sub-especialidad)</span></label>
                  <FileUpload
                    onFile={setSpecialistCertFile}
                    existing={existingDocs.certificado_especialista}
                    accept=".pdf,.jpg,.jpeg,.png"
                    label={specialistCertFile ? specialistCertFile.name : `Subir certificado de especialista en ${form.subSpecialty}`}
                  />
                  <p className="text-xs text-text-tertiary mt-1">La matrícula acredita el título general — para ejercer como especialista se requiere el certificado emitido por el Ministerio de Salud o el colegio profesional correspondiente.</p>
                </div>
              )}
              <div>
                <label className="form-label">CUIT / Monotributo <span className="text-text-tertiary text-xs">(para facturación)</span></label>
                <input
                  type="text"
                  value={form.cuitNumber}
                  onChange={e => setForm(p => ({ ...p, cuitNumber: e.target.value }))}
                  className="form-input mb-2"
                  placeholder="Ej: 20-12345678-9"
                />
                <FileUpload
                  onFile={setCuitFile}
                  existing={existingDocs.cuit}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={cuitFile ? cuitFile.name : 'Subir constancia de CUIT/Monotributo (AFIP)'}
                />
              </div>
            </>
          )}

          {/* ── Step 3: Datos y privacidad ───────────────────────── */}
          {step === 3 && (
            <>
              <p className="text-base text-text-secondary -mt-1">
                Nos tomamos muy en serio la privacidad de tus pacientes y la tuya. Así te protege cada norma:
              </p>
              <div className="space-y-2">
                {LAWS.map(l => (
                  <a
                    key={l.code}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 p-3 rounded-xl border border-border-default hover:border-brand/40 transition-colors group"
                  >
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{l.code} <span className="font-normal text-text-secondary">— {l.label}</span></p>
                      <p className="text-xs text-text-tertiary mt-0.5">{l.desc}</p>
                    </div>
                    <span className="text-xs font-medium text-brand shrink-0 group-hover:underline whitespace-nowrap">Ver texto →</span>
                  </a>
                ))}
              </div>
              <p className="text-sm text-text-secondary">
                Obtené más información en nuestros{' '}
                <a href="/terminos" target="_blank" rel="noreferrer" className="text-brand font-medium underline">Términos y Condiciones</a>.
              </p>
              <label className="flex items-start gap-3 p-3 rounded-xl border border-border-default cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={e => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand"
                />
                <span className="text-sm text-text-secondary">
                  Acepto los{' '}
                  <a href="/terminos" target="_blank" rel="noreferrer" className="text-brand font-medium underline">Términos del servicio</a>
                  {' '}y el manejo de datos personales conforme a la Ley 25.326.
                </span>
              </label>
            </>
          )}

          {/* ── Step 4: Revisión ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4 text-sm">
              <div className="rounded-xl bg-bg-surface divide-y divide-border-default border border-border-default overflow-hidden">
                {[
                  ['Especialidad',      porSlug[form.specialty] || '—'],
                  ['Sub-especialidad',  form.subSpecialty || '—'],
                  ['Matrícula',         form.licenseNumber ? `${form.licenseType} ${form.licenseNumber}` : '—'],
                  ['DNI',               form.dni || '—'],
                  ['Sexo',              OPCIONES_SEXO.find(o => o.value === form.gender)?.label || '—'],
                  ['Foto de perfil',    avatarFile ? avatarFile.name : (profile?.avatarUrl ? 'La de tu cuenta de Google' : '—')],
                  ['Bio',               form.bio ? `${form.bio.slice(0, 80)}${form.bio.length > 80 ? '…' : ''}` : '—'],
                  ['Título',           docResumen(titleFile,          'titulo')],
                  ['Doc. matrícula',   docResumen(licenseFile,        'matricula')],
                  ['Doc. DNI',         docResumen(dniFile,            'dni')],
                  ['Seguro mala praxis', docResumen(malpracticeFile,  'seguro_mala_praxis')],
                  ...(form.subSpecialty ? [['Cert. especialista', docResumen(specialistCertFile, 'certificado_especialista')]] : []),
                  ['CUIT/Monotributo', [form.cuitNumber, cuitFile?.name || existingDocs.cuit?.name].filter(Boolean).join(' — ') || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="font-medium text-text-primary w-36 shrink-0">{label}</span>
                    <span className="text-text-secondary break-all">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl border border-brand/25 bg-brand-muted">
                <LinkSimple className="h-4 w-4 text-brand mt-0.5 shrink-0" />
                <p className="text-xs text-text-secondary">
                  Una vez aprobado tu perfil, vas a necesitar <span className="font-semibold text-text-primary">conectar Mercado Pago</span> desde
                  {' '}Configuración para poder recibir turnos — sin eso conectado los pacientes no van a poder reservarte.
                </p>
              </div>
              <p className="text-xs text-text-tertiary pt-1">
                Al enviar aceptás los Términos de Servicio de Healthier. La revisión demora 24–48 hs hábiles.
              </p>
            </div>
          )}

          {/* Qué falta para poder seguir. Va arriba del botón, y sólo mientras
              falte algo: es la única pista de por qué "Siguiente" está gris. */}
          {step < STEPS.length - 1 && falta.length > 0 && (
            <p className="text-sm text-text-tertiary">
              Para seguir falta {falta.length > 1
                ? `${falta.slice(0, -1).join(', ')} y ${falta[falta.length - 1]}`
                : falta[0]}.
            </p>
          )}

          {/* Navigation */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 border-t border-border-default">
            {step > 0 && (
              <button onClick={prev} className="btn-secondary flex-1">
                ← Anterior
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={!canAdvance()}
                className="btn-primary flex-1"
              >
                Siguiente →
              </button>
            ) : (
              <button onClick={submit} disabled={loading} className="btn-primary flex-1">
                {loading ? 'Enviando…' : 'Enviar para revisión'}
              </button>
            )}
          </div>
        </div>

        {/* Skip option — Documentación es el único paso opcional que queda:
            todos los archivos se pueden enviar después, esto solo lo hace
            explícito para que no parezca un paso bloqueante. */}
        {step === 2 && (
          <button onClick={next} className="mt-3 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors">
            Subo los documentos después →
          </button>
        )}
      </div>
      </div>

      {/* Right — live preview panel. Sticky + self-start so it stays pinned to
          the viewport instead of stretching to match the left form's height
          (which grows a lot on steps like Documentación/Revisión). */}
      <div className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start bg-bg-secondary p-8">
        <OnboardingPreview step={step} form={form} profile={profile} avatarPreview={avatarPreview} />
      </div>

      <EnvioFallidoSheet
        open={!!errorEnvio}
        motivo={errorEnvio}
        subidos={docsGuardados}
        reintentando={loading}
        onClose={() => setErrorEnvio(null)}
        onReintentar={submit}
      />
    </div>
  )
}
