import { useMemo, useState } from 'react'
import { Warning, CheckCircle, CaretDown, CaretUp, Info } from '@phosphor-icons/react'
import { clinicalService } from '../../services/clinicalService'
import { toast } from '../Toast'
import { CLINICAL_GUIDE_KB, GUIDE_MOTIVOS, suggestMotivoFromPreconsulta, DISCLAIMER } from '../../lib/clinicalGuideKB'

/**
 * Guía clínica de la consulta — pestaña "Hoy" de `ClinicalPanel`
 * (`pages/professional/VideoCall.jsx`).
 *
 * Muestra, para el motivo de consulta elegido: banderas rojas a descartar,
 * preguntas dirigidas para hacerle al paciente EN la llamada, examen y
 * estudios sugeridos, y diferenciales con CIE-10. Contenido en
 * `src/lib/clinicalGuideKB.js`.
 *
 * Cada interacción (elegir motivo, marcar una bandera roja, tocar una
 * pregunta) escribe una `clinical_entry` de una — preguntar y documentar son
 * el mismo gesto, y lo cargado sobrevive a un refresh porque se relee de las
 * entradas ya guardadas del encuentro (`entries`, cargadas por `ClinicalPanel`
 * igual que el resto de la nota clínica). No hay estado que viva sólo en
 * memoria.
 */

const KIND = {
  MOTIVO: 'guia_motivo',
  RED_FLAG: 'guia_bandera_roja',
  QUESTION: 'guia_pregunta',
}

// Fallback estable para "sin motivo elegido todavía" — evita crear un Set
// nuevo en cada render sólo para poder llamarle `.has()`.
const EMPTY_SET = new Set()

// `entries` llega en orden cronológico ascendente (así las devuelve
// `clinicalService.getEncounterWithDetail`, y así se le van agregando las
// nuevas en `ClinicalPanel`) — el último match de una recorrida en orden es
// el estado vigente. Una sola pasada para las 3 derivaciones (motivo guardado,
// estado de banderas rojas, preguntas ya hechas por motivo): `entries` es TODA
// la nota clínica del encuentro, no sólo la de esta guía, y recorrerla 3 veces
// por cada nota nueva que se agrega en cualquier lado de la consulta es trabajo
// de más sin beneficio.
function deriveGuiaState(entries) {
  let motivo = null
  const redFlags = {}
  const askedByMotivo = new Map()
  for (const e of entries) {
    if (e?.data?.source !== 'guia_clinica') continue
    switch (e.data.kind) {
      case KIND.MOTIVO:
        motivo = e.data.motivo
        break
      case KIND.RED_FLAG:
        redFlags[e.data.texto] = e.data.estado
        break
      case KIND.QUESTION: {
        const set = askedByMotivo.get(e.data.motivo) ?? new Set()
        set.add(e.data.texto)
        askedByMotivo.set(e.data.motivo, set)
        break
      }
      default:
        break
    }
  }
  return { motivo, redFlags, askedByMotivo }
}

