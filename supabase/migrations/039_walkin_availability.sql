-- Professional availability for walk-in consultations
alter table professional_profiles
  add column if not exists is_available_walkin boolean not null default false;

-- Patients can read availability (to show count on walk-in form)
create policy "patients read walkin availability"
  on professional_profiles for select
  using (auth.role() = 'authenticated');
