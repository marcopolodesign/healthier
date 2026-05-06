-- Fix NULL auth token fields that blocked all demo user logins (GoTrue scanner bug)
UPDATE auth.users
SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change               = COALESCE(email_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  phone_change               = COALESCE(phone_change, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE
  confirmation_token IS NULL
  OR recovery_token IS NULL
  OR email_change_token_new IS NULL
  OR email_change_token_current IS NULL
  OR reauthentication_token IS NULL;

-- SECURITY DEFINER function to safely check consultation relationships without
-- triggering infinite recursion (42P17) between profiles and consultations RLS.
CREATE OR REPLACE FUNCTION public.has_shared_consultation(other_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE (c.professional_id = auth.uid() AND c.patient_id = other_user_id)
       OR (c.patient_id = auth.uid() AND c.professional_id = other_user_id)
  );
$$;

-- Allow professionals to read patient profiles (and vice versa) for shared consultations.
-- Uses the SECURITY DEFINER function above to avoid the profiles→consultations→profiles cycle.
DROP POLICY IF EXISTS "profiles_read_consultation_parties" ON public.profiles;
CREATE POLICY "profiles_read_consultation_parties" ON public.profiles
  FOR SELECT USING (
    public.has_shared_consultation(id)
  );
