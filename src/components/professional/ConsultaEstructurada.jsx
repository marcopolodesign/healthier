import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IdentificationCard, Question, NotePencil, ClockCounterClockwise, ListChecks,
  Heartbeat, Stethoscope, Target, Plus, X, CheckCircle, Check, CircleNotch,
  CaretDown, CaretUp,
} from '@phosphor-icons/react'
import DatosPacienteTab from './DatosPacienteTab'
import CopilotoClinico from './CopilotoClinico'
import { toast } from '../Toast'
import { useConsultaDraft } from '../../hooks/useConsultaDraft'
import {
  ANTEC_CHIPS, FAM_CHIPS, SISTEMAS_EXAMEN, GUIDE_MOTIVOS, suggestMotivoFromPreconsulta,
} from '../../lib/clinicalGuideKB'
import {
  toggleSintomaOrigen, toggleSintomaChecked, removeSintoma, addSintomaManual,
  toggleDiferencial, removeDiferencial, evaluarTA, evaluarFC, evaluarFR, evaluarTemp,
  evaluarSat, calcularIMC, categoriaIMC, guardarConsultaEnHC,
} from '../../lib/consultaDraft'

// Border-radius normal (Mateo, 2026-08-24: "no tan pronunciado") — no usa la
// utility `form-input`, que es 999px (pill), pensada para inputs de una
// línea. Las tres textareas de esta pantalla comparten esta clase.
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-border-default bg-bg-secondary px-3 py-2 text-xs text-text-primary ' +
  'placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ' +
  'resize-none transition-colors'

function NumberedSection({ n, icon: Icon, label, children }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold text-brand tabular-nums shrink-0">{n}.</span>
        <Icon className="h-4 w-4 text-brand shrink-0" />
        <h4 className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">{label}</h4>
        <span className="flex-1 h-px bg-border-default" />
      </div>
      {children}
    </section>
  )
}

