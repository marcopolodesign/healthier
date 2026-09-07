-- 149 — Emergencia en camino: el profesional despachado comparte dónde está.
--
-- Hasta acá el mapa que veía el paciente durante una emergencia era una
-- simulación: la "ambulancia" arrancaba en la última ubicación guardada del
-- perfil del profesional (o, si no había, en un punto inventado a +0.015° del
-- paciente) y se interpolaba en línea recta con un contador de 4 minutos. El
-- profesional nunca transmitía nada. Un paciente con una emergencia real veía
-- moverse un punto que no era nadie.
--
-- Esta tabla es el espejo exacto de `consultation_arrivals` (migración 145),
-- con la dirección dada vuelta: allá el paciente le comparte su posición al
-- profesional del turno; acá el profesional despachado se la comparte al
-- paciente de la emergencia. Los mismos motivos de aquella valen igual acá:
--
--   1. RLS propia. La posición en vivo sólo la puede leer el paciente de ESA
--      emergencia, no cualquiera con permiso de leer la fila de `emergencies`.
--   2. Se escribe cada pocos segundos mientras dura el traslado. Esa tasa de
--      UPDATE sobre `emergencies` le pegaría a todo lo que la lee (agenda del
--      paciente, panel del super admin, los dos Realtime ya publicados).
--   3. Es efímero: cerrada la emergencia, la fila se borra sin tocar nada del
--      registro clínico ni del despacho.
--
-- La posición del paciente NO se guarda acá: ya vive en
-- `emergencies.patient_latitude/longitude` (migración 016), que es la fuente
-- única que usa el profesional para navegar hasta él.

create table if not exists public.emergency_tracking (
  emergency_id     uuid primary key references public.emergencies(id) on delete cascade,
  professional_id  uuid not null references public.profiles(id) on delete cascade,
  patient_id       uuid not null references public.profiles(id) on delete cascade,

  -- Última posición conocida del profesional — su GPS, no su perfil.
  latitude         numeric(9,6) not null,
  longitude        numeric(9,6) not null,

  -- Lo que devuelve la API de rutas para esa posición. Null mientras la ruta
  -- todavía no volvió: se muestra "calculando", nunca un número inventado.
  eta_minutes      integer,
  distance_meters  integer,
  travel_mode      text not null default 'driving'
                     check (travel_mode in ('driving', 'walking')),

  -- `en_camino` mientras se traslada; `llegado` al entrar en el radio del
  -- paciente o marcarlo a mano; `finalizado` cuando deja de compartir.
  status           text not null default 'en_camino'
                     check (status in ('en_camino', 'llegado', 'finalizado')),

  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_emergency_tracking_patient
  on public.emergency_tracking(patient_id, updated_at desc);

comment on table public.emergency_tracking is
  'Posición y ETA en vivo del profesional despachado a una emergencia. Efímero: se borra al cerrar la emergencia.';

-- `updated_at` lo pone la base, no el cliente: es lo único que permite
-- distinguir "el médico está acá" de "la app del médico se cerró hace 20 min".
create or replace function public.touch_emergency_tracking()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_emergency_tracking on public.emergency_tracking;
create trigger trg_touch_emergency_tracking
  before update on public.emergency_tracking
  for each row execute function public.touch_emergency_tracking();

alter table public.emergency_tracking enable row level security;

-- El profesional es dueño de su propia ubicación: la crea, la actualiza y la
-- borra. El `with check` contra `emergencies` impide publicar una posición
-- contra una emergencia que no le fue asignada, o declarando otro paciente.
drop policy if exists emergency_tracking_professional_all on public.emergency_tracking;
create policy emergency_tracking_professional_all on public.emergency_tracking
  for all
  using (professional_id = auth.uid())
  with check (
    professional_id = auth.uid()
    and exists (
      select 1 from public.emergencies e
      where e.id = emergency_id
        and e.professional_id = auth.uid()
        and e.patient_id = emergency_tracking.patient_id
    )
  );

-- El paciente SÓLO lee, y sólo el traslado que viene hacia él.
drop policy if exists emergency_tracking_patient_read on public.emergency_tracking;
create policy emergency_tracking_patient_read on public.emergency_tracking
  for select
  using (patient_id = auth.uid());

-- Super admin: la regla de visibilidad del panel de administración — un
-- despacho en curso tiene que poder mirarse desde /super-admin/emergencias.
drop policy if exists emergency_tracking_admin_read on public.emergency_tracking;
create policy emergency_tracking_admin_read on public.emergency_tracking
  for select
  using (public.get_my_role() in ('admin', 'super_admin'));

-- Realtime: el paciente ve moverse el marcador sin refrescar.
alter table public.emergency_tracking replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'emergency_tracking'
  ) then
    alter publication supabase_realtime add table public.emergency_tracking;
  end if;
end $$;
