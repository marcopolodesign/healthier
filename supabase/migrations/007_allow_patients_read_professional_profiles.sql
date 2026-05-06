-- Allow authenticated users to read any profile where role = 'professional'.
-- Required so the patient booking flow (mobile + web) can display professional
-- names and avatars. Does not expose patient-to-patient data.
CREATE POLICY "profiles_read_professionals" ON public.profiles
  FOR SELECT USING (role = 'professional');
