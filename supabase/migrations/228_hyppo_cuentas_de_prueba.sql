-- ============================================================
-- 228 — Las cuentas del equipo de Hyppo son de prueba
-- ============================================================
-- Pedido de Mateo (2026-11-03): las cuentas con las que prueban los de Hyppo
-- (@hyppo.io) tienen que quedar con `es_prueba = true`, así no cuentan en las
-- métricas ni se mezclan con pacientes y profesionales reales. El equipo de
-- Healthier (Mateo, Nacho) sigue con `ve_ambos_mundos`, no se toca.
--
-- `correo_de_prueba` suma el dominio, así una cuenta nueva de Hyppo nace
-- marcada (trigger de la 186), y se marcan las que ya existen. El trigger
-- `profiles_propagar_prueba` de la 186 lleva la marca a sus familiares.
-- ============================================================

create or replace function public.correo_de_prueba(p_email text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    lower(btrim(p_email)) like '%@healthier.app'
    or lower(btrim(p_email)) like '%@staging.healthier.app'
    or lower(btrim(p_email)) like '%@hyppo.io'
    or lower(btrim(p_email)) like '%.test',
    false);
$$;

update public.profiles
   set es_prueba = true
 where public.correo_de_prueba(email)
   and not es_prueba;
