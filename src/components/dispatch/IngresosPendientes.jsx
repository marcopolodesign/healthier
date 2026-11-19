import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Check, X } from '@phosphor-icons/react'
import { dispatchService } from '../../services/dispatchService'
import { supabase } from '../../lib/supabase'
import { toast } from '../Toast'

/**
 * Pedidos de ingreso en modo operador (migración 243): alguien con una cuenta
 * operadorN puso el DNI de un profesional de la entidad y espera que el despacho
 * lo apruebe. Sólo se renderiza si hay pedidos; Realtime + sondeo cada 10 s.
 */
export default function IngresosPendientes() {
  const [pedidos, setPedidos] = useState([])
  const [trabajando, setTrabajando] = useState(null)

  const cargar = useCallback(() => {
    dispatchService.ingresosPendientes().then(setPedidos).catch(() => {})
  }, [])

  useEffect(() => {
    cargar()
    const iv = setInterval(cargar, 10000)
    const canal = supabase
      .channel('ingresos-operador-despacho')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operador_ingresos' }, cargar)
      .subscribe()
    return () => { clearInterval(iv); supabase.removeChannel(canal) }
  }, [cargar])

  const resolver = async (p, aprobar) => {
    let motivo = null
    if (!aprobar) {
      motivo = window.prompt('¿Por qué lo rechazás? (lo ve quien lo pidió)') ?? null
      if (motivo === null) return
    }
    setTrabajando(p.id)
    try {
      await dispatchService.resolverIngreso(p.id, aprobar, motivo)
      toast.success(aprobar ? 'Ingreso aprobado' : 'Ingreso rechazado')
      cargar()
    } catch (err) {
      toast.error(err?.message || 'No pudimos resolver el pedido')
      cargar()
    } finally {
      setTrabajando(null)
    }
  }

  if (pedidos.length === 0) return null

  return (
    <div className="card space-y-3 border border-amber-200 bg-amber-50" data-testid="ingresos-pendientes">
      <h2 className="font-semibold text-text-primary flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-amber-700" /> Ingresos en modo operador por aprobar ({pedidos.length})
      </h2>
      {pedidos.map(p => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-text-primary min-w-0">
            <span className="font-medium">{p.operador?.email}</span> quiere entrar como{' '}
            <span className="font-medium">{p.profesional?.fullName}</span>
            <span className="text-xs text-text-secondary"> · DNI {p.dniIngresado}</span>
          </p>
          <div className="flex gap-2 shrink-0">
            <button type="button" disabled={trabajando === p.id} onClick={() => resolver(p, true)} className="flex items-center gap-1 text-xs font-semibold text-white bg-brand px-3 py-2 rounded-full disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> Aprobar
            </button>
            <button type="button" disabled={trabajando === p.id} onClick={() => resolver(p, false)} className="flex items-center gap-1 text-xs font-semibold text-red-600 px-3 py-2 rounded-full border border-red-200 disabled:opacity-60">
              <X className="h-3.5 w-3.5" /> Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
