-- ============================================================
-- 227 — Órdenes de estudios emitidas por el servicio de recetas
-- ============================================================
-- Pedido de una profesional (2026-11-02): "Con los medicamentos al final te
-- deja emitir la receta y enviar al paciente. Con los estudios después de
-- guardar no aparece nada." Hasta acá la orden de estudios quedaba sólo como
-- una entrada de la HC (`clinical_entries`, entry_type 'order'), sin PDF ni
-- firma. Ahora se emite con el endpoint de prácticas del servicio de recetas
-- (POST /apirecipe/prescribirPractica) desde la Edge Function `rcta-estudios`.
--
-- Mismo diseño que los certificados (migraciones 222/226), a propósito:
--   · `clinical_study_orders`: un renglón por emisión. La escribe SÓLO la Edge
--     Function (service role). Lectura: paciente las suyas, profesional las que
--     emitió, super admin todas.
--   · Una sola 'pending' por entrada de la HC (índice único): dos clics o la app
--     y la web a la vez no emiten dos órdenes.
--   · `llamado_at` / `a_revisar`: si se llamó al servicio y no quedó la
--     respuesta, puede existir del otro lado y no se reemite a ciegas. Lo libera
--     el super admin (`liberar_orden_estudios_a_revisar`).
--   · `rcta_issue_log.estudios_orden_id`: el log crudo de cada llamada.
--   · Mail + push al paciente cuando queda emitida, una sola vez, desde la base.
-- ============================================================

create table if not exists public.clinical_study_orders (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  patient_id         uuid not null references public.profiles(id) on delete restrict,
  professional_id    uuid not null references public.profiles(id) on delete restrict,
  encounter_id       uuid not null references public.clinical_encounters(id) on delete restrict,
  consultation_id    uuid references public.consultations(id) on delete set null,
  -- La orden de la HC que se emite (entry_type 'order').
  entry_id           uuid not null references public.clinical_entries(id) on delete restrict,

  -- Lo que salió: [{ id, nombre, categoria }] con el id del catálogo de prácticas.
  estudios           jsonb not null default '[]'::jsonb,
  indicaciones       text check (char_length(indicaciones) <= 1000),
  diagnostico        text check (char_length(diagnostico) <= 200),

  status             text not null default 'pending'
                     check (status in ('pending', 'issued', 'error', 'anulado')),
  error_detalle      text,

  rcta_hash          text,   -- `otrasRecetas[0].id`: con esto se anula
  rcta_numero        text,   -- `numeroPrescripcion`, el impreso
  rcta_verificador   text,
  rcta_pdf_url       text,
  rcta_issued_at     timestamptz,

  anulado_at         timestamptz,
  anulacion_estado   text check (anulacion_estado in ('confirmada', 'no_hacia_falta', 'error')),
  anulacion_detalle  text,

  llamado_at         timestamptz,
  a_revisar          boolean not null default false,
  revisado_por       uuid references public.profiles(id) on delete set null,
  revisado_at        timestamptz,

  mail_enviado_at    timestamptz
);

comment on table public.clinical_study_orders is
  'Migración 227. Órdenes de estudios emitidas por el servicio de recetas (prescribirPractica). Las escribe sólo la Edge Function rcta-estudios.';

create index if not exists clinical_study_orders_patient_idx
  on public.clinical_study_orders (patient_id, created_at desc);
create index if not exists clinical_study_orders_entry_idx
  on public.clinical_study_orders (entry_id);
create unique index if not exists clinical_study_orders_uno_pendiente_idx
  on public.clinical_study_orders (entry_id) where status = 'pending';
create index if not exists clinical_study_orders_a_revisar_idx
  on public.clinical_study_orders (entry_id) where a_revisar;

alter table public.clinical_study_orders enable row level security;

drop policy if exists clinical_study_orders_paciente_lee on public.clinical_study_orders;
-- El paciente ve sólo las emitidas: las pendientes/fallidas llevan detalle interno.
create policy clinical_study_orders_paciente_lee on public.clinical_study_orders
  for select using (patient_id = auth.uid() and status = 'issued');

drop policy if exists clinical_study_orders_profesional_lee on public.clinical_study_orders;
create policy clinical_study_orders_profesional_lee on public.clinical_study_orders
  for select using (professional_id = auth.uid());

drop policy if exists clinical_study_orders_super_admin_lee on public.clinical_study_orders;
create policy clinical_study_orders_super_admin_lee on public.clinical_study_orders
  for select using (public.get_my_role() = 'super_admin');

create or replace function public.clinical_study_orders_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clinical_study_orders_touch on public.clinical_study_orders;
create trigger clinical_study_orders_touch
  before update on public.clinical_study_orders
  for each row execute function public.clinical_study_orders_touch();

alter table public.rcta_issue_log
  add column if not exists estudios_orden_id uuid references public.clinical_study_orders(id) on delete set null;
create index if not exists rcta_issue_log_estudios_orden_idx
  on public.rcta_issue_log (estudios_orden_id) where estudios_orden_id is not null;

-- ── Aviso al paciente: mail + push, una sola vez ────────────────────────────
create or replace function public.avisar_orden_estudios_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from 'issued'
     or old.status is not distinct from new.status
     or new.mail_enviado_at is not null then
    return new;
  end if;

  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'orden_estudios', 'ordenEstudiosId', new.id
  ));
  perform public.enviar_push_tipo(
    new.patient_id, 'orden-estudios-emitida',
    jsonb_build_object('ordenEstudiosId', new.id)
  );

  update public.clinical_study_orders
     set mail_enviado_at = now()
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists clinical_study_orders_avisar on public.clinical_study_orders;
create trigger clinical_study_orders_avisar
  after update of status on public.clinical_study_orders
  for each row execute function public.avisar_orden_estudios_al_paciente();

-- ── El super admin confirmó con el servicio que no salió ────────────────────
create or replace function public.liberar_orden_estudios_a_revisar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Sólo el super admin' using errcode = '42501';
  end if;
  update public.clinical_study_orders
     set a_revisar = false, revisado_por = auth.uid(), revisado_at = now()
   where id = p_id and a_revisar;
  if not found then
    raise exception 'Esa orden ya no está a revisar.' using errcode = 'P0002';
  end if;
  perform public._aal_escribir(null, 'orden_estudios_liberada', 'clinical_study_orders', p_id::text, null,
    jsonb_build_object('motivo', 'no salió del servicio de recetas'));
end;
$$;
revoke all on function public.liberar_orden_estudios_a_revisar(uuid) from public, anon;
grant execute on function public.liberar_orden_estudios_a_revisar(uuid) to authenticated;
