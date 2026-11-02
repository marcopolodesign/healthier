import { useEffect, useState } from 'react'
import { ShieldCheck } from '@phosphor-icons/react'
import Modal from '../Modal'
import { toast } from '../Toast'
import { formatDate } from '../../lib/format'
import { mensajeDeError } from '../../lib/supabase'
import { autorizacionRecetasService } from '../../services/autorizacionRecetasService'

/**
 * Recetas "Pendiente de autorización de la obra social" (migración 223).
 *
 * En el panel de la farmacia (`puedeAutorizar`) cada una tiene "Autorizar",
 * con confirmación. En el super admin (`conHistorial`) es de lectura y suma las
 * autorizadas de los últimos 90 días con quién y cuándo.
 * Si no hay nada que mostrar, no ocupa lugar.
 */
export default function RecetasPorAutorizar({ puedeAutorizar = false, conHistorial = false }) {
  const [filas, setFilas] = useState([])
  const [aConfirmar, setAConfirmar] = useState(null)
  const [autorizando, setAutorizando] = useState(false)

  const cargar = () => autorizacionRecetasService.listar({ incluirAutorizadas: conHistorial })
    .then(setFilas)
    .catch(err => toast.error(mensajeDeError(err)))

  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmar() {
    setAutorizando(true)
    try {
      await autorizacionRecetasService.autorizar(aConfirmar.clinicalMedicationId)
      toast.success('Receta autorizada. El paciente ya la puede comprar.')
      setAConfirmar(null)
      await cargar()
    } catch (err) {
      toast.error(mensajeDeError(err))
    } finally {
      setAutorizando(false)
    }
  }

  if (!filas.length) return null
  const pendientes = filas.filter(f => f.autorizacion === 'pendiente')

  return (
    <div className="card p-0 overflow-hidden" data-testid="recetas-por-autorizar">
      <div className="px-5 py-4 border-b border-border-default">
        <h2 className="font-semibold text-text-primary">Pendientes de autorización de la obra social</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          {pendientes.length
            ? `${pendientes.length} ${pendientes.length === 1 ? 'receta emitida espera' : 'recetas emitidas esperan'} la autorización. El paciente no puede comprarlas hasta que se autoricen.`
            : 'No hay recetas esperando autorización.'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Medicamento</th>
              <th className="table-header">Paciente</th>
              <th className="table-header hidden md:table-cell">Profesional</th>
              <th className="table-header hidden sm:table-cell">Emitida</th>
              <th className="table-header">Estado</th>
              {puedeAutorizar && <th className="table-header">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.clinicalMedicationId} className="table-row">
                <td className="table-cell">
                  <p className="font-medium text-text-primary text-sm">{f.medicationName}</p>
                  <p className="text-xs text-text-secondary">
                    {f.presentacion || ''}{f.rctaPrescriptionId ? ` · N° ${f.recetasPendientes || f.rctaPrescriptionId}` : ''}
                    {f.pdfUrl && <> · <a href={f.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-brand font-semibold">ver PDF</a></>}
                  </p>
                </td>
                <td className="table-cell text-sm">
                  <p className="text-text-primary">{f.paciente || '—'}</p>
                  {f.pacienteDni && <p className="text-xs text-text-secondary">DNI {f.pacienteDni}</p>}
                </td>
                <td className="table-cell max-md:hidden text-sm text-text-secondary">{f.profesional || '—'}</td>
                <td className="table-cell max-sm:hidden text-sm text-text-secondary">{formatDate(f.emitidaAt)}</td>
                <td className="table-cell">
                  {f.autorizacion === 'pendiente' ? (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Pendiente de autorización de la obra social</span>
                  ) : (
                    <span className="text-xs text-text-secondary" data-testid="receta-autorizada-por">
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 mr-1">Autorizada</span>
                      {f.autorizadaPor || '—'} · {formatDate(f.autorizadaAt)}
                    </span>
                  )}
                </td>
                {puedeAutorizar && (
                  <td className="table-cell">
                    {f.autorizacion === 'pendiente' && (
                      <button className="btn-secondary text-xs px-2.5 py-1.5" onClick={() => setAConfirmar(f)}>
                        Autorizar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!aConfirmar} onClose={() => !autorizando && setAConfirmar(null)} title="Autorizar receta" size="sm">
        {aConfirmar && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Vas a autorizar la receta {aConfirmar.recetasPendientes || aConfirmar.rctaPrescriptionId ? <>N° <strong className="text-text-primary">{aConfirmar.recetasPendientes || aConfirmar.rctaPrescriptionId}</strong> </> : ''}de <strong className="text-text-primary">{aConfirmar.medicationName}</strong> de{' '}
              <strong className="text-text-primary">{aConfirmar.paciente || 'el paciente'}</strong>. Confirmá que la obra social la aprobó: desde ahora el paciente la puede comprar.
            </p>
            <p className="text-xs text-text-tertiary flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 shrink-0" /> Queda registrado quién la autorizó y cuándo.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" disabled={autorizando} onClick={() => setAConfirmar(null)}>Cancelar</button>
              <button type="button" className="btn-primary flex-1" disabled={autorizando} onClick={confirmar}>
                {autorizando ? 'Autorizando…' : 'Sí, autorizar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
