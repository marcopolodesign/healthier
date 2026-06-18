-- Remove admin read-all access to clinical notes.
-- Admins have no clinical need to read patient records.
-- Operational issues (abuse reports, disputes) must go through a defined process
-- with explicit patient consent, not blanket DB access.
drop policy if exists "clinical_notes_admins" on public.clinical_notes;
