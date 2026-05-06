-- recurring weekly availability for professionals
create table if not exists public.professional_schedules (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week     smallint not null check (day_of_week between 0 and 6), -- 0=Sunday … 6=Saturday
  start_time      time not null,
  end_time        time not null,
  created_at      timestamptz not null default now(),
  constraint professional_schedules_no_overlap unique (professional_id, day_of_week, start_time)
);

alter table public.professional_schedules enable row level security;

create policy "Anyone can read professional schedules"
  on public.professional_schedules for select using (true);

create policy "Professionals manage their own schedules"
  on public.professional_schedules for all
  using (auth.uid() = professional_id)
  with check (auth.uid() = professional_id);
