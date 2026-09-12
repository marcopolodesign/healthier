-- 161 — Cambiar el correo de acceso pide DOS códigos: al viejo y al nuevo.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- Lo planteó Mateo (2026-09-11): *"me voy de vacaciones, no quiero atender pero
-- necesito plata, cambio mi correo y se lo paso a alguien con todos mis datos
-- profesionales para que atienda por mí"*. Hoy el producto **no tiene pantalla
-- para cambiar el correo** —la plantilla del mail existe pero no la dispara
-- nada—, así que esto construye el camino directamente con el control puesto,
-- en vez de agregarlo después.
--
-- ── Las dos decisiones, y son suyas ──────────────────────────────────────────
-- 1. **Los códigos son dos y hacen falta los dos**: uno al correo actual y otro
--    al nuevo, los dos se escriben en la misma pantalla. Con el código sólo al
--    correo nuevo no se prueba nada: quien recibe la cuenta lo escribe sin
--    problema.
-- 2. **Sólo el cambio queda pendiente.** El profesional sigue atendiendo con su
--    correo de siempre mientras no verifique. Nadie deja de trabajar por
--    olvidarse de verificar un código.
--
-- ── Por qué la tabla no se puede leer ────────────────────────────────────────
-- Los códigos viven en las mismas filas. RLS es por fila, no por columna, así
-- que la tabla queda **sin una sola policy**: ni el dueño la lee. Todo pasa por
-- la Edge Function `cambio-de-correo`, que corre con service role y devuelve el
-- estado (a qué correo, cuándo vence, cuántos intentos quedan) sin los códigos.

create table if not exists public.email_change_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  new_email     text not null,
  code_current  text not null,
  code_new      text not null,
  attempts      int  not null default 0,
  expires_at    timestamptz not null default now() + interval '30 minutes',
  applied_at    timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.email_change_requests is
  'Cambio de correo de acceso. Dos códigos: uno al correo actual y otro al nuevo, los dos obligatorios. Sin policies a propósito — los códigos no los lee nadie salvo la Edge Function cambio-de-correo.';

create index if not exists email_change_requests_user_idx
  on public.email_change_requests (user_id)
  where applied_at is null and cancelled_at is null;

alter table public.email_change_requests enable row level security;
-- (sin policies: sólo service role)

-- ═════════════════════════════════════════════════════════════════════════════
-- Los dos mails salen de la base, como todos los demás
-- ═════════════════════════════════════════════════════════════════════════════
-- Mismo patrón que las migraciones 143/146: el disparo vive acá y no en quien
-- crea la fila, así que da igual desde dónde se haya pedido el cambio.
create or replace function public.avisar_cambio_de_correo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'cambio-correo', 'requestId', new.id, 'destino', 'actual'));
  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'cambio-correo', 'requestId', new.id, 'destino', 'nuevo'));
  return new;
end;
$$;

drop trigger if exists email_change_requests_mails on public.email_change_requests;
create trigger email_change_requests_mails
  after insert on public.email_change_requests
  for each row execute function public.avisar_cambio_de_correo();
