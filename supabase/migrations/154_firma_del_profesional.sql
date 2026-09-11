-- ── Firma del profesional para la receta electrónica ─────────────────────────
--
-- El PDF de la receta tiene un bloque "FIRMA Y SELLO" que hasta hoy salía con
-- la línea de puño vacía. La API de recetas acepta la firma como imagen en
-- `medico.firmabase64` (PNG en base64 CRUDO — un `data:image/png;base64,` al
-- frente se ignora en silencio, probado el 2026-09-11 contra homologación) y
-- el sello como tres líneas de texto en `medico.sello`.
--
-- ── Por qué una tabla propia y no una columna en `professional_profiles` ─────
-- `professional_profiles` tiene lectura PÚBLICA para todo profesional
-- verificado (policy `prof_profiles_public_read`, migración 001): cualquier
-- paciente logueado puede leer la fila entera. La firma ológrafa de un médico
-- es exactamente la clase de dato que no puede quedar ahí — con ella se
-- falsifica una receta en papel. Por eso vive en una tabla aparte cuya única
-- policy de lectura es "sos vos mismo".
--
-- El super admin NO ve la imagen: ve `professional_profiles.has_signature`, un
-- booleano que mantiene el trigger de abajo. Alcanza para lo que la
-- administración necesita saber (quién cargó firma y quién no) sin repartir la
-- firma de nadie. La Edge Function `rcta-issue` la lee con el service role,
-- que se saltea RLS.

create table if not exists public.professional_signatures (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  firma_png   text not null,
  origen      text not null check (origen in ('trazo', 'foto')),
  ancho       integer,
  alto        integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.professional_signatures is
  'Firma ológrafa del profesional, para imprimir en el bloque FIRMA Y SELLO de la receta electrónica. Una fila por profesional. Tabla aparte de professional_profiles porque esa tiene lectura pública y esto no puede ser público.';
comment on column public.professional_signatures.firma_png is
  'PNG en base64 CRUDO, sin el prefijo data:image/png;base64, — es el formato que espera medico.firmabase64. Recortado al trazo (sin márgenes) porque el slot del PDF es chico y el margen se come el dibujo.';
comment on column public.professional_signatures.origen is
  'trazo = la dibujó con el dedo/mouse; foto = subió una imagen de su firma en papel.';

create trigger professional_signatures_updated_at
  before update on public.professional_signatures
  for each row execute function public.set_updated_at();

-- ── RLS: la firma es del profesional y de nadie más ──────────────────────────
alter table public.professional_signatures enable row level security;

drop policy if exists prof_signature_owner on public.professional_signatures;
create policy prof_signature_owner on public.professional_signatures
  for all to public
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── El booleano que sí puede ver la administración ───────────────────────────
alter table public.professional_profiles
  add column if not exists has_signature boolean not null default false;

comment on column public.professional_profiles.has_signature is
  'Si el profesional cargó su firma para las recetas. Lo mantiene el trigger sync_has_signature — nunca escribirlo a mano. Es un booleano a propósito: la imagen de la firma NO es pública.';

create or replace function public.sync_has_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.professional_profiles
     set has_signature = (tg_op <> 'DELETE')
   where user_id = coalesce(new.user_id, old.user_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists professional_signatures_sync on public.professional_signatures;
create trigger professional_signatures_sync
  after insert or update or delete on public.professional_signatures
  for each row execute function public.sync_has_signature();

-- ── Las columnas de auditoría que `rcta-issue` escribía contra la nada ───────
--
-- `registrar()` inserta `{...ctx, ...extra}` en `rcta_issue_log`. El bloque de
-- reintento venía cargando en `ctx` cuatro claves que la migración 092 nunca
-- creó como columnas (`retry_sin_logo`, `logo_rejected`, `logo_rejection_*`).
-- PostgREST rechaza el insert entero ante una columna inexistente, y como
-- escribir el log "nunca puede tumbar una emisión" el error se traga en un
-- catch — o sea que la receta salía bien y el renglón de auditoría se perdía
-- entero, justo en el único caso que vale la pena auditar: el que hubo que
-- reintentar. Nunca se vio porque todavía no se emitió ninguna receta real.
--
-- Se resuelve con UNA columna jsonb en vez de siete: el detalle del reintento
-- es diagnóstico, se lee a mano cuando algo salió mal, y no hay ninguna
-- consulta que lo filtre por campo.
alter table public.rcta_issue_log
  add column if not exists reintento jsonb,
  add column if not exists con_firma boolean;

comment on column public.rcta_issue_log.reintento is
  'Detalle del reintento sin logo ni firma, cuando lo hubo: si se disparó, si llevaba firma, y el status/cuerpo del rechazo original de Innovamed. NULL en la emisión normal.';
comment on column public.rcta_issue_log.con_firma is
  'Si la receta se emitió con la firma ológrafa del profesional. La firma es opcional (decisión de Mateo, 2026-09-11), así que false es un caso válido, no un error.';

-- Backfill por si ya hubiera filas (no las hay hoy, pero la migración tiene que
-- poder correrse sobre una base que las tenga).
update public.professional_profiles pp
   set has_signature = exists (
     select 1 from public.professional_signatures s where s.user_id = pp.user_id
   )
 where pp.has_signature is distinct from exists (
     select 1 from public.professional_signatures s where s.user_id = pp.user_id
   );