function ChipToggle({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'bg-brand text-white border-brand' : 'border-border-default text-text-secondary hover:border-brand hover:text-brand'
      }`}
    >
      {label}
    </button>
  )
}

function VitalInput({ label, unidad, rango, value, onChange, fueraDeRango }) {
  return (
    <div>
      <label className="text-[9px] font-semibold text-text-tertiary uppercase tracking-wide block mb-1">
        {label}
        {rango && <span className="normal-case font-normal text-text-tertiary/70"> ({rango})</span>}
      </label>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`form-input text-xs py-1.5 pr-8 ${fueraDeRango ? '!border-amber-400 !bg-amber-50' : ''}`}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-text-tertiary pointer-events-none">{unidad}</span>
      </div>
    </div>
  )
}

/**
 * "02. Motivo" → "08. Diagnóstico" — la consulta estructurada de la
 * videollamada (Mateo, 2026-08-24). Absorbe la vieja sección "Paciente"
 * (ahora "01. Filiación") y el viejo `GuiaClinicaConsulta` (ahora el
 * "Copiloto clínico" de la columna derecha, `CopilotoClinico.jsx`).
 *
 * TODO lo que se documenta acá vive en un único borrador (`useConsultaDraft`,
 * persistido en `consultations.hc_draft`) y se asienta como UNA sola entrada
 * de la HC al tocar "Guardar consulta en la HC" o al cerrar la consulta
 * (auto-asentado, ver `CloseConsultationModal.jsx`) — no una entrada por
 * cada tap, que era el problema del componente que reemplaza.
 */
export default function ConsultaEstructurada({
  consultation, patientId, professionalId, specialty, licenseType, licenseNumber,
  loadingProfProfile, ensureEncounter, onEntryAdded, patientData, loadingPatientData, historia,
}) {
  const { draft, update } = useConsultaDraft({
    consultationId: consultation?.id,
    initialHcDraft: consultation?.hcDraft,
  })

  const sugerido = useMemo(() => suggestMotivoFromPreconsulta(consultation?.preconsultaData), [consultation?.preconsultaData])

  // Precarga del motivo sugerido por la pre-consulta — una sola vez, y sólo si
  // todavía no hay nada elegido. Mismo patrón que la cobertura precargada en
  // `ClinicalPanel` (VideoCall.jsx): precargar no es forzar, el profesional
  // lo cambia libre después.
  const motivoPrecargado = useRef(false)
  useEffect(() => {
    if (motivoPrecargado.current) return
    if (draft.motivo || draft.motivoLibre) { motivoPrecargado.current = true; return }
    if (!sugerido) return
    motivoPrecargado.current = true
    update(d => (d.motivo || d.motivoLibre) ? d : { ...d, motivo: sugerido })
  }, [sugerido, draft.motivo, draft.motivoLibre, update])

  // Precarga de peso/talla desde el perfil del paciente (`profiles.weight_kg`
  // / `height_cm`) — una sola vez, y sólo si el campo sigue vacío. Hasta que
  // el celular mande estos datos solos (Apple Health / Google Health), es lo
  // más cercano a "ya cargado" que hay.
  const vitalesPrecargados = useRef(false)
  useEffect(() => {
    if (vitalesPrecargados.current || loadingPatientData) return
    vitalesPrecargados.current = true
    const pesoInicial = patientData?.weightKg != null ? String(patientData.weightKg) : ''
    const tallaInicial = patientData?.heightCm != null ? String(patientData.heightCm) : ''
    if (!pesoInicial && !tallaInicial) return
    update(d => ({
      ...d,
      vitales: {
        ...d.vitales,
        peso: d.vitales.peso || pesoInicial,
        talla: d.vitales.talla || tallaInicial,
      },
    }))
  }, [loadingPatientData, patientData, update])

  const [nuevoSintoma, setNuevoSintoma] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [copilotoAbierto, setCopilotoAbierto] = useState(true)

  const esMotivoLibre = !draft.motivo && !!draft.motivoLibre
  const motivoSelectValue = draft.motivo ? draft.motivo : (esMotivoLibre ? '__otro' : '')

  function handleMotivoChange(value) {
    if (value === '__otro') update(d => ({ ...d, motivo: null }))
    else update(d => ({ ...d, motivo: value || null, motivoLibre: '' }))
  }

  function toggleChip(grupo, chip) {
    update(d => {
      const lista = d.antecedentes[grupo]
      const next = lista.includes(chip) ? lista.filter(c => c !== chip) : [...lista, chip]
      return { ...d, antecedentes: { ...d.antecedentes, [grupo]: next } }
    })
  }

  function setVital(campo, valor) {
    update(d => ({ ...d, vitales: { ...d.vitales, [campo]: valor } }))
  }

  function setExamenEstado(sistema, valor) {
    update(d => {
      const actual = d.examen.sistemas[sistema]
      const sistemas = { ...d.examen.sistemas }
      if (actual === valor) delete sistemas[sistema]
      else sistemas[sistema] = valor
      return { ...d, examen: { ...d.examen, sistemas } }
    })
  }

  function agregarSintomaManual() {
    const texto = nuevoSintoma.trim()
    if (!texto) return
    update(d => addSintomaManual(d, texto))
    setNuevoSintoma('')
  }

  async function handleGuardar() {
    if (guardando) return
    setGuardando(true)
    try {
      const entry = await guardarConsultaEnHC({ draft, ensureEncounter, patientId, professionalId, licenseType, licenseNumber })
      onEntryAdded(entry)
      update(d => ({ ...d, asentada: true }))
      toast.success('Consulta guardada en la historia clínica')
    } catch {
      toast.error('No se pudo guardar la consulta')
    } finally {
      setGuardando(false)
    }
  }

  // Alergias y medicación activa — ya cargadas por otra parte del panel
  // (`historia`, ver ClinicalPanel), sólo se leen acá de nuevo.
  const alergiasTexto = (historia?.allergies ?? []).map(a => a.substance).filter(Boolean).join(', ')
  const medicacionTexto = useMemo(() => {
    const nombres = new Set()
    for (const enc of historia?.encounters ?? []) {
      for (const m of enc.medications ?? []) {
        if (m.status === 'active' && m.medicationName) nombres.add(m.medicationName)
      }
    }
    return [...nombres].join(', ')
  }, [historia])

  const estadoTA = evaluarTA(Number(draft.vitales.taSistolica), Number(draft.vitales.taDiastolica))
  const estadoFC = evaluarFC(Number(draft.vitales.fc))
  const estadoFR = evaluarFR(Number(draft.vitales.fr))
  const estadoTemp = evaluarTemp(Number(draft.vitales.temp))
  const estadoSat = evaluarSat(Number(draft.vitales.sat))
  const imc = calcularIMC(draft.vitales.peso, draft.vitales.talla)

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
      {/* Columna derecha en desktop (30%), primera en el DOM para que en
          mobile — donde se apilan — el copiloto aparezca arriba del
          formulario (pedido explícito de Mateo). */}
      <div className="order-1 lg:order-2 w-full lg:w-[30%] shrink-0">
        <button
          type="button"
          onClick={() => setCopilotoAbierto(v => !v)}
          className="lg:hidden w-full flex items-center justify-between text-[11px] font-bold text-text-tertiary uppercase tracking-widest px-1 py-1.5"
        >
          Copiloto clínico
          {copilotoAbierto ? <CaretUp className="h-3.5 w-3.5" /> : <CaretDown className="h-3.5 w-3.5" />}
        </button>
        <div className={`${copilotoAbierto ? 'block' : 'hidden'} lg:block lg:sticky lg:top-2`}>
          <CopilotoClinico
            motivo={draft.motivo}
            motivoLibre={draft.motivoLibre}
            draft={draft}
            onToggleBandera={texto => update(d => toggleSintomaOrigen(d, texto, 'bandera'))}
            onTogglePregunta={texto => update(d => toggleSintomaOrigen(d, texto, 'pregunta'))}
            onToggleDiferencial={(nombre, cie) => update(d => toggleDiferencial(d, nombre, cie))}
          />
        </div>
      </div>

      <div className="order-2 lg:order-1 w-full lg:w-[70%] min-w-0 space-y-6">
        <NumberedSection n="01" icon={IdentificationCard} label="Filiación">
          <DatosPacienteTab loading={loadingPatientData} patient={patientData} />
        </NumberedSection>

        <NumberedSection n="02" icon={Question} label="Motivo">
          <select
            className="form-select text-xs py-1.5 w-full"
            value={motivoSelectValue}
            onChange={e => handleMotivoChange(e.target.value)}
          >
            <option value="">Elegí un motivo…</option>
            {GUIDE_MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="__otro">Otro / no está en la lista</option>
          </select>
          {sugerido && draft.motivo === sugerido && (
            <p className="text-[10px] text-text-tertiary mt-1">Precargado desde lo que declaró el paciente.</p>
          )}
          {esMotivoLibre && (
            <input
              type="text"
              className="form-input text-xs py-1.5 mt-2"
              placeholder="Escribí el motivo de consulta…"
              value={draft.motivoLibre}
              onChange={e => update(d => ({ ...d, motivoLibre: e.target.value }))}
            />
          )}
        </NumberedSection>

        <NumberedSection n="03" icon={NotePencil} label="Enfermedad Actual">
          <textarea
            rows={4}
            className={TEXTAREA_CLASS}
            placeholder="Cronología y caracterización del síntoma: localización, inicio, carácter, irradiación, intensidad, atenuantes/agravantes, síntomas asociados…"
            value={draft.enfermedadActual}
            onChange={e => update(d => ({ ...d, enfermedadActual: e.target.value }))}
          />
        </NumberedSection>

        <NumberedSection n="04" icon={ClockCounterClockwise} label="Antecedentes">
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide mb-1.5">Personales patológicos</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {ANTEC_CHIPS.map(chip => (
                  <ChipToggle key={chip} label={chip} active={draft.antecedentes.personales.includes(chip)} onClick={() => toggleChip('personales', chip)} />
                ))}
              </div>
              <textarea
                rows={2}
                className={TEXTAREA_CLASS}
                placeholder="Otros antecedentes…"
                value={draft.antecedentes.personalesOtros}
                onChange={e => update(d => ({ ...d, antecedentes: { ...d.antecedentes, personalesOtros: e.target.value } }))}
              />
            </div>

            <div>
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide mb-1.5">Familiares</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {FAM_CHIPS.map(chip => (
                  <ChipToggle key={chip} label={chip} active={draft.antecedentes.familiares.includes(chip)} onClick={() => toggleChip('familiares', chip)} />
                ))}
              </div>
              <textarea
                rows={2}
                className={TEXTAREA_CLASS}
                placeholder="Otros antecedentes familiares…"
                value={draft.antecedentes.familiaresOtros}
                onChange={e => update(d => ({ ...d, antecedentes: { ...d.antecedentes, familiaresOtros: e.target.value } }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="form-label text-[11px] mb-1">Tabaquismo</label>
                <select
                  className="form-select text-xs py-1.5"
                  value={draft.antecedentes.tabaquismo}
                  onChange={e => update(d => ({ ...d, antecedentes: { ...d.antecedentes, tabaquismo: e.target.value } }))}
                >
                  <option value="">—</option>
                  <option value="nunca">Nunca fumó</option>
                  <option value="ex_fumador">Ex fumador</option>
                  <option value="actual">Fumador actual</option>
                </select>
              </div>
              <div>
                <label className="form-label text-[11px] mb-1">Alcohol</label>
                <input
                  type="text"
                  className="form-input text-xs py-1.5"
                  value={draft.antecedentes.alcohol}
                  onChange={e => update(d => ({ ...d, antecedentes: { ...d.antecedentes, alcohol: e.target.value } }))}
                />
              </div>
              <div>
                <label className="form-label text-[11px] mb-1">Actividad física</label>
                <input
                  type="text"
                  className="form-input text-xs py-1.5"
                  value={draft.antecedentes.actividadFisica}
                  onChange={e => update(d => ({ ...d, antecedentes: { ...d.antecedentes, actividadFisica: e.target.value } }))}
                />
              </div>
            </div>

            {(alergiasTexto || medicacionTexto) && (
              <p className="text-[11px] text-text-secondary rounded-lg border border-border-default bg-bg-surface p-2 leading-relaxed">
                <span className="font-semibold text-text-tertiary">Del registro: </span>
                {alergiasTexto && <>Alergias: {alergiasTexto}</>}
                {alergiasTexto && medicacionTexto && ' · '}
                {medicacionTexto && <>Medicación: {medicacionTexto}</>}
              </p>
            )}
          </div>
        </NumberedSection>

        <NumberedSection n="05" icon={ListChecks} label="Síntomas">
          <div className="space-y-1.5">
            {draft.sintomas.length === 0 && (
              <p className="text-xs text-text-tertiary">Sin síntomas cargados todavía. Marcalos desde el copiloto o agregalos acá.</p>
            )}
            {draft.sintomas.map((s, i) => (
              <div key={`${s.origen}-${s.texto}-${i}`} className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5">
                <button type="button" onClick={() => update(d => toggleSintomaChecked(d, i))} className="shrink-0">
                  <CheckCircle className={`h-4 w-4 ${s.checked ? 'text-emerald-600' : 'text-text-tertiary/40'}`} weight={s.checked ? 'fill' : 'regular'} />
                </button>
                <span className={`flex-1 text-xs ${s.checked ? 'text-text-primary' : 'text-text-tertiary line-through'}`}>{s.texto}</span>
                {s.origen !== 'manual' && (
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                    {s.origen === 'bandera' ? 'bandera roja' : 'pregunta'}
                  </span>
                )}
                <button type="button" onClick={() => update(d => removeSintoma(d, i))} className="shrink-0 text-text-tertiary hover:text-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-2">
            <input
              type="text"
              className="form-input text-xs py-1.5 flex-1"
              placeholder="Agregar síntoma…"
              value={nuevoSintoma}
              onChange={e => setNuevoSintoma(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarSintomaManual() } }}
            />
            <button type="button" onClick={agregarSintomaManual} className="btn-secondary px-3 text-xs shrink-0 flex items-center">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </NumberedSection>

        <NumberedSection n="06" icon={Heartbeat} label="Vitales">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <VitalInput label="TA sist." unidad="mmHg" value={draft.vitales.taSistolica} onChange={v => setVital('taSistolica', v)} fueraDeRango={estadoTA && estadoTA !== 'normal'} />
            <VitalInput label="TA diast." unidad="mmHg" value={draft.vitales.taDiastolica} onChange={v => setVital('taDiastolica', v)} fueraDeRango={estadoTA && estadoTA !== 'normal'} />
            <VitalInput label="FC" unidad="lpm" rango="60–100" value={draft.vitales.fc} onChange={v => setVital('fc', v)} fueraDeRango={estadoFC && estadoFC !== 'normal'} />
            <VitalInput label="FR" unidad="rpm" rango="12–20" value={draft.vitales.fr} onChange={v => setVital('fr', v)} fueraDeRango={estadoFR && estadoFR !== 'normal'} />
            <VitalInput label="T°" unidad="°C" rango="36–37,5" value={draft.vitales.temp} onChange={v => setVital('temp', v)} fueraDeRango={estadoTemp && estadoTemp !== 'normal'} />
            <VitalInput label="SatO2" unidad="%" rango="≥95" value={draft.vitales.sat} onChange={v => setVital('sat', v)} fueraDeRango={estadoSat && estadoSat !== 'normal'} />
            <VitalInput label="Peso" unidad="kg" value={draft.vitales.peso} onChange={v => setVital('peso', v)} />
            <VitalInput label="Talla" unidad="cm" value={draft.vitales.talla} onChange={v => setVital('talla', v)} />
          </div>
          {imc != null && (
            <p className="text-[11px] text-text-secondary mt-2">
              IMC: <span className="font-semibold text-text-primary">{imc.toFixed(1)}</span> — {categoriaIMC(imc)}
            </p>
          )}
          <p className="text-[10px] text-text-tertiary mt-2">
            Más adelante se van a autocompletar desde Apple Health / Google Health en el celular.
          </p>
        </NumberedSection>

        <NumberedSection n="07" icon={Stethoscope} label="Examen físico">
          <div className="space-y-1.5">
            {SISTEMAS_EXAMEN.map(sistema => {
              const estado = draft.examen.sistemas[sistema]
              return (
                <div key={sistema} className="flex items-center justify-between gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5">
                  <span className="text-xs text-text-primary flex-1">{sistema}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExamenEstado(sistema, 'normal')}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        estado === 'normal' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-border-default text-text-tertiary hover:bg-white'
                      }`}
                    >
                      Normal
                    </button>
                    <button
                      type="button"
                      onClick={() => setExamenEstado(sistema, 'alterado')}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        estado === 'alterado' ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      Alterado
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <textarea
            rows={3}
            className={`${TEXTAREA_CLASS} mt-2`}
            placeholder="Hallazgos…"
            value={draft.examen.hallazgos}
            onChange={e => update(d => ({ ...d, examen: { ...d.examen, hallazgos: e.target.value } }))}
          />
        </NumberedSection>

        <NumberedSection n="08" icon={Target} label="Diagnóstico">
          {draft.diferenciales.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draft.diferenciales.map(d => (
                <span key={d.nombre} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700">
                  {d.nombre}{d.cie ? ` · ${d.cie}` : ''}
                  <button type="button" onClick={() => update(dr => removeDiferencial(dr, d.nombre))} className="hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder="Diagnóstico…"
            value={draft.diagnosticoTexto}
            onChange={e => update(d => ({ ...d, diagnosticoTexto: e.target.value }))}
          />
        </NumberedSection>

        <div className="rounded-lg border-2 border-brand/20 bg-brand-muted/10 p-3 space-y-2">
          <p className="text-xs text-text-secondary leading-relaxed">
            Todo lo de arriba se guarda como UNA sola entrada en la historia clínica.
          </p>
          <button
            type="button"
            onClick={handleGuardar}
            disabled={guardando || loadingProfProfile}
            title={loadingProfProfile ? 'Esperando el perfil profesional…' : undefined}
            className="btn-primary w-full py-2.5 text-sm disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {(guardando || loadingProfProfile) ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {draft.asentada ? 'Actualizar consulta en la HC' : 'Guardar consulta en la HC'}
          </button>
          {draft.asentada && (
            <p className="text-[11px] text-emerald-700 text-center">
              Ya quedó asentada. Guardar de nuevo agrega una entrada nueva con los cambios.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
