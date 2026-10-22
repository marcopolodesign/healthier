import { useCallback, useEffect, useState } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'
import { emergencyService } from '../../services/emergencyService'
import { ordenTrasladoService, ultimosPorTipo } from '../../services/ordenTrasladoService'
import { COBRO, cobroDe, duracionMin, formatDuracion } from '../../lib/cobroEmergencia'
import OrdenDeTrasladoCard from '../emergencias/OrdenDeTrasladoCard'

const TRIAGE = {
  ROJO: 'bg-red-600 text-white',
  AMARILLO: 'bg-amber-400 text-gray-900',
  VERDE: 'bg-emerald-500 text-gray-900',
}

const hora = iso => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : null)

/**
 * Un traslado del historial (Nacho, 2026-10-22; diseño revisado por Felipe):
 * mismo panel lateral que el de "en curso", sin acciones. En este orden:
 * resumen, cómo terminó (con la orden de traslado), línea de tiempo y cobro.
 */
export default function PanelHistorial({ emergencyId, onClose }) {
  const [t, setT] = useState(undefined)
  const [documentos, setDocumentos] = useState(undefined)
  const orden = documentos ? ultimosPorTipo(documentos).orden_traslado ?? null : null
  const [error, setError] = useState('')

  const leer = useCallback(async () => {
    setError('')
    try {
      const [fila, ordenes] = await Promise.all([
        emergencyService.trasladoTerminado(emergencyId),
        // Si falla, la tarjeta la vuelve a pedir y muestra su propio error.
        ordenTrasladoService.listar(emergencyId).catch(() => undefined),
      ])
      setT(fila)
      setDocumentos(ordenes)
    } catch (e) {
      setError(e?.message || 'No pudimos cargar el traslado')
    }
  }, [emergencyId])

  useEffect(() => { leer() }, [leer])

  useEffect(() => {
    const alTeclado = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [onClose])

  const cancelada = t?.status === 'cancelled'
  const cobro = t ? cobroDe(t) : null

  let comoTermino = null
  if (t && !cancelada) {
    if (t.desenlace === 'traslado') comoTermino = `Trasladado${orden?.institucion ? ` a ${orden.institucion}` : ''}`
    else if (t.desenlace === 'en_el_lugar') comoTermino = 'Atendido en el lugar'
    if (t.cierreSinAtencion) comoTermino = [comoTermino, `Cerrada sin atención · ${t.cierreSinAtencion}`].filter(Boolean).join('. ')
  }

  const linea = t ? [
    [t.createdAt, 'Pedido'],
    [t.paidAt, 'Pago'],
    [t.dispatchedAt, 'Asignado'],
    [t.completedAt, 'Cerrado'],
    [t.cancelledAt, 'Cancelado'],
  ].filter(([cuando]) => cuando) : []

  return (
    <div className="fixed inset-0 z-50 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[480px] bg-bg-primary lg:border-l lg:border-border-default lg:shadow-[-12px_0_30px_rgba(0,0,0,0.08)] flex flex-col" role="dialog" aria-label="Traslado del historial" data-testid="panel-historial">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
        <h2 className="font-semibold text-text-primary">{cancelada ? 'Traslado cancelado' : 'Traslado terminado'}</h2>
        <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-bg-surface" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {t === undefined && !error && <div className="h-[160px] rounded-2xl bg-bg-surface animate-pulse" />}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/5 text-sm text-danger">
            <WarningCircle className="h-5 w-5 shrink-0" /> {error}
            <button onClick={leer} className="ml-auto font-semibold underline">Reintentar</button>
          </div>
        )}
        {t === null && <p className="text-sm text-text-secondary">No existe o no tenés acceso.</p>}

        {t && (
          <>
            {/* 1 · Resumen */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${TRIAGE[t.triageCode] ?? 'bg-gray-100 text-gray-500'}`}>{t.triageCode || '—'}</span>
                <span className="text-sm text-text-secondary">{t.dispatchCode || 'Sin código'}</span>
              </div>
              <p className="text-xl font-semibold text-text-primary">{t.pacienteNombre || t.patient?.fullName || 'Paciente'}</p>
              <p className="text-sm text-text-secondary">
                {[t.ambulancia?.label, t.medico?.fullName].filter(Boolean).join(' · ') || 'Sin móvil asignado'}
                {' · '}<span className="tabular-nums">{formatDuracion(duracionMin(t))}</span>
              </p>
            </div>

            {/* 2 · Cómo terminó */}
            {!cancelada && (
              <div className="space-y-2">
                <p className="font-semibold text-text-primary">Cómo terminó</p>
                <p className="text-sm text-text-primary">{comoTermino || 'No quedó registrado.'}</p>
                <OrdenDeTrasladoCard emergencyId={t.id} documentos={documentos} />
              </div>
            )}

            {/* 3 · Línea de tiempo: hora en columna tabular, sin riel */}
            <div className="card space-y-1.5">
              {linea.map(([cuando, que]) => (
                <div key={que} className="flex gap-4 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-text-secondary">{hora(cuando)}</span>
                  <span className="text-text-primary">{que}</span>
                </div>
              ))}
            </div>

            {/* 4 · Cobro */}
            <div className="space-y-1.5">
              <p className="font-semibold text-text-primary">Cobro</p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-surface text-text-secondary">{COBRO[cobro].label}</span>
                <span className="text-sm text-text-secondary">{COBRO[cobro].ayuda}</span>
              </div>
              {t.cierreSinPago && (
                <p className="text-sm text-text-primary">
                  “{t.cierreSinPago}”{t.cerroSinPago?.fullName ? <span className="text-text-secondary"> — {t.cerroSinPago.fullName}</span> : null}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
