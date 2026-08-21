import { useRef, useState } from 'react'
import Modal from './Modal'
import { consultationsService } from '../services/consultationsService'
import { clinicalService } from '../services/clinicalService'
import FacturaConsulta from './professional/FacturaConsulta'
import { toast } from './Toast'

export default function CloseConsultationModal({
  open, onClose, consultationId, patientName, modality, profile, onFinalized,
  patientId, ensureEncounter, licenseType, licenseNumber,
  // Ya verificado EN la videollamada (migración 099, tab "Cerrar"). Si viene
  // seteado, este modal no vuelve a pedir el código.
  closingCodeVerifiedAt,
  // Factura ya subida antes (desde el detalle de la consulta), para que el
  // modal muestre "Reemplazar" en vez de ofrecer subir una como si no hubiera
  // ninguna — y el profesional no la pise sin darse cuenta.
  invoiceUrl, invoiceUploadedAt,
}) {
  const [form, setForm] = useState({ notes: '', code: '', sinCodigo: false, motivoSinCodigo: '' })
  const [closing, setClosing] = useState(false)
  // La factura se sube DESPUÉS de que el cierre haya salido bien: si se subiera
  // al elegir el archivo, un cierre que falla (código incorrecto, red) dejaría
  // una factura colgada de una consulta que sigue abierta.
  //
  // En un ref y no en estado: `subirFactura` se llama desde un handler que
  // quedó capturado en el render del click, así que leer un `useState` de acá
  // devolvía el valor viejo — tocar "Quitar" con el cierre ya en vuelo subía
  // igual el archivo que se acababa de sacar.
  const facturaRef = useRef(null)

  const subirFactura = async () => {
    const factura = facturaRef.current
    if (!factura || !profile?.id) return
    try {
      await consultationsService.uploadInvoice(consultationId, profile.id, factura)
    } catch (err) {
      // No revierte el cierre — se avisa y se puede reintentar desde el detalle
      // de la consulta, que deja reemplazarla incluso ya cerrada.
      console.error('No se pudo subir la factura:', err)
      toast.warning(`La consulta se cerró, pero la factura no se subió: ${err?.message ?? 'error desconocido'}. Podés subirla desde el detalle.`)
    }
  }

  const esVideo = modality !== 'presencial'
  const yaVerificado = Boolean(closingCodeVerifiedAt)

  const asentarNotaEnHC = async () => {
    // La nota de cierre es un acto médico: además de quedar en la consulta
    // (columna editable, útil para la operación del marketplace) se asienta en
    // la historia clínica como entrada append-only y firmada con la matrícula.
    // Ley 26.529 Art. 15 — la HC tiene que registrar el acto y quién lo hizo,
    // y Art. 12/16 exigen que sea inalterable. `consultations.closing_notes`
    // no cumple ninguna de las dos: se puede pisar con un UPDATE.
    // Si esto falla NO se revierte el cierre — se avisa y la consulta queda
    // cerrada igual, que es lo que el profesional acaba de pedir.
    if (!form.notes.trim() || !ensureEncounter || !patientId) return
    try {
      const encounterId = await ensureEncounter()
      await clinicalService.addEntry(encounterId, {
        patientId,
        professionalId: profile.id,
        entryType: 'note',
        content: form.notes.trim(),
        data: { source: 'cierre_de_consulta', consultationId },
        licenseType,
        licenseNumber,
      })
    } catch (err) {
      console.error('No se pudo asentar la nota de cierre en la HC:', err)
      toast.warning('La consulta se cerró, pero la nota no se pudo asentar en la historia clínica.')
    }
  }

  const handleSubmitPresencial = async () => {
    // La receta ya NO se sube a mano acá (decisión de Mateo, 2026-07-29): una
    // imagen o un PDF que subimos nosotros no es una receta. La receta es el PDF
    // firmado que emite RCTA desde "Recetas digitales", y hasta que RCTA esté
    // habilitado no se entrega ninguna. Se deja de escribir
    // `consultations.prescription_url`; la columna queda para no perder lo viejo.
    const result = await consultationsService.finalize(consultationId, 'professional', {
      closingNotes: form.notes || null,
      code: null,
    })
    await asentarNotaEnHC()
    await subirFactura()
    if (result.status === 'completed') {
      toast.success('Consulta finalizada correctamente')
      onFinalized?.()
    } else {
      toast.info('Registro guardado. Esperando que el paciente finalice del lado de la app.')
      onClose()
    }
  }

  const handleSubmitVideo = async () => {
    // El código de cierre gatea `closing → completed` (migración 099). Tres
    // caminos hasta acá: ya se verificó EN la llamada (tab "Cerrar"), se
    // verifica recién ahora con lo que tipeó el profesional, o se cierra sin
    // código dejando un motivo — el caso normal es que el paciente ya se fue.
    if (!yaVerificado) {
      if (form.code.trim().length === 4) {
        const resultado = await consultationsService.verifyClosingCode(consultationId, form.code.trim())
        if (!resultado.ok) {
          toast.error(
            resultado.motivo === 'intentos_agotados'
              ? 'Se agotaron los intentos. Cerrá dejando un motivo, más abajo.'
              : `Código incorrecto. Quedan ${resultado.intentosRestantes} intento(s).`
          )
          return
        }
      } else if (!form.motivoSinCodigo.trim()) {
        toast.error('Ingresá el código de 4 dígitos o un motivo para cerrar sin él.')
        return
      }
    }

    const result = await consultationsService.completeClosing(consultationId, {
      closingNotes: form.notes || null,
      skipCodeReason: yaVerificado || form.code.trim().length === 4 ? null : form.motivoSinCodigo.trim(),
    })
    await asentarNotaEnHC()
    await subirFactura()
    toast.success('Consulta finalizada correctamente')
    onFinalized?.()
  }

  const handleSubmit = async () => {
    setClosing(true)
    try {
      if (esVideo) await handleSubmitVideo()
      else await handleSubmitPresencial()
    } catch (err) {
      const msg = err?.message ?? ''
      if (msg.includes('Código inválido') || msg.includes('código')) {
        toast.error(msg)
      } else {
        toast.error('Error al finalizar la consulta')
      }
    } finally {
      setClosing(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Finalizar consulta">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Completá los datos para cerrar la consulta con {patientName || 'el/la paciente'}.
          {modality === 'presencial' && ' La duración se registrará automáticamente.'}
        </p>

        <div>
          <label className="form-label">Notas de la consulta</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            rows={3}
            placeholder="Resumen, indicaciones, diagnóstico…"
            className="form-textarea"
          />
        </div>

        <div>
          <label className="form-label">
            Factura <span className="text-text-tertiary font-normal">(opcional)</span>
          </label>
          <FacturaConsulta
            modo="diferido"
            invoiceUrl={invoiceUrl}
            invoiceUploadedAt={invoiceUploadedAt}
            onArchivoElegido={f => { facturaRef.current = f }}
            disabled={closing}
          />
          <p className="text-xs text-text-muted mt-1">
            Podés subirla ahora o después, desde el detalle de la consulta.
          </p>
        </div>

        {esVideo && yaVerificado && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 font-medium">
            Código de cierre verificado en la videollamada. No hace falta pedirlo de nuevo.
          </div>
        )}

        {esVideo && !yaVerificado && !form.sinCodigo && (
          <div>
            <label className="form-label">Código de cierre</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value.replace(/\D/g, '') }))}
              placeholder="0000"
              className="form-input text-center tracking-[0.3em] text-lg font-mono"
            />
            <p className="text-xs text-text-muted mt-1">
              Pedíselo al paciente. Si ya no está en la llamada,{' '}
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, sinCodigo: true }))}
                className="text-brand underline font-medium"
              >
                cerrá dejando un motivo
              </button>.
            </p>
          </div>
        )}

        {esVideo && !yaVerificado && form.sinCodigo && (
          <div>
            <label className="form-label">Motivo para cerrar sin código</label>
            <textarea
              value={form.motivoSinCodigo}
              onChange={e => setForm(p => ({ ...p, motivoSinCodigo: e.target.value }))}
              rows={2}
              placeholder="Ej.: el paciente cortó la llamada y no llegué a pedirle el código."
              className="form-textarea"
            />
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, sinCodigo: false, motivoSinCodigo: '' }))}
              className="text-xs text-text-secondary underline mt-1"
            >
              Tengo el código, volver
            </button>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={handleSubmit} disabled={closing} className="btn-primary flex-1">
            {closing ? 'Finalizando…' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
