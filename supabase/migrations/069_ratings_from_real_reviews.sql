-- ============================================================
-- Migration 069 — average_rating / total_reviews derivados de reviews reales
-- ============================================================
-- Mateo (2026-07-28) preguntó si el "4,8 · 47 reseñas" del mapa era mockeado.
-- Lo era: lo escribió a mano la migración 029 (y la 002/012 para los pros demo).
-- Valentina mostraba 47 reseñas teniendo 4 filas reales en `reviews`; los pros
-- demo mostraban 143–312 teniendo cero.
--
-- El mecanismo de recálculo existía pero vivía SOLO en JS
-- (reviewsService.recalculateRating), así que cualquier escritura que no pasara
-- por ahí dejaba los contadores mintiendo para siempre. Acá se mueve la verdad
-- a la base: un trigger sobre `reviews` recalcula, y se corre una vez sobre todo
-- lo existente para limpiar lo sembrado.
--
-- Consecuencia buscada: un profesional sin reseñas queda en 0/0 y la UI
-- (Dashboard, ProfessionalModal) no le dibuja estrellas. Si se quiere prueba
-- social para las demos, se siembran filas en `reviews` — no números sueltos en
-- professional_profiles.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalc_professional_rating(p_professional_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.professional_profiles pp
     SET average_rating = COALESCE(r.avg_rating, 0),
         total_reviews  = COALESCE(r.n, 0)
    FROM (
      SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS n
        FROM public.reviews
       WHERE professional_id = p_professional_id
    ) r
   WHERE pp.user_id = p_professional_id;
$$;

COMMENT ON FUNCTION public.recalc_professional_rating(uuid) IS
  'Recalcula average_rating/total_reviews de un profesional a partir de las filas reales de reviews.';

CREATE OR REPLACE FUNCTION public.reviews_recalc_rating_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- En UPDATE que cambia de profesional hay que arreglar los dos lados.
  IF TG_OP <> 'INSERT' AND OLD.professional_id IS NOT NULL THEN
    PERFORM public.recalc_professional_rating(OLD.professional_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.professional_id IS NOT NULL THEN
    PERFORM public.recalc_professional_rating(NEW.professional_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reviews_recalc_rating ON public.reviews;
CREATE TRIGGER reviews_recalc_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_recalc_rating_trigger();

-- ── Backfill: alinear TODO con las reseñas reales ──────────────────────────
UPDATE public.professional_profiles pp
   SET average_rating = COALESCE(r.avg_rating, 0),
       total_reviews  = COALESCE(r.n, 0)
  FROM (
    SELECT pp2.user_id,
           ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating,
           COUNT(rv.id)                      AS n
      FROM public.professional_profiles pp2
      LEFT JOIN public.reviews rv ON rv.professional_id = pp2.user_id
     GROUP BY pp2.user_id
  ) r
 WHERE pp.user_id = r.user_id;
