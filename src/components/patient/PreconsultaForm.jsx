import { useEffect, useMemo, useRef, useState } from 'react'
import { X, CircleNotch, ClipboardText, ArrowLeft, Check, Phone } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { toast } from '../Toast'
import { supabase } from '../../lib/supabase'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'
import { triageDe, preguntasDe, cierreDe } from '../../data/triage'
import { armarPreconsulta, pasosDe, todasRespondidas, motivoCompleto, NO_SE, LIMITES } from '../../lib/armarPreconsulta'
import { faltanDatosPaciente, listar, OPCIONES_SEXO } from '../../lib/datosReceta'
import { profilesService } from '../../services/profilesService'
import BarraDePasos from './BarraDePasos'

/**
 * Botón de opción (radio / checkbox visual).
 *
 * Vive en el módulo, NO dentro de PreconsultaForm: definirlo adentro crea un
 * tipo de componente nuevo en cada render y React desmonta y vuelve a montar
 * todas las opciones. Ver la nota larga sobre el mismo problema en el `return`
 * de PreconsultaForm.
 */
// `blanco` es el modo de Teleclínica (Felipe, 2026-10-19): un solo estado
// elegido (borde 1,5 px de marca + fondo de marca al 8 %), sin hover en
// pantallas táctiles, opción de 16 px regular, y check cuadrado si es múltiple.
function OptionButton({ selected, label, onClick, blanco = false, multi = false }) {
  const forma = multi && blanco ? 'rounded-md' : 'rounded-full'
  if (blanco) {
    return (
      <button
        onClick={onClick}
        aria-pressed={selected}
        className={`w-full text-left px-4 py-3 rounded-2xl text-[16px] font-normal flex items-center gap-3 ${
          selected
            ? 'border-[1.5px] border-brand bg-brand/[0.08] text-text-primary'
            : 'border-[1.5px] border-gray-200 bg-white text-gray-800 [@media(hover:hover)]:hover:border-gray-300'
        }`}
      >
        <span className={`w-5 h-5 ${forma} border flex items-center justify-center flex-shrink-0 ${
          selected ? 'border-brand bg-brand' : 'border-gray-300 bg-white'
        }`}>
          {selected && <Check className="w-3 h-3 text-white" weight="bold" />}
        </span>
        <span className="flex-1">{label}</span>
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-2xl border text-[15px] font-medium transition-colors flex items-center gap-3 ${
        selected
          ? 'border-brand bg-brand-muted text-text-primary'
          : 'border-gray-200 bg-bg-primary text-gray-700 hover:border-gray-300'
      }`}
    >
      <span className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
        selected ? 'border-brand bg-brand' : 'border-gray-300'
      }`}>
        {selected && <Check className="w-3 h-3 text-white" weight="bold" />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

/**
 * Aviso debajo de una pregunta cuando el paciente elige una opción con `aviso`
 * (hoy: la de riesgo de salud mental). No bloquea nada. Sobrio a propósito
 * (Felipe): recuadro lavanda suave sin borde ni ícono de alerta ni rojo, la frase,
 * un botón para llamar por cada línea, el 911 y un cierre. Al aparecer se
 * asegura de quedar a la vista, que no lo tape el botón fijo de abajo.
 */
function Aviso({ aviso }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [])
  return (
    <div ref={ref} data-testid="preconsulta-aviso" className="rounded-2xl bg-brand-tertiary-muted p-4 space-y-3">
      <p className="text-[16px] font-normal text-text-primary leading-snug">{aviso.texto}</p>
      {(aviso.llamadas ?? []).map(l => (
        <a
          key={l.tel}
          href={`tel:${l.tel}`}
          className="flex items-center gap-3 min-h-12 px-4 py-2.5 rounded-2xl bg-white border-[1.5px] border-border-default"
        >
          <Phone className="w-5 h-5 text-brand shrink-0" weight="bold" />
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-medium text-text-primary">{l.label}</span>
            {l.detalle && <span className="block text-[14px] text-text-secondary">{l.detalle}</span>}
          </span>
        </a>
      ))}
      {aviso.emergencia && (
        <p className="text-[14px] text-text-primary">
          Si estás en peligro, llamá al <a href={`tel:${aviso.emergencia}`} className="font-medium underline underline-offset-2">{aviso.emergencia}</a>.
        </p>
      )}
      {aviso.cierre && <p className="text-[14px] text-text-secondary">{aviso.cierre}</p>}
    </div>
  )
}

/**
 * Una pregunta del triage, de cualquier tipo: single, multi, single_with_detail,
 * texto o numero. Vive en el módulo por la misma razón que `OptionButton`.
 */
function Pregunta({ q, respuestas, detalles, onSingle, onMulti, onTexto, onNumero, onDetalle, inline, ayuda, fondoCampo }) {
  const raw = respuestas[q.id]
  const eligio = o => (q.type === 'multi' ? Array.isArray(raw) && raw.includes(o.value) : raw === o.value)
  const avisos = (q.options ?? []).filter(o => o.aviso && eligio(o))
  const elegidaConDetalle = q.type === 'single_with_detail' ? q.options.find(o => o.value === raw && o.detailLabel) : null
  // En `inline` los campos van a 16 px: con menos, Safari de iOS hace zoom al enfocarlos.
  const campo = `w-full ${fondoCampo} border-[1.5px] border-gray-200 rounded-2xl px-4 py-3 outline-none placeholder:text-gray-400 focus:border-brand transition-colors ${
    inline ? 'text-[16px] font-normal text-text-primary' : 'text-[15px] font-medium text-gray-900'
  }`

  return (
    <div className="space-y-2">
      <div>
        <p className={inline ? 'text-[16px] font-medium text-text-primary' : 'text-[15px] font-bold text-gray-900'}>{q.label}</p>
        {q.ayuda && <p className={`${ayuda} mt-1 leading-[1.4]`}>{q.ayuda}</p>}
      </div>
      {q.type === 'multi' && <p className={`${ayuda} font-medium -mt-1`}>Podés elegir más de una</p>}

      {(q.type === 'single' || q.type === 'multi' || q.type === 'single_with_detail') && q.options.map(o => (
        <OptionButton
          blanco={inline}
          multi={q.type === 'multi'}
          key={o.value}
          selected={eligio(o)}
          label={o.label}
          onClick={() => (q.type === 'multi' ? onMulti(q, o) : onSingle(q, o))}
        />
      ))}

      {elegidaConDetalle && (
        <div className="pt-2">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">{elegidaConDetalle.detailLabel}</label>
          <textarea
            rows={2}
            maxLength={LIMITES.detalle}
            value={detalles[q.id] ?? ''}
            onChange={e => onDetalle(q.id, e.target.value)}
            placeholder={q.id === 'medicacion' ? 'Ej: Omeprazol 20mg, Ibuprofeno 400mg' : ''}
            className={`${campo} resize-none`}
          />
        </div>
      )}

      {q.type === 'texto' && (
        <textarea
          rows={2}
          maxLength={LIMITES.texto}
          value={raw ?? ''}
          onChange={e => onTexto(q.id, e.target.value)}
          placeholder={q.placeholder ?? ''}
          aria-label={q.label}
          className={`${campo} resize-none`}
        />
      )}

      {q.type === 'numero' && (<>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            maxLength={6}
            value={raw === NO_SE ? '' : (raw ?? '')}
            onChange={e => onNumero(q.id, e.target.value.replace(/[^\d.,]/g, ''))}
            aria-label={q.label}
            className={`${campo} ${q.unidad ? 'pr-14' : ''}`}
          />
          {q.unidad && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-text-secondary pointer-events-none">{q.unidad}</span>}
        </div>
        {/* "No lo sé" y el número se excluyen: escribir uno saca el otro. */}
        {q.opcionNoSe && (
          <button
            type="button"
            onClick={() => onNumero(q.id, raw === NO_SE ? '' : NO_SE)}
            aria-pressed={raw === NO_SE}
            className={`w-full text-left px-4 py-3 rounded-lg text-[16px] font-normal border-[1.5px] ${
              raw === NO_SE ? 'border-brand bg-brand/[0.08] text-text-primary' : 'border-gray-200 bg-white text-gray-800'
            }`}
          >
            {q.opcionNoSe}
          </button>
        )}
      </>)}

      {/* Los avisos viven en una región `aria-live`: al elegir la opción se anuncian. */}
      <div aria-live="polite">
        {avisos.map(o => <Aviso key={o.value} aviso={o.aviso} />)}
      </div>
    </div>
  )
}

/**
 * PreconsultaForm
 *
 * Pre-consulta estructurada, con el triage PROPIO de cada vertical (ver
 * `src/data/triage.js`): en Clínica el paciente elige UN síntoma de un catálogo
 * codificado en ICD-10 y contesta las preguntas de ese síntoma; en psicología
 * cuenta el motivo con sus palabras; cada vertical pregunta lo que su
 * profesional necesita. Los pasos se arman de una lista (`pasosDe`) y se saltean
 * los que quedan vacíos. El payload lo arma `armarPreconsulta`, función pura.
 *
 * Props:
 *   vertical       – id de la vertical cuyo triage se usa. Sin vertical (o null) es
 *                    Clínica, lo de siempre. Para una consulta agendada, ver
 *                    `verticalDeConsulta`.
 *   isOpen         – boolean, controla visibilidad
 *   onClose        – dismiss sin enviar (ignorado cuando `required`)
 *   consultationId – string | null — UUID de la consulta; si es null se saltea el guardado
 *   onSubmitted    – se llama tras enviar (o saltear, si no es required)
 *   pedirDatos     – pregunta los datos de la receta que falten (por defecto, = required).
 *                    Teleclínica lo pide fuera de la sala: ahí la preconsulta va antes
 *                    del pago y la sala ya no la vuelve a mostrar.
 *   permitirOmitir – muestra "Omitir por ahora" (por defecto, si no es required).
 *   required       – el paciente no puede saltear ni cerrar, y un guardado fallido
 *                    mantiene el formulario abierto en vez de dejar pasar. Lo usa la
 *                    sala de espera: anunciar presencia convoca al profesional, así
 *                    que esto tiene que estar contestado ANTES.
 *   inline         – Teleclínica (opción B, 2026-10-19): las preguntas son la
 *                    pantalla, no un modal. Sin X ni flecha propia (la flecha es
 *                    la de la página), "Paso X de N" con la barra en tramos, y
 *                    queda montado aunque `isOpen` sea false para que "Cambiar"
 *                    no borre lo contestado.
 *   step / onStepChange – el paso, controlado desde afuera (lo usa `inline`:
 *                    la flecha de la página retrocede un paso).
 *   pasosExtra     – pasos que vienen DESPUÉS de las preguntas (el pago), para
 *                    que N cuente el recorrido entero.
 *   onPasosChange  – se llama con la cantidad de pasos del formulario (sin
 *                    `pasosExtra`) cada vez que cambia: depende de la vertical, del
 *                    motivo elegido y de si faltan datos. Así el padre no la duplica.
 *   textoFinal     – el botón del último paso. En Teleclínica, "Continuar": no
 *                    dice "Pagar" porque todavía no se paga (Mateo).
 *   arriba         – algo que va arriba del primer paso ("La consulta es: Para mí").
 */
export default function PreconsultaForm({ isOpen, onClose, consultationId, onSubmitted, required = false, profile = null, onProfileUpdate, pedirDatos = required, permitirOmitir = !required, inline = false, step: stepControlado, onStepChange, pasosExtra = 0, onPasosChange, textoFinal, arriba = null, vertical = null }) {
  // Datos que Innovamed exige para emitir una receta y que el paciente puede no
  // tener cargados. Se pregunta SOLO lo que falta: quien ya los tiene no ve este
  // paso. Y se pregunta acá porque es el único momento obligatorio antes de la
  // consulta — pedirlos al registrarse agrega fricción a alguien que todavía no
  // sabe si va a usar la app.
  const faltantes = pedirDatos ? faltanDatosPaciente(profile) : []
  const pideDatos = faltantes.length > 0
  const [datos, setDatos] = useState({ dni: '', gender: '', birthDate: '' })
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const triage = useMemo(() => triageDe(vertical), [vertical])
  const [motivoId, setMotivoId] = useState(null)
  const [textoMotivo, setTextoMotivo] = useState('')  // motivo abierto, o el de "Otro motivo"
  const [respuestas, setRespuestas] = useState({})   // { [questionId]: value | value[] }
  const [detalles, setDetalles] = useState({})       // { [questionId]: texto del detalle }

  const abierto = triage.motivo.tipo === 'abierto'
  const motivo = useMemo(
    () => (abierto ? null : (triage.motivo.opciones.find(o => o.id === motivoId) ?? null)),
    [triage, abierto, motivoId],
  )
  const preguntas = useMemo(() => preguntasDe(triage, motivo), [triage, motivo])
  const cierre = useMemo(() => cierreDe(triage), [triage])

  // Los pasos salen de acá: título, validación, ayudas, barra, "Paso X de N" y
  // el último paso. Un paso sin preguntas no existe.
  const pasos = useMemo(() => pasosDe({ triage, motivo, pideDatos }), [triage, motivo, pideDatos])
  const ultimoPaso = pasos.length - 1
  const totalPasos = pasos.length + pasosExtra
  useEffect(() => { onPasosChange?.(pasos.length) }, [pasos.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const [stepInterno, setStepInterno] = useState(0)
  const step = Math.min(stepControlado ?? stepInterno, ultimoPaso)
  const paso = pasos[step]
  // Cambiar de paso vuelve el scroll arriba: si no, al pasar del listado de
  // síntomas (más largo que la pantalla) se aterriza a mitad de las preguntas.
  const cuerpoRef = useRef(null)
  useEffect(() => { if (cuerpoRef.current) cuerpoRef.current.scrollTop = 0 }, [step])
  const setStep = (sigue) => {
    const n = typeof sigue === 'function' ? sigue(step) : sigue
    if (onStepChange) onStepChange(n)
    else setStepInterno(n)
  }

  const motivoOk = motivoCompleto({ triage, motivo, textoMotivo })
  const preguntasOk = todasRespondidas(preguntas, respuestas, detalles)
  const cierreOk = todasRespondidas(cierre, respuestas, detalles)
  // El paso de datos solo se da por completo cuando está lo que falta.
  const datosOk = !pideDatos || faltantes.every(f => String(datos[f.campo] ?? '').trim() !== '')
  const okDe = { motivo: motivoOk, preguntas: preguntasOk, cierre: cierreOk, datos: datosOk }
  const pasoOk = okDe[paso]

  // ── Answer handlers ─────────────────────────────────────────────────────────
  const pickSingle = (q, o) => {
    setRespuestas(prev => ({ ...prev, [q.id]: o.value }))
    // Cambiar de opción tira el detalle de la anterior.
    if (q.type === 'single_with_detail' && !o.detailLabel) setDetalles(prev => ({ ...prev, [q.id]: '' }))
  }
  const setRespuesta = (qid, valor) => setRespuestas(prev => ({ ...prev, [qid]: valor }))
  const setDetalle = (qid, texto) => setDetalles(prev => ({ ...prev, [qid]: texto }))

  // Al cambiar de motivo se limpian las respuestas de SUS preguntas (paso 2),
  // no las del cierre: la medicación no depende del motivo.
  const elegirMotivo = (o) => {
    const ids = new Set(preguntas.map(q => q.id))
    const sinIds = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => !ids.has(k)))
    setRespuestas(sinIds)
    setDetalles(sinIds)
    setMotivoId(o.id)
  }

  const toggleMulti = (question, option) => {
    setRespuestas(prev => {
      const current = Array.isArray(prev[question.id]) ? prev[question.id] : []
      // "Ninguno de estos" se excluye mutuamente con el resto — marcarlo limpia
      // las demás, y marcar cualquier otra lo saca.
      if (option.exclusive) return { ...prev, [question.id]: [option.value] }
      const withoutExclusive = current.filter(v => {
        const opt = question.options.find(o => o.value === v)
        return !opt?.exclusive
      })
      const next = withoutExclusive.includes(option.value)
        ? withoutExclusive.filter(v => v !== option.value)
        : [...withoutExclusive, option.value]
      return { ...prev, [question.id]: next }
    })
  }

  // ── Payload ─────────────────────────────────────────────────────────────────
  // `main_complaint` / `symptoms` / `current_medications` se siguen escribiendo
  // derivados a propósito (lo hace `armarPreconsulta`): el panel del profesional
  // (PreconsultaSummary) y el gate de la sala de espera los leen, y romperlos
  // dejaría consultas viejas y nuevas en dos formatos incompatibles.
  const buildPayload = () => armarPreconsulta({ triage, motivo, textoMotivo, respuestas, detalles })

  // Los datos del paciente van al perfil, no a la consulta: son suyos y
  // sirven para todas las recetas futuras. Se piden una sola vez.
  const guardarDatosDelPaciente = async () => {
    if (!pideDatos || !profile?.id) return
    const patch = Object.fromEntries(
      faltantes.map(f => [f.campo, String(datos[f.campo]).trim()]),
    )
    try {
      const actualizado = await profilesService.update(profile.id, patch)
      onProfileUpdate?.(actualizado)
    } catch (e) {
      // No bloquea la consulta: el profesional va a ver qué falta al recetar.
      console.warn('[PreconsultaForm] no se pudieron guardar los datos del paciente:', e)
    }
  }

  const handleSubmit = async () => {
    if (submitting || !motivoOk || !preguntasOk || !cierreOk || !datosOk) return
    setSubmitting(true)
    setSaveError(null)

    const payload = buildPayload()

    // Sin consulta todavía (Teleclínica: la preconsulta va antes del pago y
    // viaja en el pedido): se devuelven las respuestas a quien abrió el
    // formulario. Los datos para la receta igual se guardan en el perfil.
    if (!consultationId) {
      await guardarDatosDelPaciente()
      setSubmitting(false)
      onSubmitted(payload)
      return
    }

    try {
      const { error } = await supabase
        .from('consultations')
        .update({ preconsulta_data: payload })
        .eq('id', consultationId)
      if (error) throw error

      await guardarDatosDelPaciente()

      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.PRECONSULTA_SUBMITTED, {
        symptom: payload.symptom?.id,
        icd10: payload.symptom?.icd10_code,
        has_red_flags: payload.has_red_flags,
      })
      toast.success('Pre-consulta enviada')
      setSubmitting(false)
      onSubmitted(payload)
    } catch (err) {
      setSubmitting(false)
      if (required) {
        console.warn('[PreconsultaForm] Save failed (blocking):', err)
        setSaveError('No pudimos guardar tus respuestas. Revisá la conexión y probá de nuevo.')
        return
      }
      console.warn('[PreconsultaForm] Save error (non-blocking):', err)
      onSubmitted(payload)
    }
  }

  // En Teleclínica el texto secundario va a 14 px (Felipe); en el modal, como siempre.
  const fondoCampo = inline ? 'bg-white' : 'bg-bg-primary'
  const ayuda = inline ? 'text-[14px] text-gray-500' : 'text-[12px] text-gray-400'
  const titulos = {
    motivo: triage.motivo.titulo,
    preguntas: triage.tituloPreguntas ?? motivo?.label ?? triage.motivo.titulo,
    cierre: triage.cierre?.titulo ?? '',
    datos: 'Tus datos',
  }
  const ayudaDelPaso = paso === 'motivo' ? triage.motivo.ayuda : paso === 'preguntas' ? 'Contanos un poco más.' : null
  const ANCHO_PROGRESO = { 1: ['w-full'], 2: ['w-1/2', 'w-full'], 3: ['w-1/3', 'w-2/3', 'w-full'], 4: ['w-1/4', 'w-2/4', 'w-3/4', 'w-full'] }

  if (required && !isOpen) return null

  // El contenido es el mismo en los dos modos; solo cambia el envoltorio.
  //
  // Ojo con cómo se elige ese envoltorio: acá vivía un componente `Shell`
  // definido adentro del render. Como se creaba una función nueva en cada
  // render, React lo trataba como un tipo de componente distinto y desmontaba y
  // volvía a montar TODO el formulario. La sala de espera re-renderiza dos veces
  // por segundo (la animación de puntitos de WaitingRoom), así que el contenedor
  // scrolleable se recreaba cada 500 ms y el scroll saltaba de vuelta arriba: en
  // el paso "¿Qué te pasa?", que es más largo que la pantalla, era literalmente
  // imposible scrollear. Los envoltorios tienen que ser JSX inline como acá
  // abajo — `div` y `PatientSheet` son tipos estables entre renders.
  // El botón y sus ayudas: dentro del cuerpo en el modal, fijo abajo en `inline`.
  const cta = (
        <div className="space-y-3 pb-2 pt-1">
          {saveError && <p className="text-[13px] font-semibold text-danger text-center">{saveError}</p>}

          {step < ultimoPaso ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!pasoOk}
              className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-colors ${
                pasoOk
                  ? 'bg-brand text-white hover:bg-brand-hover'
                  : 'bg-[#E9EBEA] text-[#9AA0A6] cursor-not-allowed'
              }`}
            >
              Continuar
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !pasoOk}
              className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-colors flex justify-center items-center gap-2 ${
                submitting || !pasoOk
                  ? 'bg-[#E9EBEA] text-[#9AA0A6] cursor-not-allowed'
                  : 'bg-brand text-white hover:bg-brand-hover'
              }`}
            >
              {submitting
                ? <><CircleNotch className="w-5 h-5 animate-spin" /> Enviando...</>
                : (textoFinal ?? (required ? 'Ingresar en sala de espera' : 'Completar pre-consulta'))}
            </button>
          )}

          {!pasoOk && (
            <p className={`${ayuda} text-center font-medium`}>
              {paso === 'motivo' && (abierto || motivo?.freeText ? 'Contanos qué te pasa para continuar.' : 'Elegí un motivo para continuar.')}
              {(paso === 'preguntas' || paso === 'cierre') && 'Contestá todas las preguntas para continuar.'}
              {paso === 'datos' && `Completá ${listar(faltantes)} para continuar.`}
            </p>
          )}

          {permitirOmitir && paso === 'motivo' && (
            <button
              onClick={() => onSubmitted()}
              disabled={submitting}
              className="w-full py-3 text-[14px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
            >
              Omitir por ahora
            </button>
          )}
        </div>
  )

  const contenido = (
    <>
      {inline ? (
        // Encabezado fijo con fondo opaco y una línea abajo: la lista corre por
        // debajo con un corte limpio (Felipe).
        <div className="px-4 sm:px-6 pt-1 pb-4 flex-shrink-0 bg-bg-primary border-b border-gray-200/70">
          <BarraDePasos paso={step + 1} total={totalPasos} className="mb-5" />
          <h2 className="text-[28px] font-light text-gray-900 leading-tight">{titulos[paso]}</h2>
          {ayudaDelPaso && <p className="text-[14px] text-gray-500 leading-snug mt-1">{ayudaDelPaso}</p>}
        </div>
      ) : (<>
      {/* Header */}
      <div className="px-6 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-border-default">
        {step > 0 ? (
          <button
            onClick={() => setStep(step - 1)}
            className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
        ) : (
          <div className="w-10 h-10 bg-brand-muted rounded-full flex items-center justify-center flex-shrink-0">
            <ClipboardText className="w-5 h-5 text-brand" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-[20px] font-black text-gray-900 leading-none truncate">{titulos[paso]}</h2>
          <p className="text-[12px] text-gray-400 font-medium mt-0.5">Paso {step + 1} de {pasos.length}</p>
        </div>
        {!required && (
          <button
            onClick={onClose}
            className="w-9 h-9 bg-white border border-gray-200 rounded-full flex items-center justify-center hover:bg-gray-50 flex-shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>

      {/* Progress */}
      <div className="h-1 bg-gray-100 flex-shrink-0">
        <div className={`h-full bg-brand transition-all duration-300 ${ANCHO_PROGRESO[pasos.length]?.[step] ?? 'w-full'}`} />
      </div>
      </>)}

      {/* Body */}
      <div ref={cuerpoRef} className={`flex-1 overflow-y-auto scrollbar-hide space-y-5 ${inline ? 'px-4 sm:px-6 pt-5 pb-10' : 'px-6 py-5'}`}>

        {/* ── Motivo ── */}
        {paso === 'motivo' && (
          <div className="space-y-2">
            {arriba}
            {!inline && triage.motivo.ayuda && (
              <p className="text-[13px] text-gray-500 font-medium mb-3">{triage.motivo.ayuda}</p>
            )}

            {abierto ? (
              // El título del paso ya hace la pregunta: el campo no repite el label
              // a la vista, sólo para lectores de pantalla (Felipe).
              <textarea
                rows={5}
                maxLength={LIMITES.motivo}
                value={textoMotivo}
                onChange={e => setTextoMotivo(e.target.value)}
                placeholder={triage.motivo.placeholder ?? ''}
                aria-label={triage.motivo.label}
                data-testid="preconsulta-motivo-abierto"
                className={`w-full bg-white border-[1.5px] border-gray-200 rounded-2xl px-4 py-3 outline-none placeholder:text-gray-400 focus:border-brand transition-colors resize-none ${
                  inline ? 'text-[16px] font-normal text-text-primary' : 'text-[15px] font-medium text-gray-900'
                }`}
              />
            ) : (<>
              {triage.motivo.opciones.map(o => (
                <OptionButton
                  blanco={inline}
                  key={o.id}
                  selected={motivoId === o.id}
                  label={o.label}
                  onClick={() => elegirMotivo(o)}
                />
              ))}
              {motivo?.freeText && (
                <div className="pt-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">
                    {motivo.freeTextLabel}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={LIMITES.motivo}
                    value={textoMotivo}
                    onChange={e => setTextoMotivo(e.target.value)}
                    placeholder="Ej: me duele la rodilla desde ayer"
                    className={`w-full ${fondoCampo} border-[1.5px] border-gray-200 rounded-2xl px-4 py-3 outline-none placeholder:text-gray-400 focus:border-brand transition-colors resize-none ${
                      inline ? 'text-[16px] font-normal text-text-primary' : 'text-[15px] font-medium text-gray-900'
                    }`}
                  />
                </div>
              )}
            </>)}
          </div>
        )}

        {/* ── Preguntas del motivo y cierre (medicación, alergias, peso) ── */}
        {(paso === 'preguntas' || paso === 'cierre') && (paso === 'preguntas' ? preguntas : cierre).map(q => (
          <Pregunta
            key={q.id}
            q={q}
            respuestas={respuestas}
            detalles={detalles}
            onSingle={pickSingle}
            onMulti={toggleMulti}
            onTexto={setRespuesta}
            onNumero={setRespuesta}
            onDetalle={setDetalle}
            inline={inline}
            ayuda={ayuda}
            fondoCampo={fondoCampo}
          />
        ))}

        {/* ── Datos que faltan para la receta ── */}
        {paso === 'datos' && (
          <div className="space-y-4">
            <p className={`${inline ? 'text-[14px]' : 'text-[13px]'} text-gray-500 leading-snug`}>
              Necesitamos {listar(faltantes)} para que el profesional pueda emitirte una
              receta electrónica. Se pide una sola vez.
            </p>

            {faltantes.some(f => f.campo === 'dni') && (
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">DNI</label>
                <input
                  type="text" inputMode="numeric" value={datos.dni}
                  onChange={e => setDatos(d => ({ ...d, dni: e.target.value.replace(/\D/g, '') }))}
                  placeholder="Sin puntos, ej: 30111222"
                  className={`w-full ${fondoCampo} border border-gray-200 rounded-2xl px-4 py-3 outline-none ${inline ? 'text-[16px] font-normal text-text-primary' : 'text-[15px] font-medium text-gray-900'} placeholder:text-gray-400 focus:border-brand transition-colors`}
                />
              </div>
            )}

            {faltantes.some(f => f.campo === 'birthDate') && (
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Fecha de nacimiento</label>
                <input
                  type="date" value={datos.birthDate}
                  onChange={e => setDatos(d => ({ ...d, birthDate: e.target.value }))}
                  max={new Date().toISOString().slice(0, 10)}
                  className={`w-full ${fondoCampo} border border-gray-200 rounded-2xl px-4 py-3 outline-none ${inline ? 'text-[16px] font-normal text-text-primary' : 'text-[15px] font-medium text-gray-900'} focus:border-brand transition-colors`}
                />
              </div>
            )}

            {faltantes.some(f => f.campo === 'gender') && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest block">Sexo</label>
                {OPCIONES_SEXO.map(o => (
                  <OptionButton
                blanco={inline}
                    key={o.value}
                    selected={datos.gender === o.value}
                    label={o.label}
                    onClick={() => setDatos(d => ({ ...d, gender: o.value }))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!inline && cta}
      </div>

      {/* En Teleclínica el botón queda fijo abajo: con 13 síntomas, "Continuar"
          quedaba fuera de la pantalla (Felipe). */}
      {inline && (
        <div className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-bg-primary border-t border-gray-100">
          {cta}
        </div>
      )}
    </>
  )

  // En modo `required` esto es un PASO del flujo, no un accesorio: va a pantalla
  // completa. El bottom sheet sugería que se podía descartar, que es justo lo
  // contrario de lo que tiene que comunicar.
  if (required) {
    return <div className="fixed inset-0 z-[100] bg-bg-secondary flex flex-col">{contenido}</div>
  }

  // Teleclínica: las preguntas son la pantalla. Se oculta en vez de desmontarse
  // para que volver desde el pago ("Cambiar") encuentre lo contestado.
  if (inline) {
    return <div className={isOpen ? 'flex-1 min-h-0 flex flex-col' : 'hidden'} data-testid="preconsulta-inline">{contenido}</div>
  }

  return (
    <PatientSheet open={isOpen} onClose={onClose} maxWidth="max-w-lg" backdropClose={false}>
      {contenido}
    </PatientSheet>
  )
}
