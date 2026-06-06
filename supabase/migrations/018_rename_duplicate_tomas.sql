-- Rename the duplicate 'Tomás García' patient that has fewer consultations.
-- Safe to re-run: the UPDATE is a no-op if there is only one match.
UPDATE public.profiles
SET full_name = 'Tomás García López'
WHERE id = (
  SELECT p.id
  FROM public.profiles p
  WHERE p.full_name = 'Tomás García'
    AND p.role = 'patient'
  ORDER BY (
    SELECT COUNT(*) FROM public.consultations c WHERE c.patient_id = p.id
  ) ASC,
  p.created_at ASC
  LIMIT 1
)
AND (
  SELECT COUNT(*) FROM public.profiles
  WHERE full_name = 'Tomás García' AND role = 'patient'
) > 1;
