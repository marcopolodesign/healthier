-- ─────────────────────────────────────────────────────────────────────────────
-- Devolución directa del super admin, con motivo escrito.
--
-- Mateo (2026-07-31): "¿por qué no puedo devolver si está completed? Debería
-- haber un proceso de auditoría y que se pueda devolver igual."
--
-- Tenía razón. Hasta ahora el ÚNICO camino a una devolución real era una cadena
-- de cuatro pasos entre dos roles, y arrancaba con el paciente cancelando **con
-- 48 h hábiles de anticipación a un turno que todavía no pasó**. Eso deja sin
-- ninguna salida a los casos que en la práctica son los que más se devuelven:
-- el profesional no apareció, la llamada se cayó, el paciente reclama después.
-- Verificado antes de construir esto: de los 3 pagos aprobados que existen,
-- **ninguno** era elegible por el front.
--
-- La alternativa que NO se tomó: cambiarle el estado a la consulta para
-- destrabar el camino existente. Eso falsifica el registro — deja una consulta
-- atendida figurando como cancelada — y es la misma clase de error que ya nos
-- mordió el 2026-07-28, cuando el cliente pisaba un estado terminal.
--
-- Entonces: una devolución que no finge ser una cancelación. Exige motivo
-- escrito, sólo la puede hacer un super admin, y queda asentada.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.payments
  -- Por qué se devolvió. Obligatorio del lado de la función: una devolución sin
  -- motivo es indistinguible de un error operativo tres meses después.
  add column if not exists refund_reason text,
  -- Distingue la devolución discrecional del camino normal de cancelación.
  add column if not exists refund_forced_by uuid references public.profiles(id);

comment on column public.payments.refund_reason is
  'Motivo escrito de la devolución. Lo exige la función mp-refund en la acción force-refund.';
comment on column public.payments.refund_forced_by is
  'Super admin que ejecutó una devolución directa, fuera del flujo de cancelación del paciente. NULL en las devoluciones normales.';
