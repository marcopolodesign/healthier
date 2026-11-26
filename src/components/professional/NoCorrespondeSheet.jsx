import { useEffect, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import PatientSheet from '../patient/PatientSheet'
import { toast } from '../Toast'

/**
 * "No corresponde recetar" — el médico de Healthier deja el motivo y el pedido
 * se cancela; la reserva de la tarjeta se libera sola (trigger de la 254). El
 * motivo lo lee el paciente en su pedido, así que se escribe para él.
 */
export default function NoCorrespondeSheet({ pedido, onCerrar, onConfirmar }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => { if (pedido) setMotivo('') }, [pedido])

  const confirmar = async () => {
    if (!motivo.trim() || enviando) return
    setEnviando(true)
    try {
      await onConfirmar(motivo.trim())
    } catch (err) {
      toast.error(err?.message || 'No pudimos cancelar el pedido')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <PatientSheet open={!!pedido} onClose={onCerrar} maxWidth="max-w-md">
      <div className="px-6 pt-4 pb-8 sm:pt-8 flex flex-col gap-4">
        <div>
          <h2 className="font-serif font-light text-[26px] leading-tight text-text-primary">No corresponde recetar</h2>
          <p className="text-[15px] leading-[22px] text-text-secondary mt-2">
            Se cancela el pedido de {pedido?.pacienteNombre ?? 'el paciente'} y no se le cobra nada. Contale por qué: lo va a leer en su pedido.
          </p>
        </div>
        <textarea
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ej.: Necesitás una consulta presencial antes de empezar este tratamiento."
          className="form-textarea"
          autoFocus
        />
        <button
          onClick={confirmar}
          disabled={!motivo.trim() || enviando}
          className="w-full py-4 rounded-full bg-text-primary text-white text-[15px] font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {enviando && <CircleNotch className="w-4 h-4 animate-spin" />} Cancelar el pedido sin cobrar
        </button>
        <button onClick={onCerrar} className="text-[14px] text-text-secondary">Volver</button>
      </div>
    </PatientSheet>
  )
}
