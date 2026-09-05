-- El registro de los mails que salieron (y de los que no).
--
-- Por qué existe: hasta acá, si un mail no llegaba, no quedaba rastro de nada.
-- El `console.error` de la Edge Function vive en los logs de Supabase, que
-- nadie mira, y las marcas `mail_*_enviado_at` de la migración 146 dicen que el
-- envío se PIDIÓ, no que Resend lo haya aceptado. Es exactamente la forma que
-- tuvo el incidente de Mercado Pago del 2026-08-25: el botón se veía perfecto
-- los 18 días que estuvo roto porque nadie tenía dónde ver el fallo.
--
-- Además, es la regla del proyecto: toda capacidad de plataforma tiene que
-- verse desde `/super-admin/*`.
create table if not exists public.email_log (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null,
  destinatario   text not null,
  asunto         text not null,
  -- 'enviado' cuando Resend lo aceptó; 'error' cuando lo rechazó o no hubo red.
  estado         text not null check (estado in ('enviado', 'error')),
  -- El id de Resend: con él se consulta el estado real de entrega en su API.
  resend_id      text,
  error          text,
  -- A quién le corresponde el mail, para poder mirarlo desde la ficha.
  usuario_id     uuid references public.profiles(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete set null,
  order_id       uuid references public.medication_orders(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_email_log_created_at   on public.email_log(created_at desc);
create index if not exists idx_email_log_estado       on public.email_log(estado);
create index if not exists idx_email_log_tipo         on public.email_log(tipo);
create index if not exists idx_email_log_usuario      on public.email_log(usuario_id);

alter table public.email_log enable row level security;

-- Sólo lectura, y sólo para el equipo interno: un mail contiene el nombre del
-- profesional que atendió a un paciente, o sea información de salud.
-- `get_my_role()` es SECURITY DEFINER a propósito (ver la invariante de RLS en
-- CLAUDE.md); una policy que consulte `profiles` directo entra en recursión.
drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log
  for select to authenticated
  using (public.get_my_role() in ('admin', 'super_admin'));

-- Escribe sólo la service key (la Edge Function `send-email`). Sin policy de
-- insert, nadie más puede escribir acá aunque tenga sesión.