export default function GuiaClinicaConsulta({
  entries, preconsulta, patientId, professionalId, licenseType, licenseNumber,
  ensureEncounter, onEntryAdded,
}) {
  const sugerido = useMemo(() => suggestMotivoFromPreconsulta(preconsulta), [preconsulta])
  const guiaState = useMemo(() => deriveGuiaState(entries), [entries])
  // Override optimista: no espera el round-trip a Supabase para reflejar la
  // elección — `guiaState.motivo` la termina confirmando cuando `entries` se
  // actualiza.
  const [motivoLocal, setMotivoLocal] = useState(null)
  const motivo = motivoLocal ?? guiaState.motivo ?? sugerido ?? ''

  const [guardandoMotivo, setGuardandoMotivo] = useState(false)
  const [pendingFlag, setPendingFlag] = useState(null)
  const [pendingQuestion, setPendingQuestion] = useState(null)
  const [showExamen, setShowExamen] = useState(false)
  const [showEstudios, setShowEstudios] = useState(false)

  const guia = motivo ? CLINICAL_GUIDE_KB[motivo] : null
  const redFlagState = guiaState.redFlags
  const asked = guiaState.askedByMotivo.get(motivo) ?? EMPTY_SET

  async function elegirMotivo(nuevo) {
    if (!nuevo || nuevo === motivo) return
    setMotivoLocal(nuevo)
    setGuardandoMotivo(true)
    try {
      const eid = await ensureEncounter()
      const entry = await clinicalService.addEntry(eid, {
        patientId, professionalId, entryType: 'note',
        content: `Motivo de consulta (guía clínica): ${nuevo}`,
        data: { source: 'guia_clinica', kind: KIND.MOTIVO, motivo: nuevo },
        licenseType, licenseNumber,
      })
      onEntryAdded(entry)
    } catch {
      toast.error('No se pudo guardar el motivo de consulta')
    } finally {
      setGuardandoMotivo(false)
    }
  }

  async function marcarBandera(texto, estado) {
    if (pendingFlag) return
    setPendingFlag(texto)
    try {
      const eid = await ensureEncounter()
      const entry = await clinicalService.addEntry(eid, {
        patientId, professionalId, entryType: 'note',
        content: `Bandera roja — ${texto}: ${estado === 'presente' ? 'presente' : 'descartada'}`,
        data: { source: 'guia_clinica', kind: KIND.RED_FLAG, texto, estado, motivo },
        licenseType, licenseNumber,
      })
      onEntryAdded(entry)
    } catch {
      toast.error('No se pudo guardar la bandera roja')
    } finally {
      setPendingFlag(null)
    }
  }

  async function preguntar(texto) {
    if (asked.has(texto) || pendingQuestion) return
    setPendingQuestion(texto)
    try {
      const eid = await ensureEncounter()
      const entry = await clinicalService.addEntry(eid, {
        patientId, professionalId, entryType: 'note',
        content: `Pregunta dirigida — ${texto}`,
        data: { source: 'guia_clinica', kind: KIND.QUESTION, texto, motivo },
        licenseType, licenseNumber,
      })
      onEntryAdded(entry)
    } catch {
      toast.error('No se pudo registrar la pregunta')
    } finally {
      setPendingQuestion(null)
    }
  }

  return (
    <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
      <div>
        <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide block mb-1">
          Motivo de consulta
        </label>
        <select
          className="form-select text-xs py-1.5 w-full"
          value={motivo}
          disabled={guardandoMotivo}
          onChange={e => elegirMotivo(e.target.value)}
        >
          <option value="">Elegí un motivo…</option>
          {GUIDE_MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {/* El cartel es sólo para el motivo inferido de la pre-consulta: se esconde
            apenas hay uno guardado en la historia o uno elegido a mano, porque ahí
            ya no es una precarga sino una decisión del profesional. */}
        {sugerido && !guiaState.motivo && !motivoLocal && (
          <p className="text-[10px] text-text-tertiary mt-1">Precargado desde lo que declaró el paciente.</p>
        )}
      </div>

      {guia && (
        <>
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 p-2">
            <Info className="h-3.5 w-3.5 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-[10px] text-amber-800 leading-relaxed">{DISCLAIMER}</p>
          </div>

          {/* Banderas rojas primero — es lo que no se puede pasar por alto */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide flex items-center gap-1">
              <Warning className="h-3 w-3" weight="fill" /> Banderas rojas — descartar
            </p>
            <ul className="space-y-1.5">
              {guia.rf.map(texto => {
                const estado = redFlagState[texto]
                const loading = pendingFlag === texto
                return (
                  <li key={texto} className="flex items-start justify-between gap-2 text-xs">
                    <span className={
                      estado === 'presente' ? 'flex-1 text-red-700 font-semibold' :
                      estado === 'descartada' ? 'flex-1 text-text-tertiary line-through' :
                      'flex-1 text-text-primary'
                    }>
                      {texto}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <button type="button" disabled={loading} onClick={() => marcarBandera(texto, 'descartada')}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                          estado === 'descartada'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'border-border-default text-text-tertiary hover:bg-white'
                        }`}>
                        Descartada
                      </button>
                      <button type="button" disabled={loading} onClick={() => marcarBandera(texto, 'presente')}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                          estado === 'presente'
                            ? 'bg-red-600 text-white border-red-600'
                            : 'border-red-300 text-red-700 hover:bg-red-100'
                        }`}>
                        Presente
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Preguntas dirigidas — accionables: tocar = preguntar + documentar */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Preguntas dirigidas</p>
            <ul className="space-y-1">
              {guia.q.map(texto => {
                const done = asked.has(texto)
                return (
                  <li key={texto}>
                    <button
                      type="button"
                      disabled={done || pendingQuestion === texto}
                      onClick={() => preguntar(texto)}
                      className={`w-full flex items-start gap-1.5 text-left text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                        done
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-border-default text-text-primary hover:border-brand hover:bg-brand-muted/20'
                      }`}
                    >
                      <CheckCircle
                        className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${done ? 'text-emerald-600' : 'text-text-tertiary/40'}`}
                        weight={done ? 'fill' : 'regular'}
                      />
                      <span className="flex-1">{texto}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Examen y estudios — más abajo y colapsables */}
          <div className="rounded-lg border border-border-default bg-bg-surface overflow-hidden">
            <button type="button" onClick={() => setShowExamen(v => !v)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-text-tertiary uppercase tracking-wide">
              Examen sugerido
              {showExamen ? <CaretUp className="h-3.5 w-3.5" /> : <CaretDown className="h-3.5 w-3.5" />}
            </button>
            {showExamen && (
              <ul className="px-3 pb-2.5 space-y-1 text-xs text-text-secondary list-disc list-outside ml-3">
                {guia.ex.map(t => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border-default bg-bg-surface overflow-hidden">
            <button type="button" onClick={() => setShowEstudios(v => !v)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-bold text-text-tertiary uppercase tracking-wide">
              Estudios sugeridos
              {showEstudios ? <CaretUp className="h-3.5 w-3.5" /> : <CaretDown className="h-3.5 w-3.5" />}
            </button>
            {showEstudios && (
              <ul className="px-3 pb-2.5 space-y-1 text-xs text-text-secondary list-disc list-outside ml-3">
                {guia.st.map(t => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>

          {/* Diferenciales, con lo urgente marcado */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Diagnósticos diferenciales</p>
            <div className="flex flex-wrap gap-1">
              {guia.dx.map(([nombre, code, urgente]) => (
                <span key={code} className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  urgente
                    ? 'bg-red-50 text-red-700 border-red-300 font-semibold'
                    : 'bg-white text-text-secondary border-border-default'
                }`}>
                  {nombre} · {code}{urgente ? ' · urgente' : ''}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
