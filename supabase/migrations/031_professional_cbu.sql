-- Add bank account fields to professional_profiles
alter table public.professional_profiles
  add column if not exists cbu text,
  add column if not exists cbu_alias text;
