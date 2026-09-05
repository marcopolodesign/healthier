-- Dos de los triggers de la migración 146 se disparaban en cada UPDATE de su
-- tabla, aunque su cuerpo mira una o dos columnas nada más.
--
--   · `medication_orders` — cambiar la dirección de entrega de un pedido
--     invocaba la función del mail.
--   · `professional_profiles` — cada vez que un profesional guarda su bio, su
--     precio o sus horarios (o sea, todo el tiempo) también.
--
-- No mandaban mails de más (los guards estaban bien), pero es trabajo por fila
-- que Postgres hace para nada, y en `professional_profiles` la tabla se escribe
-- seguido. Postgres evalúa `AFTER UPDATE OF <columna>` antes de llamar a la
-- función, así que acotarlo lo saca del camino.
--
-- Los otros triggers de la 146 ya nacieron acotados (`of status`,
-- `of rcta_status`) o son de INSERT.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Nota para el que agregue el próximo mail
-- ─────────────────────────────────────────────────────────────────────────────
-- La 146 usa una columna `mail_*_enviado_at` por tipo de mail como marca de "ya
-- se pidió". Se escribe justo después de `enviar_mail()`, que es asíncrono
-- (pg_net), o sea que marca la INTENCIÓN de mandar, no el resultado.
--
-- Desde la 147 el resultado real vive en `email_log` (`enviado` / `error`, con
-- el motivo). O sea que hay dos registros de la misma pregunta, y el que frena
-- el reenvío es el optimista: si Resend rechaza un mail, el super admin lo ve
-- en rojo pero la marca ya quedó puesta y ese mail no se reintenta nunca.
--
-- 🔴 **El mail que se agregue de acá en adelante NO lleva columna nueva.** Se
-- frena contra `email_log`, que es el que dice la verdad:
--
--   if exists (select 1 from public.email_log
--               where tipo = 'lo-que-sea' and consultation_id = new.id
--                 and estado = 'enviado') then return new; end if;
--
-- Con eso, arreglar la causa de un fallo alcanza para que el mail vuelva a
-- salir. Las cinco columnas que ya existen se dejan como están: funcionan, y
-- migrarlas antes de salir al aire no compra nada.

drop trigger if exists medication_orders_mail on public.medication_orders;
create trigger medication_orders_mail
  after update of payment_status, status on public.medication_orders
  for each row execute function public.avisar_pedido_de_farmacia_por_mail();

drop trigger if exists professional_profiles_mail_verificacion on public.professional_profiles;
create trigger professional_profiles_mail_verificacion
  after update of is_verified, rejected_at on public.professional_profiles
  for each row execute function public.avisar_verificacion_por_mail();
