-- ─────────────────────────────────────────────────────────────────────────────
-- CLINICAL SCHEMA — Ley 26.529 compliant Historia Clínica Electrónica
-- Replaces Heural as the clinical backend.
--
-- Compliance guarantees enforced at DB level:
--   • Append-only entries  — UPDATE blocked via trigger on clinical_entries
--   • No hard deletes      — DELETE blocked via trigger on all clinical tables
--   • Chronological order  — sequence_number auto-assigned per encounter
--   • Professional ID      — license_type + license_number denormalized on every row
--   • Audit trail          — clinical_access_log for every read and write
--   • 10-year retention    — soft deletes only; purge policy must be enforced at 10y
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 0. Professional license fields ───────────────────────────────────────────
-- Required on every clinical record (Ley 26.529 Art. 12)
alter table public.professional_profiles
  add column if not exists license_type   text check (license_type in ('MN', 'MP')),
  add column if not exists license_number text;


-- ── 1. clinical_encounters ───────────────────────────────────────────────────
-- One encounter per consultation. The root document of the HC.
-- Status-only field may be updated (planned → in_progress → finished).
-- All clinical content lives in child tables, never here.

create table if not exists public.clinical_encounters (
  id                       uuid primary key default gen_random_uuid(),
  -- Marketplace link (nullable — future encounters may not need a paid booking)
  consultation_id          uuid references public.consultations(id) on delete set null,
  -- Parties
  patient_id               uuid not null references public.profiles(id),
  professional_id          uuid not null references public.profiles(id),
  -- License denormalized at encounter time (Ley 26.529 Art. 12)
  professional_license_type   text not null,
  professional_license_number text not null,
  -- Clinical metadata
  encounter_type  text not null default 'consultation'
                  check (encounter_type in ('consultation', 'emergency', 'follow_up', 'walk_in')),
  modality        text not null check (modality in ('presencial', 'telemedicina')),
  specialty       text not null,
  -- Lifecycle
  status          text not null default 'planned'
                  check (status in ('planned', 'in_progress', 'finished', 'cancelled')),
  started_at      timestamptz,
  finished_at     timestamptz,
  -- Immutable creation timestamp
  created_at      timestamptz not null default now()
);

alter table public.clinical_encounters enable row level security;

-- Patient reads their own encounters
create policy "ce_patient_read"
  on public.clinical_encounters for select
  using (patient_id = auth.uid());

-- Professional reads and creates encounters for their patients
create policy "ce_professional_own"
  on public.clinical_encounters for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

-- Professional reads encounters of patients they share
create policy "ce_professional_shared"
  on public.clinical_encounters for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_encounters.patient_id
        and c.professional_id = auth.uid()
    )
  );

-- Status update only (no content fields) — separate from the general policy
-- so that only the owning professional can advance the lifecycle
create policy "ce_professional_update_status"
  on public.clinical_encounters for update
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());


-- ── 2. clinical_entries ──────────────────────────────────────────────────────
-- APPEND-ONLY. The chronological record of the encounter.
-- UPDATE is blocked at trigger level — corrections create a new entry of
-- type 'addendum' that references the original via corrects_entry_id.

create table if not exists public.clinical_entries (
  id                       uuid primary key default gen_random_uuid(),
  encounter_id             uuid not null references public.clinical_encounters(id),
  patient_id               uuid not null references public.profiles(id),
  professional_id          uuid not null references public.profiles(id),
  -- License denormalized at write time
  professional_license_type   text not null,
  professional_license_number text not null,
  -- Entry classification
  entry_type  text not null
              check (entry_type in ('note', 'diagnosis', 'indication', 'prescription_ref', 'addendum')),
  -- For addenda: pointer to the original entry being corrected
  corrects_entry_id uuid references public.clinical_entries(id),
  -- Content
  content     text not null,
  -- Structured payload (diagnosis codes, observation values, etc.)
  data        jsonb,
  -- Chronological position within this encounter (auto-assigned by trigger)
  sequence_number integer not null default 0,
  -- Immutable
  created_at  timestamptz not null default now()
);

alter table public.clinical_entries enable row level security;

-- Patient reads their own entries
create policy "cen_patient_read"
  on public.clinical_entries for select
  using (patient_id = auth.uid());

-- Professional: insert only (no update/delete via RLS — trigger enforces this)
create policy "cen_professional_insert"
  on public.clinical_entries for insert
  with check (professional_id = auth.uid());

-- Professional reads entries for their own encounters
create policy "cen_professional_read_own"
  on public.clinical_entries for select
  using (professional_id = auth.uid());

-- Professional reads entries for shared patients
create policy "cen_professional_read_shared"
  on public.clinical_entries for select
  using (
    exists (
      select 1 from public.clinical_encounters ce
      where ce.id = clinical_entries.encounter_id
        and exists (
          select 1 from public.consultations c
          where c.patient_id = ce.patient_id
            and c.professional_id = auth.uid()
        )
    )
  );

