/**
 * Descuento de socio comercial (LIFT, migración 252) — cierre de la reserva
 * cuando Mercado Pago resuelve un pago que había quedado pendiente.
 *
 * mp-payment deja el descuento `reservado` si MP contesta "pendiente"; el
 * webhook lo cierra acá: aprobado/autorizado → aplicado; rechazado/cancelado →
 * liberado (el paciente lo puede volver a usar). Sólo desde `reservado`: un
 * descuento ya aplicado o ya liberado no se toca.
 *
 * Lo usa mp-webhook y lo prueba scripts/verificar-beneficio-socio.mjs contra
 * staging (el webhook en sí necesita la firma de MP, que no tenemos local).
 */

// deno-lint-ignore no-explicit-any
type Db = any

export function estadoDescuentoPorPago(paymentsStatus: string): 'aplicado' | 'liberado' | null {
  if (paymentsStatus === 'approved' || paymentsStatus === 'authorized') return 'aplicado'
  if (paymentsStatus === 'rejected' || paymentsStatus === 'cancelled') return 'liberado'
  return null
}

export async function cerrarDescuentoPorConsulta(
  db: Db,
  consultationId: string,
  paymentsStatus: string,
  paymentId: string | null = null,
): Promise<{ estado: 'aplicado' | 'liberado' | null; error: string | null }> {
  const estado = estadoDescuentoPorPago(paymentsStatus)
  if (!estado) return { estado: null, error: null }
  const { error } = await db
    .from('socio_descuentos')
    .update({
      estado,
      updated_at: new Date().toISOString(),
      ...(paymentId ? { payment_id: paymentId } : {}),
    })
    .eq('consultation_id', consultationId)
    .eq('estado', 'reservado')
  return { estado, error: error?.message ?? null }
}
