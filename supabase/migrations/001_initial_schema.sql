-- ============================================================
-- Healthier MVP — Initial Schema
-- ============================================================

-- ── Enable extensions ────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── profiles ─────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  birth_date   date,
  avatar_url   text,
  role         text not null default 'patient'
                check (role in ('patient','professional','admin','super_admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── professional_profiles ────────────────────────────────────
create table if not exists public.professional_profiles (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.profiles(id) on delete cascade unique,
  specialty            text,
  sub_specialty        text,
  bio                  text,
  session_price        numeric(10,2),
  calendly_url         text,
  is_on_demand         boolean not null default false,
  is_verified          boolean not null default false,
  is_active            boolean not null default false,
  average_rating       numeric(3,1) not null default 0,
  total_reviews        integer not null default 0,
  title_document_url   text,
  license_document_url text,
  dni_document_url     text,
  submitted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── availability_slots ───────────────────────────────────────
create table if not exists public.availability_slots (
  id              uuid primary key default uuid_generate_v4(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  is_booked       boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ── consultations ────────────────────────────────────────────
create table if not exists public.consultations (
  id                  uuid primary key default uuid_generate_v4(),
  patient_id          uuid not null references public.profiles(id) on delete cascade,
  professional_id     uuid not null references public.profiles(id) on delete cascade,
  status              text not null default 'pending'
                       check (status in ('pending','confirmed','in_progress','completed','cancelled')),
  scheduled_at        timestamptz,
  completed_at        timestamptz,
  closing_notes       text,
  calendly_event_uri  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── reviews ──────────────────────────────────────────────────
create table if not exists public.reviews (
  id              uuid primary key default uuid_generate_v4(),
  consultation_id uuid references public.consultations(id) on delete set null,
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  rating          integer not null check (rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now()
);

-- ── medical_documents ────────────────────────────────────────
create table if not exists public.medical_documents (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  file_name   text not null,
  file_url    text not null,
  file_size   bigint,
  description text,
  created_at  timestamptz not null default now()
);

-- ── updated_at trigger ───────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger professional_profiles_updated_at
  before update on public.professional_profiles
  for each row execute function public.set_updated_at();

create trigger consultations_updated_at
  before update on public.consultations
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.availability_slots  enable row level security;
alter table public.consultations       enable row level security;
alter table public.reviews             enable row level security;
alter table public.medical_documents   enable row level security;

-- profiles: users can read their own; admins see all
create policy "profiles_read_own" on public.profiles
  for select using (auth.uid() = id or
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- professional_profiles: public read for verified; owner update; admin all
create policy "prof_profiles_public_read" on public.professional_profiles
  for select using (is_verified = true or user_id = auth.uid() or
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

create policy "prof_profiles_owner_write" on public.professional_profiles
  for all using (user_id = auth.uid() or
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

-- consultations: patient or professional or admin
create policy "consultations_access" on public.consultations
  for all using (
    patient_id = auth.uid() or
    professional_id = auth.uid() or
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

-- reviews: public read; patient write own
create policy "reviews_public_read" on public.reviews
  for select using (true);

create policy "reviews_patient_write" on public.reviews
  for insert with check (patient_id = auth.uid());

-- medical_documents: owner only
create policy "docs_owner" on public.medical_documents
  for all using (patient_id = auth.uid());

-- availability_slots: public read; professional write own
create policy "slots_public_read" on public.availability_slots
  for select using (true);

create policy "slots_prof_write" on public.availability_slots
  for all using (professional_id = auth.uid());

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists idx_professional_profiles_specialty on public.professional_profiles(specialty);
create index if not exists idx_professional_profiles_verified  on public.professional_profiles(is_verified, is_active);
create index if not exists idx_consultations_patient            on public.consultations(patient_id);
create index if not exists idx_consultations_professional       on public.consultations(professional_id);
create index if not exists idx_consultations_status             on public.consultations(status);
create index if not exists idx_reviews_professional             on public.reviews(professional_id);
create index if not exists idx_medical_documents_patient        on public.medical_documents(patient_id);

-- ── Storage buckets (run via Supabase dashboard or MCP) ──────
-- insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
-- insert into storage.buckets (id, name, public) values ('professional-docs', 'professional-docs', false);
-- insert into storage.buckets (id, name, public) values ('patient-docs', 'patient-docs', false);