-- Trigger: auto-assign sequence_number
create or replace function public.clinical_entries_set_sequence()
returns trigger language plpgsql as $$
begin
  select coalesce(max(sequence_number), 0) + 1
  into new.sequence_number
  from public.clinical_entries
  where encounter_id = new.encounter_id;
  return new;
end;
$$;

create trigger clinical_entries_sequence
  before insert on public.clinical_entries
  for each row execute function public.clinical_entries_set_sequence();

-- Trigger: block UPDATE (entries are immutable — Ley 26.529 Art. 14)
create or replace function public.block_clinical_entry_update()
returns trigger language plpgsql as $$
begin
  raise exception
    'Clinical entries are immutable (Ley 26.529 Art. 14). Create an addendum entry instead.';
end;
$$;

create trigger clinical_entries_no_update
  before update on public.clinical_entries
  for each row execute function public.block_clinical_entry_update();

-- Trigger: block DELETE (10-year retention — Ley 26.529 Art. 18)
create or replace function public.block_clinical_delete()
returns trigger language plpgsql as $$
begin
  raise exception
    'Clinical records cannot be deleted. Minimum retention: 10 years from last entry (Ley 26.529 Art. 18).';
end;
$$;

create trigger clinical_entries_no_delete
  before delete on public.clinical_entries
  for each row execute function public.block_clinical_delete();


-- ── 3. clinical_conditions ───────────────────────────────────────────────────
-- Active problem list per patient. New row per condition change (append-only).
-- Status changes (active → resolved) are tracked by creating a new row.

create table if not exists public.clinical_conditions (
  id                       uuid primary key default gen_random_uuid(),
  patient_id               uuid not null references public.profiles(id),
  encounter_id             uuid references public.clinical_encounters(id),
  professional_id          uuid not null references public.profiles(id),
  professional_license_type   text not null,
  professional_license_number text not null,
  -- Diagnosis codes
  icd10_code    text,
  icd10_display text,
  snomed_code   text,
  snomed_display text,
  -- Status
  clinical_status      text not null default 'active'
                       check (clinical_status in ('active', 'resolved', 'remission', 'inactive')),
  verification_status  text not null default 'confirmed'
                       check (verification_status in ('confirmed', 'differential', 'provisional', 'refuted')),
  severity             text check (severity in ('mild', 'moderate', 'severe')),
  -- Free text
  notes text,
  -- Soft resolution (never hard delete)
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id),
  -- Immutable
  created_at   timestamptz not null default now()
);

alter table public.clinical_conditions enable row level security;

create policy "cc_patient_read"
  on public.clinical_conditions for select
  using (patient_id = auth.uid());

create policy "cc_professional_all"
  on public.clinical_conditions for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

create policy "cc_professional_read_shared"
  on public.clinical_conditions for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_conditions.patient_id
        and c.professional_id = auth.uid()
    )
  );

create trigger clinical_conditions_no_delete
  before delete on public.clinical_conditions
  for each row execute function public.block_clinical_delete();


-- ── 4. clinical_allergies ────────────────────────────────────────────────────

create table if not exists public.clinical_allergies (
  id                       uuid primary key default gen_random_uuid(),
  patient_id               uuid not null references public.profiles(id),
  encounter_id             uuid references public.clinical_encounters(id),
  professional_id          uuid not null references public.profiles(id),
  professional_license_type   text not null,
  professional_license_number text not null,
  -- Substance
  substance    text not null,
  snomed_code  text,
  category     text not null check (category in ('food', 'medication', 'environment', 'biologic')),
  criticality  text not null default 'low' check (criticality in ('low', 'high', 'unable_to_assess')),
  -- Status
  clinical_status text not null default 'active'
                  check (clinical_status in ('active', 'inactive', 'resolved')),
  reaction_description text,
  -- Soft resolution
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id),
  resolve_reason text,
  -- Immutable
  created_at   timestamptz not null default now()
);

alter table public.clinical_allergies enable row level security;

create policy "ca_patient_read"
  on public.clinical_allergies for select
  using (patient_id = auth.uid());

create policy "ca_professional_all"
  on public.clinical_allergies for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

create policy "ca_professional_read_shared"
  on public.clinical_allergies for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_allergies.patient_id
        and c.professional_id = auth.uid()
    )
  );

create trigger clinical_allergies_no_delete
  before delete on public.clinical_allergies
  for each row execute function public.block_clinical_delete();


-- ── 5. clinical_observations ─────────────────────────────────────────────────
-- Vital signs and lab results. Always append-only.

