-- Migración 082: `payment_methods` — unicidad por tarjeta + cerrar el INSERT abierto
--
-- Contexto: hasta hoy NADIE escribía en esta tabla. `mp-save-card` guardaba la
-- tarjeta en Mercado Pago, devolvía 200 y no persistía nada, así que el Perfil y
-- el selector del checkout leían siempre una tabla vacía. Al agregar el INSERT
-- en la Edge Function hacen falta dos cosas que la tabla no tenía.

-- ── 1. Unicidad (user_id, mp_card_id) ────────────────────────────────────────
-- Habilita el `upsert ... onConflict` de `mp-save-card`: reintentar el guardado
-- de la misma tarjeta es inocuo en vez de dejar filas repetidas en el selector.
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_user_card_uniq
  ON public.payment_methods (user_id, mp_card_id);

-- ── 2. El INSERT dejaba entrar cualquier user_id ─────────────────────────────
-- La política de 027 era `FOR INSERT WITH CHECK (true)`. El comentario decía
-- "service_role can insert", pero una policy sin `TO` aplica a TODOS los roles:
-- cualquier usuario autenticado podía insertar una fila con el `user_id` de otro
-- y meterle una tarjeta en la cuenta. `service_role` saltea RLS, así que la
-- función no necesita que esto esté abierto.
DROP POLICY IF EXISTS "payment_methods_insert_service" ON public.payment_methods;

CREATE POLICY "payment_methods_insert_own"
  ON public.payment_methods FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
