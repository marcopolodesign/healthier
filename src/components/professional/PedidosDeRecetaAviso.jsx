import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Prescription, CaretRight } from '@phosphor-icons/react'
import { pedidosDeRecetaService } from '../../services/pedidosDeRecetaService'
import { useMedicoHealthier } from '../../hooks/useMedicoHealthier'
import { usePolling } from '../../hooks/usePolling'

/**
 * En el inicio del médico de Healthier: cuántos pedidos de receta esperan
 * (nuevos + los que tomó). No se muestra si no hay ninguno. Misma fila que el
 * Inicio de la app ("Push y que se vea en el inicio", Mateo 2026-11-26).
 */
export default function PedidosDeRecetaAviso({ profile }) {
  const medico = useMedicoHealthier(profile)
  const [cuantos, setCuantos] = useState(0)

  const cargar = useCallback(() => {
    if (!medico) return
    pedidosDeRecetaService.listar().then(l => setCuantos(l.length)).catch(() => {})
  }, [medico])
  usePolling(cargar, 30_000)

  if (!medico || !cuantos) return null
  return (
    <Link to="/profesional/pedidos-receta" className="flex items-center gap-3 rounded-2xl bg-receta-nivel px-4 py-3.5">
      <Prescription className="w-5 h-5 text-brand-tertiary-hover shrink-0" />
      <span className="flex-1 text-[15px] text-text-primary">Pedidos de receta</span>
      <span className="min-w-7 h-7 px-2 rounded-full bg-brand-tertiary text-white text-[13px] flex items-center justify-center tabular-nums">{cuantos}</span>
      <CaretRight className="w-4 h-4 text-text-tertiary" />
    </Link>
  )
}
