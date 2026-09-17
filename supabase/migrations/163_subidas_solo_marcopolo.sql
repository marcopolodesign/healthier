-- El registro de subidas lo ve UNA sola cuenta: marcopolo@healthier.app.
--
-- Pedido de Mateo (2026-09-16): *"Subidas quiero que solamente sea visible por
-- marcopolo@healthier.app"*. Hasta acá lo leía cualquier `admin` o
-- `super_admin` (migración 162).
--
-- ── Por qué el mail y no un rol ─────────────────────────────────────────────
-- Porque eso fue lo que se pidió: una cuenta, no una categoría. Un rol nuevo
-- ("analista") sería más elegante, pero hoy habría exactamente un integrante y
-- agregaría un concepto al modelo de permisos para nada. El mail está en un
-- solo lugar del SQL y en un solo lugar del front (`lib/permisos.js`); cuando
-- haya que sumar a alguien, se cambia ahí — y ahí conviene evaluar el rol.
--
-- ── Por qué se compara contra el JWT ────────────────────────────────────────
-- `auth.jwt() ->> 'email'` sale del token de la sesión, no de una tabla: no
-- toca `profiles`, así que no entra en la recursión que obligó a inventar
-- `get_my_role()` (ver la invariante de RLS en CLAUDE.md). Y el mail del JWT no
-- se puede falsear desde el cliente: lo firma Supabase Auth.
--
-- El `insert` NO se toca: lo sigue escribiendo cada profesional a su propio
-- nombre, que es de dónde salen los datos.
drop policy if exists upload_log_admin_read on public.upload_log;

drop policy if exists upload_log_lectura_marcopolo on public.upload_log;
create policy upload_log_lectura_marcopolo on public.upload_log
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'marcopolo@healthier.app');

comment on policy upload_log_lectura_marcopolo on public.upload_log is
  'Sólo marcopolo@healthier.app. Pedido de Mateo el 2026-09-16; el front esconde la pantalla en lib/permisos.js con el mismo criterio.';
