-- 145 — Camino al consultorio: el paciente comparte su llegada al turno presencial.
--
-- El paciente que va a un turno presencial ve la ruta hasta el consultorio en un
-- mapa, y mientras se mueve la app publica acá su posición, su ETA y la distancia
-- que le falta. El profesional de ESE turno lo lee en su agenda ("llega en 8 min").
--
-- Por qué una tabla aparte y no columnas en `consultations`:
--   1. RLS distinta. La posición en vivo de un paciente es el dato más sensible
--      que maneja la app y sólo la puede leer el profesional de ese turno — no
--      quien tenga permiso de leer la consulta.
--   2. Se escribe cada pocos segundos mientras dura el viaje. Ensuciar
--      `consultations` con esa tasa de UPDATE le pega a todo lo que la lee.
--   3. Es efímero: cuando el turno pasa, la fila se puede borrar sin tocar la
--      consulta ni su historia clínica.
--
-- La ubicación del consultorio NO se guarda acá: sale de
-- `professional_profiles.latitude/longitude`, que es la fuente única (misma que
-- usa el mapa de profesionales cercanos).

create table if not exists public.consultation_arrivals (
  consultation_id  uuid primary key references public.consultations(id) on delete cascade,
  patient_id       uuid not null references public.profiles(id) on delete cascade,
  professional_id  uuid not null references public.profiles(id) on delete cascade,

  -- Última posición conocida del paciente.
  latitude         numeric(9,6) not null,
  longitude        numeric(9,6) not null,

  -- Lo que calcula la API de rutas para esa posición.
  eta_minutes      integer,
  distance_meters  integer,
  travel_mode      text not null default 'driving'
                     check (travel_mode in ('driving', 'walking')),

  -- `en_camino` mientras comparte; `llegado` cuando entra al radio del
  -- consultorio o lo marca a mano; `finalizado` cuando deja de compartir.
  status           text not null default 'en_camino'
                     check (status in ('en_camino', 'llegado', 'finalizado')),

  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_consultation_arrivals_professional
  on public.consultation_arrivals(professional_id, updated_at desc);

comment on table public.consultation_arrivals is
  'Posición y ETA en vivo del paciente que va camino a un turno presencial. Efímero: se puede purgar una vez pasado el turno.';

-- `updated_at` lo pone la base, no el cliente: es lo que decide si el dato que
-- ve el profesional está fresco o si el paciente perdió señal.
create or replace function public.touch_consultation_arrival()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_consultation_arrival on public.consultation_arrivals;
create trigger trg_touch_consultation_arrival
  before update on public.consultation_arrivals
  for each row execute function public.touch_consultation_arrival();

alter table public.consultation_arrivals enable row level security;

-- El paciente es dueño de su propia ubicación: la crea, la actualiza y la borra.
-- El `with check` sobre `consultations` evita que alguien publique una llegada
-- contra un turno que no es suyo o contra otro profesional.
drop policy if exists arrivals_patient_all on public.consultation_arrivals;
create policy arrivals_patient_all on public.consultation_arrivals
  for all
  using (patient_id = auth.uid())
  with check (
    patient_id = auth.uid()
    and exists (
      select 1 from public.consultations c
      where c.id = consultation_id
        and c.patient_id = auth.uid()
        and c.professional_id = consultation_arrivals.professional_id
    )
  );

-- El profesional SÓLO lee, y sólo las llegadas dirigidas a él.
drop policy if exists arrivals_professional_read on public.consultation_arrivals;
create policy arrivals_professional_read on public.consultation_arrivals
  for select
  using (professional_id = auth.uid());

-- El super admin lo ve para poder monitorear la operación (regla de visibilidad
-- del panel de administración).
drop policy if exists arrivals_admin_read on public.consultation_arrivals;
create policy arrivals_admin_read on public.consultation_arrivals
  for select
  using (public.get_my_role() in ('admin', 'super_admin'));

-- Realtime: el profesional ve el ETA moverse sin refrescar.
alter table public.consultation_arrivals replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'consultation_arrivals'
  ) then
    alter publication supabase_realtime add table public.consultation_arrivals;
  end if;
end $$;
