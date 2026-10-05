-- ============================================================
-- 187 — Respuestas de Mateo sobre la 186 (2026-10-05)
--
--   1. La excepción `ve_ambos_mundos` (usa cuentas de prueba Y reales) para
--      Mateo y Nacho: "Sí, a mí y a Nacho".
--   2. Cuentas dudosas que quedaron sin marcar en la 186: "Sí, todas menos la
--      de Apple". `b9b46zzm8b@privaterelay.appleid.com` (John Apple) sigue
--      real. Antes de marcarlas se revisó que ninguna tuviera consultas,
--      emergencias, pedidos ni familiares (las 8 en cero).
--
-- Es la misma migración para las dos bases: un mail que no existe en una de
-- ellas simplemente no actualiza nada. Los triggers de la 186 propagan la
-- marca al espejo `solo_pruebas` y a los familiares.
-- ============================================================

update public.profiles
   set ve_ambos_mundos = true
 where lower(email) in ('mateoaldao@gmail.com', 'arteaga.ignacio95@gmail.com')
   and titular_id is null
   and not ve_ambos_mundos;

update public.profiles
   set es_prueba = true
 where lower(email) in (
         'e@a.com', 'oaskjtojosa@gmail.com', 'mateoaldao@me.com',
         'principitodps@gmail.com', 'jd6995738@gmail.com',
         -- sólo existen en staging
         'testingdocs@gmail.com', 'healthier@marcopolo.agency', 'm@marcopolo.agency'
       )
   and not es_prueba;
