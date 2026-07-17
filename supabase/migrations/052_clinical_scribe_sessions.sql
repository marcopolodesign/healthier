-- ─────────────────────────────────────────────────────────────────────────────
-- AI SCRIBE — mutable staging table for in-progress consultation transcription
--
-- clinical_entries is append-only (see 033_clinical_schema.sql) — a note being
-- transcribed/reviewed/voice-edited needs somewhere mutable to live BEFORE the
-- professional confirms it. This table is that scratch pad. Once confirmed, the
-- structured note is committed as a single immutable clinical_entries row
-- (entry_type: 'note') via clinicalService.addEntry — this table just tracks
-- that it happened (committed_entry_id) and is never itself part of the HC.
--
-- No raw audio is ever persisted here or anywhere else — only the transcript
-- text and the structured JSON extraction. Audio is processed in-memory by the
-- clinical-scribe Edge Function and discarded once transcribed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.clinical_scribe_sessions (
  id                 uuid primary key default gen_random_uuid(),
  encounter_id       uuid references public.clinical_encounters(id) on delete cascade,
  patient_id         uuid not null references public.profiles(id),
  professional_id    uuid not null references public.profiles(id),
  status             text not null default 'recording'
                       check (status in ('recording', 'transcribing', 'draft', 'finalized', 'discarded')),
  transcript         text,
  structured_data    jsonb,
  committed_entry_id uuid references public.clinical_entries(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.clinical_scribe_sessions enable row level security;

-- Draft is the professional's private scratch pad — no patient-facing policy.
-- Once committed, the note lives in clinical_entries, which already has its
-- own patient-read policy (cen_patient_read in 033_clinical_schema.sql).
create policy "css_professional_all"
  on public.clinical_scribe_sessions for all
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

create or replace function public.clinical_scribe_sessions_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clinical_scribe_sessions_updated_at
  before update on public.clinical_scribe_sessions
  for each row execute function public.clinical_scribe_sessions_set_updated_at();

create index if not exists idx_css_encounter     on public.clinical_scribe_sessions (encounter_id);
create index if not exists idx_css_professional  on public.clinical_scribe_sessions (professional_id, status);
