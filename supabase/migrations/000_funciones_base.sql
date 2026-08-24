-- ============================================================
-- 000 — Funciones base (captura de drift)
-- ============================================================
-- `get_my_role()` es la función sobre la que se apoya TODO el RLS del
-- proyecto: la invariante de `profiles` (ver CLAUDE.md) dice que ninguna
-- policy puede consultar `profiles` directo — se llama a esta función, que es
-- SECURITY DEFINER, para no caer en la recursión infinita 42P17.
--
-- **Nunca estuvo en una migración.** Se creó a mano en el dashboard de
-- Supabase en algún momento temprano del proyecto y quedó viviendo sólo en la
-- base de producción. La usan 23 migraciones (010, 011, 017, 022, 056, 086,
-- 094, 097, 109, 112, 116, 120…), así que reconstruir la base desde el repo
-- fallaba en cascada a partir de la 010: 37 de 115 migraciones no corrían.
-- Encontrado el 2026-08-24 al levantar la base de staging desde cero — que es
-- exactamente para lo que sirve tener un staging con base propia.
--
-- Va numerada 000 para que corra ANTES que la primera migración que la usa.
-- En una base que ya la tiene (producción) es un no-op: `create or replace`
-- con la definición idéntica a la que hay hoy, verificada con
-- `pg_get_functiondef` contra producción.
--
-- Si aparece otra función/objeto que exista en producción y no en el repo, va
-- acá con el mismo criterio: capturarla y documentar de dónde salió.
-- ============================================================

-- El cuerpo consulta `public.profiles`, que recién se crea en la 001 — y una
-- función `language sql` se valida al crearse. Se apaga esa validación sólo
-- para esta sentencia: la función no se ejecuta hasta que alguna policy la
-- llame, y para entonces `profiles` ya existe.
set check_function_bodies = off;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
as $function$
  select role from public.profiles where id = auth.uid();
$function$;

comment on function public.get_my_role() is
  'Rol del usuario autenticado. SECURITY DEFINER a propósito: las policies de `profiles` no pueden consultar `profiles` directo sin caer en recursión infinita (42P17). Capturada en la migración 000 el 2026-08-24 — antes existía sólo en la base de producción.';

reset check_function_bodies;
