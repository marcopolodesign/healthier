import { useState, useEffect, useMemo } from 'react'
import { MagnifyingGlass, User, CircleNotch, Check } from '@phosphor-icons/react'
import Modal from '../Modal'
import { toast } from '../Toast'
import { derivacionesService } from '../../services/derivacionesService'
import { professionalService } from '../../services/professionalService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { useVerticales } from '../../hooks/useVerticales'

const MOTIVO_MIN = 3

/**
 * Formulario de derivación (docs/derivaciones.md). Lo comparten el modal de la
 * ficha / detalle de la consulta y la pestaña "Derivar" del panel clínico (que es
 * lo que ve la app dentro del WebView).
 *
 * Se deriva a un profesional concreto (buscado por nombre entre los verificados y
 * reservables) o a una vertical con especialidad opcional. Quien recibe no
 * acepta nada: el paciente reserva directo. El motivo es obligatorio.
 */
export function DerivarForm({ patientId, consultaOrigenId = null, excluirProId = null, onDone, onCancel }) {
  const { activas, porSlug } = useEspecialidades()
  const { verticales } = useVerticales()

  const [modo, setModo] = useState('profesional') // 'profesional' | 'vertical'
  const [texto, setTexto] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState([])
  const [elegido, setElegido] = useState(null)
  const [vertical, setVertical] = useState('')
  const [especialidad, setEspecialidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Búsqueda con debounce: no pega a la base en cada tecla.
  useEffect(() => {
    if (modo !== 'profesional' || elegido) return
    let vigente = true
    setBuscando(true)
    const t = setTimeout(() => {
      professionalService.buscarCobrables({ texto })
        .then(rows => { if (vigente) setResultados(rows.filter(r => r.userId !== excluirProId).slice(0, 20)) })
        .catch(err => { if (vigente) setError(err?.message ?? 'No pudimos buscar profesionales') })
        .finally(() => { if (vigente) setBuscando(false) })
    }, 300)
    return () => { vigente = false; clearTimeout(t) }
  }, [texto, modo, elegido, excluirProId])

  const habilitadas = useMemo(() => verticales.filter(v => v.enabled), [verticales])
  const especialidadesDeLaVertical = useMemo(
    () => activas.filter(e => e.verticalId === vertical),
    [activas, vertical],
  )

  const motivoOk = motivo.trim().length >= MOTIVO_MIN
  const destinoOk = modo === 'profesional' ? !!elegido : !!vertical
  const puedeEnviar = motivoOk && destinoOk && !enviando

  const enviar = async () => {
    if (!puedeEnviar) return
    setEnviando(true)
    setError('')
    try {
      await derivacionesService.crear({
        patientId,
        motivo: motivo.trim(),
        profesionalDestinoId: modo === 'profesional' ? elegido.userId : null,
        verticalDestino: modo === 'vertical' ? vertical : null,
        especialidadDestino: modo === 'vertical' && especialidad ? especialidad : null,
        consultaOrigenId,
      })
      toast.success('Derivación enviada. Le avisamos al paciente.')
      onDone?.()
    } catch (err) {
      // El mensaje de la base viene en castellano y dice qué pasó: se muestra tal cual.
      const msg = err?.message ?? 'No pudimos enviar la derivación'
      setError(msg)
      toast.error(msg)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-full bg-bg-primary p-1 text-sm">
        {[
          ['profesional', 'A un profesional'],
          ['vertical', 'A una especialidad'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setModo(id); setError('') }}
            className={`flex-1 rounded-full py-2 font-medium transition-colors ${
              modo === id ? 'bg-white text-brand shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {modo === 'profesional' ? (
        elegido ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-muted/40 p-3">
            <Avatar url={elegido.profiles?.avatarUrl} nombre={elegido.profiles?.fullName} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{elegido.profiles?.fullName}</p>
              <p className="text-xs text-text-secondary truncate">{porSlug[elegido.specialty] ?? elegido.specialty}</p>
            </div>
            <button type="button" onClick={() => setElegido(null)} className="text-xs font-semibold text-brand hover:underline">
              Cambiar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="form-label">Buscá por nombre</label>
            <div className="relative">
              <MagnifyingGlass className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={texto}
                onChange={e => setTexto(e.target.value)}
                placeholder="Nombre y apellido"
                className="form-input pl-9"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border-default divide-y divide-border-default">
              {buscando && (
                <div className="flex items-center justify-center py-4">
                  <CircleNotch className="h-4 w-4 animate-spin text-brand" />
                </div>
              )}
              {!buscando && resultados.length === 0 && (
                <p className="px-3 py-4 text-sm text-text-secondary text-center">
                  No encontramos profesionales con ese nombre.
                </p>
              )}
              {!buscando && resultados.map(r => (
                <button
                  key={r.userId}
                  type="button"
                  onClick={() => setElegido(r)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-primary transition-colors"
                >
                  <Avatar url={r.profiles?.avatarUrl} nombre={r.profiles?.fullName} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{r.profiles?.fullName}</p>
                    <p className="text-xs text-text-secondary truncate">{porSlug[r.specialty] ?? r.specialty}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div>
            <label className="form-label">Vertical</label>
            <select
              value={vertical}
              onChange={e => { setVertical(e.target.value); setEspecialidad('') }}
              className="form-select"
            >
              <option value="">Elegí una</option>
              {habilitadas.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          {vertical && especialidadesDeLaVertical.length > 0 && (
            <div>
              <label className="form-label">
                Especialidad <span className="normal-case font-normal text-text-tertiary">(opcional)</span>
              </label>
              <select value={especialidad} onChange={e => setEspecialidad(e.target.value)} className="form-select">
                <option value="">Cualquiera</option>
                {especialidadesDeLaVertical.map(e => <option key={e.slug} value={e.slug}>{e.label}</option>)}
              </select>
            </div>
          )}
          <p className="text-xs text-text-tertiary">
            El paciente va a elegir con quién reservar entre los profesionales de esa área.
          </p>
        </div>
      )}

      <div>
        <label className="form-label">Motivo de la derivación</label>
        <textarea
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          rows={4}
          placeholder="Ej: Soplo sistólico en el control. Solicito evaluación cardiológica."
          className="form-textarea"
        />
        <p className="mt-1 text-xs text-text-tertiary">
          Lo ve quien reciba al paciente. La historia clínica sólo se comparte si el paciente lo autoriza.
        </p>
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="flex gap-3 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary flex-1 py-2.5">Cancelar</button>
        )}
        <button
          type="button"
          onClick={enviar}
          disabled={!puedeEnviar}
          className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2"
        >
          {enviando ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {enviando ? 'Enviando…' : 'Enviar derivación'}
        </button>
      </div>
    </div>
  )
}

function Avatar({ url, nombre }) {
  return (
    <div className="w-9 h-9 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
      {url
        ? <img src={url} alt={nombre ?? ''} className="w-full h-full object-cover" />
        : <User className="h-4 w-4 text-brand" />}
    </div>
  )
}

/** Botón "Derivar" + modal: los dos puntos de entrada de la ficha y de la consulta. */
export default function DerivarModal({ open, onClose, onDone, ...formProps }) {
  return (
    <Modal open={open} onClose={onClose} title="Derivar paciente" size="md">
      <DerivarForm
        {...formProps}
        onCancel={onClose}
        onDone={() => { onClose?.(); onDone?.() }}
      />
    </Modal>
  )
}
