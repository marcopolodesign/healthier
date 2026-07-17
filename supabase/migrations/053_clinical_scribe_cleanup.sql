-- ─────────────────────────────────────────────────────────────────────────────
-- AI SCRIBE cleanup — code review follow-up on 052_clinical_scribe_sessions.sql
--
-- 1. Dedup: clinical_scribe_sessions_set_updated_at() reimplemented the
--    generic public.set_updated_at() trigger every other table in this repo
--    already reuses (profiles, professional_profiles, consultations, and
--    others via 015/017). Point the trigger at the shared function instead.
--
-- 2. Provenance guard: once a scribe session is finalized, its
--    committed_entry_id is the only link proving a given clinical_entries
--    row was AI-authored. Every other clinical_* table blocks DELETE outright
--    (block_clinical_delete(), see 033_clinical_schema.sql) — this table's
--    original "for all" policy let a professional delete a finalized session
--    row and silently erase that link. Block deletes once finalized; drafts
--    and discarded sessions (scratch data, never entered the HC) stay
--    deletable.
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists clinical_scribe_sessions_updated_at on public.clinical_scribe_sessions;
drop function if exists public.clinical_scribe_sessions_set_updated_at();

create trigger clinical_scribe_sessions_updated_at
  before update on public.clinical_scribe_sessions
  for each row execute function public.set_updated_at();

create or replace function public.block_finalized_scribe_session_delete()
returns trigger language plpgsql as $$
begin
  if old.status = 'finalized' then
    raise exception
      'Finalized scribe sessions cannot be deleted — committed_entry_id is the only record proving AI origin of the linked clinical_entries row.';
  end if;
  return old;
end;
$$;

create trigger clinical_scribe_sessions_no_delete_finalized
  before delete on public.clinical_scribe_sessions
  for each row execute function public.block_finalized_scribe_session_delete();
