-- ============================================================
-- 119 — Factura del profesional por la consulta
-- ============================================================
-- El profesional sube su factura (PDF) al cerrar la consulta, y puede
-- reemplazarla después — a diferencia del resto del detalle de la consulta,
-- que queda congelado al cerrar (ver `bloqueada` en ConsultationDetail.jsx).
-- Es a propósito: una factura se emite tarde, se emite mal y se reemplaza, y
-- eso es normal en la operación real. No es un dato clínico.
--
-- Campo abierto por ahora (Mateo, 2026-08-21): sólo el archivo, sin número de
-- factura, CAE, importe ni validación contra el pago. Cuando haga falta
-- facturación de verdad esto se reemplaza por su propia tabla.
--
-- Por qué NO se reusa `prescription_url` (003), que hoy está sin uso: sus filas
-- históricas todavía tienen recetas reales y los RPC de cierre siguen
-- nombrándola. Una columna llamada "prescription_url" con facturas adentro es
-- una trampa para el que la lea dentro de seis meses.
--
-- No hace falta tocar RLS: `consultations_access` es FOR ALL y ya deja al
-- profesional (professional_id = auth.uid()) escribir su propia consulta, sin
-- condición sobre el estado. Y el trigger de transición de estados
-- (`consultations_validar_transicion`, migración 089) es `before update OF
-- status`, así que un update que sólo toca estas dos columnas no lo dispara.
-- ============================================================

ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS invoice_url         text,
  ADD COLUMN IF NOT EXISTS invoice_uploaded_at timestamptz;

COMMENT ON COLUMN public.consultations.invoice_url IS
  'Path (no URL) de la factura del profesional dentro del bucket privado professional-docs. Se lee con getSignedDocUrl/SignedDocLink. Reemplazable incluso con la consulta ya cerrada.';

COMMENT ON COLUMN public.consultations.invoice_uploaded_at IS
  'Cuándo se subió la factura vigente. Se pisa en cada reemplazo — no es un historial.';
