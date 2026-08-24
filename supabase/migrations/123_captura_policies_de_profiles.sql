-- ============================================================
-- 123 — Captura de las policies de `profiles` que sólo existían en producción
-- ============================================================
-- Segunda tanda de drift encontrada el 2026-08-24 levantando la base de
-- staging desde cero (la primera fue `get_my_role()`, migración 000).
--
-- **1) `profiles_read_own` estaba recursiva en el repo.** La versión que crean
-- las migraciones consulta `profiles` DENTRO de una policy de `profiles`:
--
--     (auth.uid() = id) OR EXISTS (
--       SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin'))
--
-- Eso es exactamente lo que la invariante de RLS del CLAUDE.md prohíbe: en una
-- base reconstruida desde el repo, cualquier lectura de `profiles` devuelve
-- `42P17: infinite recursion detected in policy for relation "profiles"` — y
-- como el login lee el perfil, la app entera queda inusable. En producción
-- alguien la reescribió a mano con `get_my_role()` (que es SECURITY DEFINER y
-- por eso corta la recursión) y ese arreglo nunca se versionó.
--
-- **2) `profiles_delete_super_admin` no existía en el repo**: está en
-- producción y no la crea ninguna migración. Sin ella, el borrado de usuarios
-- del panel de super admin no funciona en un entorno nuevo.
--
-- Las dos definiciones se copiaron textuales de producción (`pg_policies`),
-- así que allá esto es un no-op.
-- ============================================================

-- 1) Sacar la recursión: misma semántica, sin consultar `profiles` adentro.
drop policy if exists profiles_read_own on public.profiles;

create policy profiles_read_own on public.profiles
  for select
  using (
    auth.uid() = id
    or public.get_my_role() = any (array['admin', 'super_admin'])
  );

-- 2) El super admin puede borrar perfiles (lo usa el panel de super admin).
drop policy if exists profiles_delete_super_admin on public.profiles;

create policy profiles_delete_super_admin on public.profiles
  for delete
  using (public.get_my_role() = 'super_admin');
