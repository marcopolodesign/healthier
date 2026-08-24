-- "Recetario" se parte en 2 flujos (Mateo, 2026-08-24): medicamentos, que ya
-- existía, y estudios — nuevo. El profesional pide una orden de estudios desde
-- EstudiosCreator.jsx y queda asentada como un `clinical_entries` con
-- `entry_type: 'order'`.
--
-- Bug encontrado al verificar en el browser (no en el plan original, que decía
-- explícitamente no tocar migraciones): la tabla tiene un CHECK constraint que
-- sólo permite 'note', 'diagnosis', 'indication', 'prescription_ref',
-- 'addendum' (migración 033). Guardar una orden de estudios rompía con 400
-- antes de esta migración — se comprobó en vivo contra el sandbox, viendo el
-- POST a /clinical_entries devolver el 400 del CHECK. Mismo patrón que la
-- migración 048 con `consultations.status` y 'no_show'.
ALTER TABLE public.clinical_entries
  DROP CONSTRAINT IF EXISTS clinical_entries_entry_type_check;

ALTER TABLE public.clinical_entries
  ADD CONSTRAINT clinical_entries_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'note'::text,
    'diagnosis'::text,
    'indication'::text,
    'prescription_ref'::text,
    'addendum'::text,
    'order'::text
  ]));
