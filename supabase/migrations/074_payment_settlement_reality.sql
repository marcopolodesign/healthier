-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que Mercado Pago realmente deposita, y cuándo.
--
-- `payments` guardaba `mp_fee_estimated` (una estimación nuestra) y
-- `net_to_professional` (el 78% contractual del bruto). Ninguno de los dos es el
-- número que el profesional ve en su cuenta de MP:
--
--   Pago 170000525607, verificado contra la API de MP el 2026-07-29:
--     bruto 1000 · mercadopago_fee 41 · application_fee 140,10
--     net_received_amount 818,90 · money_release_date 2026-08-15
--   Nuestra base decía: mp_fee_estimated 79,90 · net_to_professional 780.
--
-- La diferencia de $38,90 no la pierde nadie: MP cobra las dos comisiones al
-- `collector` (el profesional), así que si su comisión real es menor que la que
-- estimamos, el excedente queda para el profesional automáticamente. O sea que
-- estábamos **subinformando** lo que gana.
--
-- Estas dos columnas guardan lo que MP informa, sin interpretarlo, para poder
-- mostrar el mismo número que el profesional ve en su app de MP.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.payments
  -- `transaction_details.net_received_amount` — lo que efectivamente se acredita.
  add column if not exists mp_net_received_amount numeric,
  -- `money_release_date` — cuándo se libera el dinero ("Total a recibir el 15/ago").
  add column if not exists mp_money_release_date  timestamptz;

comment on column public.payments.mp_net_received_amount is
  'net_received_amount informado por MP. Es lo que el profesional realmente recibe; net_to_professional es el 78% contractual estimado.';
comment on column public.payments.mp_money_release_date is
  'money_release_date informado por MP: fecha de liberación del dinero.';