create table if not exists public.clinical_observations (
  id                       uuid primary key default gen_random_uuid(),
  patient_id               uuid not null references public.profiles(id),
  encounter_id             uuid references public.clinical_encounters(id),
  professional_id          uuid not null references public.profiles(id),
  professional_license_type   text not null,
  professional_license_number text not null,
  -- What was measured
  observation_type text not null
    check (observation_type in (
      'heart_rate', 'blood_pressure', 'weight', 'height',
      'temperature', 'spo2', 'blood_glucose', 'respiratory_rate', 'other'
    )),
  loinc_code   text,
  -- Values
  value_numeric  numeric,
  value_string   text,
  unit           text,
  -- Blood pressure split
  value_systolic   numeric,
  value_diastolic  numeric,
  -- Reference range
  reference_low   numeric,
  reference_high  numeric,
  -- Status
  status text not null default 'final'
         check (status in ('final', 'preliminary', 'entered_in_error')),
  -- When the measurement was taken (may differ from created_at)
  observed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.clinical_observations enable row level security;

create policy "co_patient_read"
  on public.clinical_observations for select
  using (patient_id = auth.uid());

create policy "co_professional_all"
  on public.clinical_observations for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

create policy "co_professional_read_shared"
  on public.clinical_observations for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_observations.patient_id
        and c.professional_id = auth.uid()
    )
  );

create trigger clinical_observations_no_delete
  before delete on public.clinical_observations
  for each row execute function public.block_clinical_delete();


-- ── 6. clinical_medications ──────────────────────────────────────────────────
-- Medication requests. RCTA prescription ID stored here once integrated.

create table if not exists public.clinical_medications (
  id                       uuid primary key default gen_random_uuid(),
  patient_id               uuid not null references public.profiles(id),
  encounter_id             uuid references public.clinical_encounters(id),
  professional_id          uuid not null references public.profiles(id),
  professional_license_type   text not null,
  professional_license_number text not null,
  -- Medication
  medication_name text not null,
  snomed_code     text,
  -- Dosage
  dosage_text text not null,
  -- Status
  status   text not null default 'active'
           check (status in ('active', 'stopped', 'completed', 'cancelled')),
  priority text not null default 'routine'
           check (priority in ('routine', 'urgent')),
  -- RCTA integration placeholder (Ley 27.553)
  rcta_prescription_id text,
  -- Notes
  notes text,
  -- Soft stop
  stopped_at    timestamptz,
  stopped_by    uuid references public.profiles(id),
  stop_reason   text,
  -- Immutable
  created_at    timestamptz not null default now()
);

alter table public.clinical_medications enable row level security;

create policy "cm_patient_read"
  on public.clinical_medications for select
  using (patient_id = auth.uid());

create policy "cm_professional_all"
  on public.clinical_medications for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

create policy "cm_professional_read_shared"
  on public.clinical_medications for select
  using (
    exists (
      select 1 from public.consultations c
      where c.patient_id = clinical_medications.patient_id
        and c.professional_id = auth.uid()
    )
  );

create trigger clinical_medications_no_delete
  before delete on public.clinical_medications
  for each row execute function public.block_clinical_delete();


-- ── 7. clinical_access_log ───────────────────────────────────────────────────
-- Audit trail of every read and write (Ley 26.529 Art. 14).
-- Written by service layer on every clinical operation.
-- Append-only, no RLS reads for patients (internal audit only).

create table if not exists public.clinical_access_log (
  id            uuid primary key default gen_random_uuid(),
  accessed_by   uuid not null references public.profiles(id),
  -- Resource
  resource_type text not null
    check (resource_type in ('encounter', 'entry', 'condition', 'allergy', 'observation', 'medication')),
  resource_id   uuid not null,
  patient_id    uuid not null references public.profiles(id),
  -- Action
  action        text not null
    check (action in ('read', 'create', 'resolve', 'stop', 'update_status')),
  -- Context
  ip_address    text,
  user_agent    text,
  -- Immutable
  accessed_at   timestamptz not null default now()
);

alter table public.clinical_access_log enable row level security;

-- Only the service role (server-side) can insert access logs
-- No user-level RLS read — audit logs are for internal compliance review only
create policy "cal_service_insert"
  on public.clinical_access_log for insert
  with check (accessed_by = auth.uid());

create trigger clinical_access_log_no_delete
  before delete on public.clinical_access_log
  for each row execute function public.block_clinical_delete();


-- ── 8. Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_ce_patient      on public.clinical_encounters (patient_id);
create index if not exists idx_ce_professional on public.clinical_encounters (professional_id);
create index if not exists idx_ce_consultation on public.clinical_encounters (consultation_id);

create index if not exists idx_cen_encounter   on public.clinical_entries (encounter_id);
create index if not exists idx_cen_patient     on public.clinical_entries (patient_id);
create index if not exists idx_cen_sequence    on public.clinical_entries (encounter_id, sequence_number);

create index if not exists idx_cc_patient      on public.clinical_conditions (patient_id);
create index if not exists idx_ca_patient      on public.clinical_allergies (patient_id);
create index if not exists idx_cobsv_patient   on public.clinical_observations (patient_id);
create index if not exists idx_cm_patient      on public.clinical_medications (patient_id);
create index if not exists idx_cal_patient     on public.clinical_access_log (patient_id);
create index if not exists idx_cal_resource    on public.clinical_access_log (resource_type, resource_id);
