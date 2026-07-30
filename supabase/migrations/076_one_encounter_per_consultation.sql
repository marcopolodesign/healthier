-- ─────────────────────────────────────────────────────────────────────────────
-- Un encuentro clínico por consulta, garantizado por la base.
--
-- El código ya asumía esto en todos lados: `getEncounterByConsultationIdSafe`
-- usa `.maybeSingle()`, que **tira error** si hay más de una fila. O sea que un
-- duplicado no degradaba: rompía la pantalla.
--
-- Y el duplicado era alcanzable. `useClinicalEncounter.ensureEncounter` decidía
-- si crear mirando su propio estado de React, no la base — así que dos instancias
-- del hook sobre la misma consulta (la videollamada tiene el panel clínico y el
-- modal de cierre) podían crear dos encuentros. La otra mitad del arreglo está en
-- el hook, que ahora re-consulta la base antes de insertar; esta constraint es la
-- que lo hace imposible y no sólo improbable.
--
-- Verificado antes de aplicarla: 0 consultas con más de un encuentro.
-- `consultation_id` es nullable a propósito (hay encuentros sin consulta paga),
-- y un índice único ignora los NULL, así que esos siguen conviviendo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS clinical_encounters_one_per_consultation
  ON public.clinical_encounters (consultation_id)
  WHERE consultation_id IS NOT NULL;
