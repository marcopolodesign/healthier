/**
 * Descuento de socio comercial (LIFT, migración 252) — cierre de la reserva
 * cuando Mercado Pago resuelve un pago que había quedado pendiente.
 *
 * mp-payment deja el descuento `reservado` si MP contesta "pendiente"; el
 * webhook lo cierra acá: aprobado/autorizado → aplicado; rechazado/cancelado →
 * liberado (el paciente lo puede volver a usar) SÓLO si el aviso es de un
 * intento pendiente y no queda otro. Sólo desde `reservado`. La devolución de
 * un pago ya cobrado la resuelve un trigger en `payments` (migración 252).
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
  mpPaymentId: string | null,
  paymentId: string | null = null,
): Promise<{ estado: string | null; error: string | null }> {
  const destino = estadoDescuentoPorPago(paymentsStatus)
  const estado = destino ?? (paymentsStatus === 'pending' ? 'pendiente' : null)
  if (!estado) return { estado: null, error: null }
  // Por INTENTO: un rechazo libera sólo si es del intento pendiente y no queda
  // otro (la regla vive en `cerrar_descuento_de_socio`, migración 252).
  const { data, error } = await db.rpc('cerrar_descuento_de_consulta', {
    p_consulta: consultationId, p_estado: estado, p_mp_payment_id: mpPaymentId, p_payment: paymentId,
  })
  return { estado: (data as string | null) ?? null, error: error?.message ?? null }
}
